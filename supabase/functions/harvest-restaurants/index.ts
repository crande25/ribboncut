import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const YELP_API_URL = "https://api.yelp.com/v3";
const YELP_PAGE_LIMIT = 50;
const YELP_MAX_RESULTS = 1000;
const PRICE_TIERS = ["1", "2", "3", "4"];
const CATEGORIES = ["restaurants", "food", "bars", "coffee"];

const SE_MICHIGAN_CITIES = [
  "Detroit, MI", "Ann Arbor, MI", "Novi, MI", "Troy, MI", "Royal Oak, MI",
  "Birmingham, MI", "Dearborn, MI", "Livonia, MI", "Canton, MI", "Plymouth, MI",
  "Farmington Hills, MI", "Southfield, MI", "Warren, MI", "Sterling Heights, MI",
  "Rochester Hills, MI", "Clinton Township, MI", "Pontiac, MI", "West Bloomfield, MI",
  "Taylor, MI", "Ferndale, MI", "Ypsilanti, MI", "Northville, MI", "Grosse Pointe, MI",
  "Bloomfield Hills, MI", "Wyandotte, MI", "Monroe, MI", "Port Huron, MI",
  "Shelby Township, MI", "Waterford, MI",
];

async function yelpSearch(
  apiKey: string,
  params: Record<string, string>,
): Promise<{ businesses: any[]; total: number }> {
  const searchParams = new URLSearchParams(params);
  const res = await fetch(`${YELP_API_URL}/businesses/search?${searchParams}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Yelp error [${res.status}]: ${body}`);
    return { businesses: [], total: 0 };
  }
  const data = await res.json();
  return { businesses: data.businesses || [], total: data.total || 0 };
}

/** Paginate a single query, collecting up to 240 results */
async function paginateQuery(
  apiKey: string,
  baseParams: Record<string, string>,
  ids: Set<string>,
): Promise<number> {
  let queriesMade = 0;
  let offset = 0;
  while (offset < YELP_MAX_RESULTS) {
    const params = { ...baseParams, limit: String(YELP_PAGE_LIMIT), offset: String(offset) };
    const { businesses, total } = await yelpSearch(apiKey, params);
    queriesMade++;
    if (businesses.length === 0) break;
    for (const biz of businesses) ids.add(biz.id);
    offset += businesses.length;
    if (offset >= Math.min(total, YELP_MAX_RESULTS)) break;
    await new Promise((r) => setTimeout(r, 80));
  }
  return queriesMade;
}

/** Probe price tiers */
async function probePriceTiers(apiKey: string, location: string) {
  const totals: Record<string, number> = {};
  let needsPhase2 = false;
  for (const price of PRICE_TIERS) {
    const { total } = await yelpSearch(apiKey, {
      location, categories: "restaurants", price, limit: "1", offset: "0",
    });
    totals[`${"$".repeat(Number(price))}`] = total;
    if (total > YELP_MAX_RESULTS) needsPhase2 = true;
  }
  const { total: allTotal } = await yelpSearch(apiKey, {
    location, categories: "restaurants", limit: "1", offset: "0",
  });
  const pricedSum = Object.values(totals).reduce((a, b) => a + b, 0);
  totals["unpriced_est"] = Math.max(0, allTotal - pricedSum);
  totals["all_no_filter"] = allTotal;
  if (totals["unpriced_est"] > YELP_MAX_RESULTS) needsPhase2 = true;
  return { totals, needsPhase2 };
}

