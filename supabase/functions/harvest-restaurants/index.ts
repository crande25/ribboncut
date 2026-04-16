import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const YELP_API_URL = "https://api.yelp.com/v3";
const YELP_PAGE_LIMIT = 50;
const YELP_MAX_RESULTS = 240; // Yelp hard caps at ~240 per query
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

interface HarvestStats {
  city: string;
  phase: 1 | 2;
  uniqueIds: number;
  queriesMade: number;
  priceProbeTotals: Record<string, number>;
  newToDb: number;
}

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

    // Small delay to be nice to Yelp
    await new Promise((r) => setTimeout(r, 100));
  }

  return queriesMade;
}

/** Phase 1: Probe each price tier to see if simple pagination suffices */
async function probePriceTiers(
  apiKey: string,
  location: string,
): Promise<{ totals: Record<string, number>; needsPhase2: boolean }> {
  const totals: Record<string, number> = {};
  let needsPhase2 = false;

  for (const price of PRICE_TIERS) {
    const { total } = await yelpSearch(apiKey, {
      location,
      categories: "restaurants",
      price,
      limit: "1",
      offset: "0",
    });
    totals[`${"$".repeat(Number(price))}`] = total;
    if (total > YELP_MAX_RESULTS) needsPhase2 = true;
  }

  // Also check unpriced — query without price filter
  const { total: allTotal } = await yelpSearch(apiKey, {
    location,
    categories: "restaurants",
    limit: "1",
    offset: "0",
  });
  const pricedTotal = Object.values(totals).reduce((a, b) => a + b, 0);
  totals["unpriced_estimate"] = Math.max(0, allTotal - pricedTotal);
  if (totals["unpriced_estimate"] > YELP_MAX_RESULTS) needsPhase2 = true;

  return { totals, needsPhase2 };
}

/** Phase 1 harvest: just iterate by price, paginating each */
async function harvestPhase1(
  apiKey: string,
  location: string,
  ids: Set<string>,
): Promise<number> {
  let totalQueries = 0;

  // Priced tiers
  for (const price of PRICE_TIERS) {
    const q = await paginateQuery(apiKey, {
      location,
      categories: "restaurants",
      price,
      sort_by: "best_match",
    }, ids);
    totalQueries += q;
  }

  // Unpriced: query without price filter (will overlap but Set dedupes)
  const q = await paginateQuery(apiKey, {
    location,
    categories: "restaurants",
    sort_by: "best_match",
  }, ids);
  totalQueries += q;

  return totalQueries;
}

/** Phase 2 harvest: price × category permutations */
async function harvestPhase2(
  apiKey: string,
  location: string,
  ids: Set<string>,
): Promise<number> {
  let totalQueries = 0;

  for (const price of PRICE_TIERS) {
    for (const category of CATEGORIES) {
      const q = await paginateQuery(apiKey, {
        location,
        categories: category,
        price,
        sort_by: "best_match",
      }, ids);
      totalQueries += q;
    }
  }

  // Unpriced × each category
  for (const category of CATEGORIES) {
    const q = await paginateQuery(apiKey, {
      location,
      categories: category,
      sort_by: "best_match",
    }, ids);
    totalQueries += q;
  }

  return totalQueries;
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

    // Parse request — accept specific cities or default to all
    let citiesToHarvest: string[] = SE_MICHIGAN_CITIES.slice();
    let dryRun = false;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body.cities && Array.isArray(body.cities)) {
          citiesToHarvest = body.cities;
        }
        if (body.dry_run) dryRun = true;
      } catch { /* default to all cities */ }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Snapshot existing IDs
    const { data: existingRows } = await supabase
      .from("restaurant_sightings")
      .select("yelp_id");
    const existingIds = new Set((existingRows || []).map((r: any) => r.yelp_id));
    console.log(`Existing DB snapshot: ${existingIds.size} restaurants`);

    const allStats: HarvestStats[] = [];
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    const defaultFirstSeen = tenYearsAgo.toISOString();

    for (const city of citiesToHarvest) {
      console.log(`\n=== Harvesting: ${city} ===`);

      // Phase 1: Probe
      const { totals, needsPhase2 } = await probePriceTiers(YELP_API_KEY, city);
      console.log(`Price probe for ${city}:`, JSON.stringify(totals));
      console.log(`Needs Phase 2: ${needsPhase2}`);

      const cityIds = new Set<string>();
      let queriesMade: number;
      let phase: 1 | 2;

      if (needsPhase2) {
        phase = 2;
        console.log(`Running Phase 2 (price × category) for ${city}`);
        queriesMade = await harvestPhase2(YELP_API_KEY, city, cityIds);
      } else {
        phase = 1;
        console.log(`Running Phase 1 (price-only) for ${city}`);
        queriesMade = await harvestPhase1(YELP_API_KEY, city, cityIds);
      }

      console.log(`${city}: ${cityIds.size} unique IDs from ${queriesMade} queries (Phase ${phase})`);

      // Persist to DB (unless dry run)
      let newToDb = 0;
      if (!dryRun) {
        const newIds = [...cityIds].filter((id) => !existingIds.has(id));
        newToDb = newIds.length;

        // Batch upsert in chunks of 500
        const allCityIds = [...cityIds];
        for (let i = 0; i < allCityIds.length; i += 500) {
          const chunk = allCityIds.slice(i, i + 500);
          const rows = chunk.map((id) => ({
            yelp_id: id,
            city,
            first_seen_at: existingIds.has(id) ? undefined : defaultFirstSeen,
            is_new_discovery: false,
          }));

          const { error } = await supabase
            .from("restaurant_sightings")
            .upsert(rows, { onConflict: "yelp_id", ignoreDuplicates: true });
          if (error) console.error(`DB upsert error for ${city}:`, error.message);
        }

        // Add newly found IDs to the existing set for subsequent cities
        for (const id of cityIds) existingIds.add(id);

        // Log the scan
        await supabase.from("scan_log").insert({
          city,
          new_count: newToDb,
        });

        console.log(`${city}: ${newToDb} new to DB, ${cityIds.size - newToDb} already known`);
      }

      allStats.push({
        city,
        phase,
        uniqueIds: cityIds.size,
        queriesMade,
        priceProbeTotals: totals,
        newToDb,
      });
    }

    const totalUnique = allStats.reduce((a, s) => a + s.uniqueIds, 0);
    const totalQueries = allStats.reduce((a, s) => a + s.queriesMade, 0);
    const totalNew = allStats.reduce((a, s) => a + s.newToDb, 0);

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        summary: {
          cities_harvested: allStats.length,
          total_unique_ids: totalUnique,
          total_queries: totalQueries,
          total_new_to_db: totalNew,
        },
        cities: allStats,
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
