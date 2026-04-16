import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const YELP_API_URL = "https://api.yelp.com/v3";
const YELP_PAGE_LIMIT = 50;
const YELP_MAX_RESULTS = 240;
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

/** Paginate a single query permutation, collecting up to 240 results */
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

/** Probe price tiers for a city */
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

/** Phase 1: price-only pagination */
async function harvestPhase1(apiKey: string, location: string, ids: Set<string>) {
  let q = 0;
  for (const price of PRICE_TIERS) {
    q += await paginateQuery(apiKey, { location, categories: "restaurants", price, sort_by: "best_match" }, ids);
  }
  // Unpriced catch-all
  q += await paginateQuery(apiKey, { location, categories: "restaurants", sort_by: "best_match" }, ids);
  return q;
}

/** Phase 2: price × category permutations */
async function harvestPhase2(apiKey: string, location: string, ids: Set<string>) {
  let q = 0;
  for (const price of PRICE_TIERS) {
    for (const cat of CATEGORIES) {
      q += await paginateQuery(apiKey, { location, categories: cat, price, sort_by: "best_match" }, ids);
    }
  }
  // Unpriced × each category
  for (const cat of CATEGORIES) {
    q += await paginateQuery(apiKey, { location, categories: cat, sort_by: "best_match" }, ids);
  }
  return q;
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

    const mode = body.mode || "harvest"; // "probe" | "harvest"

    // === PROBE MODE ===
    // Returns price tier totals and phase decision for each city
    if (mode === "probe") {
      const cities = body.cities || SE_MICHIGAN_CITIES;
      const probeResults: any[] = [];
      for (const city of cities) {
        const { totals, needsPhase2 } = await probePriceTiers(YELP_API_KEY, city);
        probeResults.push({ city, totals, needsPhase2 });
      }
      return new Response(JSON.stringify(probeResults), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === HARVEST MODE ===
    // Process ONE city at a time (edge function timeout constraint)
    const city = body.city;
    if (!city) {
      return new Response(
        JSON.stringify({ error: "city parameter required for harvest mode. Use mode=probe to scan all cities first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Snapshot existing IDs for this city
    const { data: existingRows } = await supabase
      .from("restaurant_sightings")
      .select("yelp_id")
      .eq("city", city);
    const existingIds = new Set((existingRows || []).map((r: any) => r.yelp_id));
    console.log(`${city}: ${existingIds.size} existing in DB`);

    // Probe
    const { totals, needsPhase2 } = await probePriceTiers(YELP_API_KEY, city);
    console.log(`${city} probe:`, JSON.stringify(totals), `Phase ${needsPhase2 ? 2 : 1}`);

    // Harvest
    const cityIds = new Set<string>();
    const phase = needsPhase2 ? 2 : 1;
    let queriesMade: number;

    if (needsPhase2) {
      queriesMade = await harvestPhase2(YELP_API_KEY, city, cityIds);
    } else {
      queriesMade = await harvestPhase1(YELP_API_KEY, city, cityIds);
    }

    console.log(`${city}: ${cityIds.size} unique IDs from ${queriesMade} queries`);

    // Persist — upsert in chunks, backdated for baseline
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    const defaultFirstSeen = tenYearsAgo.toISOString();

    const allIds = [...cityIds];
    let dbErrors = 0;
    for (let i = 0; i < allIds.length; i += 500) {
      const chunk = allIds.slice(i, i + 500);
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

    const newIds = allIds.filter((id) => !existingIds.has(id));

    // Log scan
    await supabase.from("scan_log").insert({ city, new_count: newIds.length });

    return new Response(
      JSON.stringify({
        success: true,
        city,
        phase,
        probe: totals,
        unique_ids_found: cityIds.size,
        new_to_db: newIds.length,
        already_known: cityIds.size - newIds.length,
        queries_made: queriesMade,
        db_errors: dbErrors,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    console.error("Harvest error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