async function persistIds(
  supabase: any,
  ids: string[],
  city: string,
  existingIds: Set<string>,
) {
  const tenYearsAgo = new Date();
  tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
  const defaultFirstSeen = tenYearsAgo.toISOString();
  let dbErrors = 0;

  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = chunk.map((id) => ({
      yelp_id: id,
      city,
      first_seen_at: defaultFirstSeen,
      is_new_discovery: false,
    }));
    const { error } = await supabase
      .from("restaurant_sightings")
      .upsert(rows, { onConflict: "yelp_id", ignoreDuplicates: true });
    if (error) { console.error(`DB upsert error:`, error.message); dbErrors++; }
  }

  const newIds = ids.filter((id) => !existingIds.has(id));
  return { newCount: newIds.length, dbErrors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const YELP_API_KEY = Deno.env.get("YELP_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!YELP_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing required env vars" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let body: any = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch {}
    }

    const mode = body.mode || "harvest";
    // Modes:
    //   "probe"   — returns price totals + phase decision for given cities
    //   "harvest" — harvests ONE city. For Phase 1 cities, does everything.
    //               For Phase 2, accepts optional "slice" param to run one price×category combo at a time.
    //   "harvest_all_slices" — for a Phase 2 city, runs ALL slices sequentially (may timeout for huge cities)

    // === PROBE ===
    if (mode === "probe") {
      const cities = body.cities || SE_MICHIGAN_CITIES;
      const results: any[] = [];
      for (const city of cities) {
        const { totals, needsPhase2 } = await probePriceTiers(YELP_API_KEY, city);
        results.push({ city, totals, needsPhase2 });
      }
      return new Response(JSON.stringify(results), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === HARVEST ===
    const city = body.city;
    if (!city) {
      return new Response(
        JSON.stringify({
          error: "city required",
          usage: {
            probe: { mode: "probe", cities: ["Detroit, MI"] },
            harvest_phase1: { mode: "harvest", city: "Monroe, MI" },
            harvest_slice: { mode: "harvest", city: "Detroit, MI", slice: { price: "1", category: "restaurants" } },
            harvest_unpriced: { mode: "harvest", city: "Detroit, MI", slice: { price: "none", category: "restaurants" } },
          },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get existing IDs for this city
    const { data: existingRows } = await supabase
      .from("restaurant_sightings")
      .select("yelp_id")
      .eq("city", city);
    const existingIds = new Set((existingRows || []).map((r: any) => r.yelp_id));

    // Probe first
    const { totals, needsPhase2 } = await probePriceTiers(YELP_API_KEY, city);

    // If Phase 1 is enough, just do it all
    if (!needsPhase2) {
      const cityIds = new Set<string>();
      let q = 0;
      for (const price of PRICE_TIERS) {
        q += await paginateQuery(YELP_API_KEY, { location: city, categories: "restaurants", price, sort_by: "best_match" }, cityIds);
      }
      q += await paginateQuery(YELP_API_KEY, { location: city, categories: "restaurants", sort_by: "best_match" }, cityIds);

      const allIds = [...cityIds];
      const { newCount, dbErrors } = await persistIds(supabase, allIds, city, existingIds);
      await supabase.from("scan_log").insert({ city, new_count: newCount });

      return new Response(JSON.stringify({
        success: true, city, phase: 1, probe: totals,
        unique_ids: cityIds.size, new_to_db: newCount, queries: q, db_errors: dbErrors,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Phase 2 — if no slice specified, return the list of slices to run
    const slice = body.slice;
    if (!slice) {
      // Generate all slices the caller should invoke
      const slices: any[] = [];
      for (const price of PRICE_TIERS) {
        for (const cat of CATEGORIES) {
          slices.push({ price, category: cat });
        }
      }
      // Unpriced slices
      for (const cat of CATEGORIES) {
        slices.push({ price: "none", category: cat });
      }

      return new Response(JSON.stringify({
        city,
        phase: 2,
        probe: totals,
        message: "City needs Phase 2. Call this endpoint once per slice below.",
        existing_in_db: existingIds.size,
        slices,
        total_slices: slices.length,
        example: { mode: "harvest", city, slice: slices[0] },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Run one slice
    const cityIds = new Set<string>();
    const baseParams: Record<string, string> = {
      location: city,
      categories: slice.category || "restaurants",
      sort_by: "best_match",
    };
    if (slice.price && slice.price !== "none") {
      baseParams.price = slice.price;
    }

    const q = await paginateQuery(YELP_API_KEY, baseParams, cityIds);
    const allIds = [...cityIds];
    const { newCount, dbErrors } = await persistIds(supabase, allIds, city, existingIds);

    return new Response(JSON.stringify({
      success: true, city, phase: 2,
      slice,
      unique_ids: cityIds.size,
      new_to_db: newCount,
      queries: q,
      db_errors: dbErrors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: unknown) {
    console.error("Harvest error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
