import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { YelpKeyPool } from "./yelpKeys.ts";

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

// Bounding boxes (south, west, north, east) for dense cities. Slightly padded.
// Used by the grid harvest mode to slice the city into many small geographic
// cells so each cell can be queried independently against Yelp's per-query 1000 cap.
const CITY_BBOXES: Record<string, { s: number; w: number; n: number; e: number }> = {
  "Detroit, MI":          { s: 42.255, w: -83.288, n: 42.450, e: -82.910 },
  "Warren, MI":           { s: 42.450, w: -83.080, n: 42.560, e: -82.930 },
  "Southfield, MI":       { s: 42.430, w: -83.310, n: 42.530, e: -83.190 },
  "Sterling Heights, MI": { s: 42.530, w: -83.080, n: 42.660, e: -82.940 },
  "Livonia, MI":          { s: 42.350, w: -83.430, n: 42.450, e: -83.290 },
  "Ann Arbor, MI":        { s: 42.220, w: -83.820, n: 42.330, e: -83.660 },
  "Canton, MI":           { s: 42.260, w: -83.555, n: 42.355, e: -83.420 },
  "Dearborn, MI":         { s: 42.270, w: -83.310, n: 42.355, e: -83.140 },
  "Troy, MI":             { s: 42.530, w: -83.220, n: 42.640, e: -83.080 },
  "Farmington Hills, MI": { s: 42.430, w: -83.450, n: 42.530, e: -83.330 },
  "Rochester Hills, MI":  { s: 42.620, w: -83.220, n: 42.730, e: -83.080 },
  "Clinton Township, MI": { s: 42.540, w: -82.960, n: 42.650, e: -82.820 },
  "Novi, MI":             { s: 42.430, w: -83.535, n: 42.535, e: -83.405 },
  "Pontiac, MI":          { s: 42.610, w: -83.330, n: 42.690, e: -83.220 },
  "Royal Oak, MI":        { s: 42.460, w: -83.180, n: 42.530, e: -83.090 },
  "Taylor, MI":           { s: 42.190, w: -83.330, n: 42.270, e: -83.220 },
  "Waterford, MI":        { s: 42.610, w: -83.470, n: 42.730, e: -83.300 },
  "Shelby Township, MI":  { s: 42.620, w: -83.090, n: 42.730, e: -82.940 },
  "West Bloomfield, MI":  { s: 42.500, w: -83.450, n: 42.610, e: -83.310 },
  "Birmingham, MI":       { s: 42.520, w: -83.260, n: 42.580, e: -83.190 },
  "Plymouth, MI":         { s: 42.345, w: -83.510, n: 42.405, e: -83.430 },
  "Ferndale, MI":         { s: 42.440, w: -83.160, n: 42.485, e: -83.100 },
  "Ypsilanti, MI":        { s: 42.220, w: -83.660, n: 42.290, e: -83.580 },
  "Northville, MI":       { s: 42.405, w: -83.520, n: 42.460, e: -83.440 },
  "Grosse Pointe, MI":    { s: 42.360, w: -82.940, n: 42.470, e: -82.840 },
  "Bloomfield Hills, MI": { s: 42.540, w: -83.290, n: 42.610, e: -83.210 },
  "Wyandotte, MI":        { s: 42.180, w: -83.200, n: 42.230, e: -83.130 },
  "Monroe, MI":           { s: 41.890, w: -83.450, n: 41.960, e: -83.340 },
  "Port Huron, MI":       { s: 42.940, w: -82.500, n: 43.030, e: -82.400 },
};

/** Build an NxN grid of cell centers + radius covering a bounding box. */
function buildGrid(
  bbox: { s: number; w: number; n: number; e: number },
  n: number,
): Array<{ lat: number; lng: number; radius: number }> {
  const cells: Array<{ lat: number; lng: number; radius: number }> = [];
  const latStep = (bbox.n - bbox.s) / n;
  const lngStep = (bbox.e - bbox.w) / n;
  // Cell half-diagonal in meters → use as radius (with 30% padding for overlap)
  const midLat = (bbox.n + bbox.s) / 2;
  const latMeters = latStep * 111_111;
  const lngMeters = lngStep * 111_111 * Math.cos((midLat * Math.PI) / 180);
  const halfDiag = Math.sqrt(latMeters * latMeters + lngMeters * lngMeters) / 2;
  const radius = Math.min(40000, Math.round(halfDiag * 1.3));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cells.push({
        lat: bbox.s + latStep * (i + 0.5),
        lng: bbox.w + lngStep * (j + 0.5),
        radius,
      });
    }
  }
  return cells;
}

async function yelpSearch(
  pool: YelpKeyPool,
  params: Record<string, string>,
): Promise<{ businesses: any[]; total: number; rateLimited?: boolean; status?: number; keyName?: string }> {
  const searchParams = new URLSearchParams(params);
  const result = await pool.fetch(`${YELP_API_URL}/businesses/search?${searchParams}`);
  if (!result.ok) {
    if (result.exhaustedAllKeys) {
      console.error(`Yelp ALL KEYS EXHAUSTED`);
      return { businesses: [], total: 0, rateLimited: true, status: 429, keyName: result.keyName };
    }
    console.error(`Yelp error [${result.status}] key=${result.keyName}: ${typeof result.body === "string" ? result.body : JSON.stringify(result.body)}`);
    return { businesses: [], total: 0, rateLimited: result.rateLimited, status: result.status, keyName: result.keyName };
  }
  const data = result.body;
  return { businesses: data.businesses || [], total: data.total || 0, status: 200, keyName: result.keyName };
}

/** Paginate a single query, collecting up to 240 results */
async function paginateQuery(
  pool: YelpKeyPool,
  baseParams: Record<string, string>,
  ids: Set<string>,
): Promise<number> {
  let queriesMade = 0;
  let offset = 0;
  while (offset < YELP_MAX_RESULTS) {
    const params = { ...baseParams, limit: String(YELP_PAGE_LIMIT), offset: String(offset) };
    const { businesses, total } = await yelpSearch(pool, params);
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
async function probePriceTiers(pool: YelpKeyPool, location: string) {
  const totals: Record<string, number> = {};
  let needsPhase2 = false;
  for (const price of PRICE_TIERS) {
    const { total } = await yelpSearch(pool, {
      location, categories: "restaurants", price, limit: "1", offset: "0",
    });
    totals[`${"$".repeat(Number(price))}`] = total;
    if (total > YELP_MAX_RESULTS) needsPhase2 = true;
  }
  const { total: allTotal } = await yelpSearch(pool, {
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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing required Supabase env vars" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Initialize Supabase + Yelp key pool (rotates across YELP_API_KEY, YELP_API_KEY_2, ...)
    const supabaseGlobal = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const pool = new YelpKeyPool(supabaseGlobal);
    try {
      await pool.load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load Yelp keys";
      return new Response(
        JSON.stringify({ error: msg }),
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
    //   "key_status" — returns the current pool state (which keys are exhausted, when they reset)

    // === KEY STATUS ===
    if (mode === "key_status") {
      return new Response(JSON.stringify({ provider: "yelp", keys: pool.status() }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === PROBE ===
    if (mode === "probe") {
      const cities = body.cities || SE_MICHIGAN_CITIES;
      const results: any[] = [];
      for (const city of cities) {
        const { totals, needsPhase2 } = await probePriceTiers(pool, city);
        results.push({ city, totals, needsPhase2 });
      }
      return new Response(JSON.stringify(results), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === GRID === geographic lat/lng slicing to bypass Yelp's per-query 1000 cap.
    // Each grid cell is queried as an independent latitude/longitude+radius search,
    // optionally multiplied by price tiers. With no `cell` index, returns the plan.
    if (mode === "grid") {
      const gridCity = body.city;
      if (!gridCity) {
        return new Response(JSON.stringify({ error: "city required for grid mode" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const bbox = CITY_BBOXES[gridCity];
      if (!bbox) {
        return new Response(JSON.stringify({
          error: `No bounding box defined for "${gridCity}"`,
          available_cities: Object.keys(CITY_BBOXES),
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const gridSize = Math.max(2, Math.min(8, Number(body.gridSize) || 4));
      const withPrices = Boolean(body.withPrices);
      const cells = buildGrid(bbox, gridSize);

      // Plan mode: return list of invocations to run
      if (body.cell === undefined || body.cell === null) {
        const plan: any[] = [];
        for (let i = 0; i < cells.length; i++) {
          if (withPrices) {
            for (const p of PRICE_TIERS) plan.push({ cell: i, price: p });
            plan.push({ cell: i, price: "none" });
          } else {
            plan.push({ cell: i });
          }
        }
        return new Response(JSON.stringify({
          city: gridCity, mode: "grid", gridSize, withPrices,
          total_cells: cells.length,
          total_invocations: plan.length,
          cells,
          plan,
          example: { mode: "grid", city: gridCity, gridSize, withPrices, cell: 0 },
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Execute one cell (optionally one price tier)
      const cellIdx = Number(body.cell);
      if (!Number.isFinite(cellIdx) || cellIdx < 0 || cellIdx >= cells.length) {
        return new Response(JSON.stringify({ error: `Invalid cell index ${body.cell}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const c = cells[cellIdx];
      const supabaseGrid = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const { data: existingRowsGrid } = await supabaseGrid
        .from("restaurant_sightings")
        .select("yelp_id")
        .eq("city", gridCity);
      const existingIdsGrid = new Set((existingRowsGrid || []).map((r: any) => r.yelp_id));

      const cellIds = new Set<string>();
      const baseParams: Record<string, string> = {
        latitude: String(c.lat),
        longitude: String(c.lng),
        radius: String(c.radius),
        categories: "restaurants",
        sort_by: "best_match",
      };
      if (body.price && body.price !== "none") baseParams.price = String(body.price);

      const queries = await paginateQuery(pool, baseParams, cellIds);
      const allIds = [...cellIds];
      const { newCount, dbErrors } = await persistIds(supabaseGrid, allIds, gridCity, existingIdsGrid);

      return new Response(JSON.stringify({
        success: true, city: gridCity, mode: "grid", cell: cellIdx,
        cell_center: { lat: c.lat, lng: c.lng, radius: c.radius },
        price: body.price || "all",
        unique_ids_in_cell: cellIds.size,
        new_to_db: newCount,
        queries,
        db_errors: dbErrors,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // === TAIL === narrow slices sorted by review_count DESC, paginate to the last
    // reachable page (offset 950) to capture the lowest-review-count restaurants.
    // Slice = grid cell × price tier × category. Each slice ideally has <1000 total
    // results so the tail page actually contains the lowest-reviewed in that slice.
    if (mode === "tail") {
      const tailCity = body.city;
      if (!tailCity) {
        return new Response(JSON.stringify({ error: "city required for tail mode" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const bbox = CITY_BBOXES[tailCity];
      if (!bbox) {
        return new Response(JSON.stringify({
          error: `No bounding box defined for "${tailCity}"`,
          available_cities: Object.keys(CITY_BBOXES),
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const gridSize = Math.max(2, Math.min(8, Number(body.gridSize) || 4));
      const cells = buildGrid(bbox, gridSize);
      const tailCategories: string[] = body.categories || CATEGORIES;
      const tailPrices: string[] = body.prices || [...PRICE_TIERS, "none"];
      // How many pages from the END to fetch per slice (each page = 50 results).
      // Default 4 pages = 200 lowest-review-count businesses per reachable slice.
      const tailPages = Math.max(1, Math.min(20, Number(body.tailPages) || 4));

      // Plan mode: enumerate slices
      if (body.cell === undefined || body.cell === null) {
        const plan: any[] = [];
        for (let i = 0; i < cells.length; i++) {
          for (const p of tailPrices) {
            for (const cat of tailCategories) {
              plan.push({ cell: i, price: p, category: cat });
            }
          }
        }
        return new Response(JSON.stringify({
          city: tailCity, mode: "tail", gridSize, tailPages,
          total_cells: cells.length,
          categories: tailCategories,
          prices: tailPrices,
          total_invocations: plan.length,
          example: { mode: "tail", city: tailCity, gridSize, tailPages, cell: 0, price: "1", category: "restaurants" },
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Execute one slice: cell + price + category, sorted by review_count desc, tail pages
      const cellIdx = Number(body.cell);
      if (!Number.isFinite(cellIdx) || cellIdx < 0 || cellIdx >= cells.length) {
        return new Response(JSON.stringify({ error: `Invalid cell index ${body.cell}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const c = cells[cellIdx];
      const supabaseTail = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const { data: existingRowsTail } = await supabaseTail
        .from("restaurant_sightings")
        .select("yelp_id")
        .eq("city", tailCity);
      const existingIdsTail = new Set((existingRowsTail || []).map((r: any) => r.yelp_id));

      const baseParams: Record<string, string> = {
        latitude: String(c.lat),
        longitude: String(c.lng),
        radius: String(c.radius),
        categories: String(body.category || "restaurants"),
        sort_by: "review_count",
      };
      if (body.price && body.price !== "none") baseParams.price = String(body.price);

      // First, probe total to know where the tail starts.
      const probe = await yelpSearch(pool, { ...baseParams, limit: "1", offset: "0" });
      const reportedTotal = probe.total;
      const total = Math.min(reportedTotal, YELP_MAX_RESULTS);
      const tailIds = new Set<string>();
      let queries = 1;
      let lowestReviewCount = Number.POSITIVE_INFINITY;
      let highestReviewCount = 0;
      const debugPages: any[] = [];
      const sliceTag = `tail[${tailCity} c${cellIdx} p=${body.price || "all"} cat=${body.category || "restaurants"}]`;

      console.log(`${sliceTag} probe.total=${reportedTotal} clamped=${total} status=${probe.status}`);

      // Surface rate-limit explicitly so callers don't mistake throttling for empty slices.
      if (probe.rateLimited) {
        console.warn(`${sliceTag} RATE LIMITED on probe`);
        return new Response(JSON.stringify({
          success: false, rate_limited: true, city: tailCity, mode: "tail", cell: cellIdx,
          price: body.price || "all", category: body.category || "restaurants",
          message: "Yelp returned 429 ACCESS_LIMIT_REACHED on probe. Daily quota exhausted.",
        }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (total === 0) {
        console.log(`${sliceTag} EMPTY slice (probe returned 0)`);
        return new Response(JSON.stringify({
          success: true, city: tailCity, mode: "tail", cell: cellIdx,
          price: body.price || "all", category: body.category || "restaurants",
          slice_total: 0, unique_ids: 0, new_to_db: 0, queries,
          debug: { reported_total: reportedTotal, pages: [] },
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Compute starting offset for the tail. If the slice is small (< desired fetch),
      // start at 0 and walk through everything.
      const desiredFetch = tailPages * YELP_PAGE_LIMIT;
      let startOffset = Math.max(0, total - desiredFetch);
      // Align to page boundary
      let alignedStart = Math.floor(startOffset / YELP_PAGE_LIMIT) * YELP_PAGE_LIMIT;

      // Yelp can report a `total` that exceeds what is actually paginatable. If our
      // computed start returns empty, walk DOWN by one page at a time until we hit data.
      // This is the "fall back to progressively lower offsets" behavior.
      let actualStart = alignedStart;
      while (actualStart > 0) {
        const probeParams = { ...baseParams, limit: String(YELP_PAGE_LIMIT), offset: String(actualStart) };
        const r = await yelpSearch(pool, probeParams);
        queries++;
        debugPages.push({ offset: actualStart, returned: r.businesses.length, phase: "probe-tail-start" });
        console.log(`${sliceTag} probe-tail-start offset=${actualStart} returned=${r.businesses.length}`);
        if (r.businesses.length > 0) {
          // Found a non-empty page: ingest and break out to forward walk
          for (const biz of r.businesses) {
            tailIds.add(biz.id);
            const rc = Number(biz.review_count) || 0;
            if (rc < lowestReviewCount) lowestReviewCount = rc;
            if (rc > highestReviewCount) highestReviewCount = rc;
          }
          // Continue from the NEXT page after this one
          actualStart += r.businesses.length;
          break;
        }
        // Empty: step down one page and retry
        actualStart = Math.max(0, actualStart - YELP_PAGE_LIMIT);
        await new Promise((r) => setTimeout(r, 80));
      }

      // Now walk forward collecting remaining pages until empty or we hit the cap.
      for (let offset = actualStart; offset < YELP_MAX_RESULTS; offset += YELP_PAGE_LIMIT) {
        const params = { ...baseParams, limit: String(YELP_PAGE_LIMIT), offset: String(offset) };
        const { businesses } = await yelpSearch(pool, params);
        queries++;
        debugPages.push({ offset, returned: businesses.length, phase: "forward" });
        if (businesses.length === 0) {
          console.log(`${sliceTag} forward offset=${offset} EMPTY — stopping`);
          break;
        }
        for (const biz of businesses) {
          tailIds.add(biz.id);
          const rc = Number(biz.review_count) || 0;
          if (rc < lowestReviewCount) lowestReviewCount = rc;
          if (rc > highestReviewCount) highestReviewCount = rc;
        }
        await new Promise((r) => setTimeout(r, 80));
      }

      console.log(`${sliceTag} done unique=${tailIds.size} low=${lowestReviewCount === Number.POSITIVE_INFINITY ? "n/a" : lowestReviewCount} high=${highestReviewCount} queries=${queries}`);

      const allIds = [...tailIds];
      const { newCount, dbErrors } = await persistIds(supabaseTail, allIds, tailCity, existingIdsTail);

      return new Response(JSON.stringify({
        success: true, city: tailCity, mode: "tail", cell: cellIdx,
        cell_center: { lat: c.lat, lng: c.lng, radius: c.radius },
        price: body.price || "all",
        category: body.category || "restaurants",
        slice_total: total,
        reported_total: reportedTotal,
        tail_start_offset_planned: alignedStart,
        tail_start_offset_actual: actualStart,
        unique_ids: tailIds.size,
        new_to_db: newCount,
        lowest_review_count: lowestReviewCount === Number.POSITIVE_INFINITY ? null : lowestReviewCount,
        highest_review_count: highestReviewCount,
        queries,
        db_errors: dbErrors,
        debug_pages: debugPages,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // === DISCOVER === Progressive offset fallback to find ONE new restaurant per city
    // with the LEAST reviews. Strategy:
    //   1. Probe total for the city (sort_by=review_count is desc; the tail is least-reviewed).
    //   2. Start at the last reachable page and walk DOWN (toward more-reviewed) one page
    //      at a time, scanning each page for the first yelp_id not in restaurant_sightings.
    //   3. Stop and return as soon as a new id is found, or after the page budget is hit.
    // Stateless: always restarts from the tail. Relies on dedup via restaurant_sightings.
    if (mode === "discover") {
      const discoverCities: string[] = body.cities || (body.city ? [body.city] : SE_MICHIGAN_CITIES);
      const maxPagesPerCity = Math.max(1, Math.min(20, Number(body.maxPages) || 5));
      const category = String(body.category || "restaurants");
      const supabaseDisc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const results: any[] = [];
      let allKeysExhausted = false;

      for (const dCity of discoverCities) {
        if (allKeysExhausted) {
          results.push({ city: dCity, skipped: true, reason: "all_keys_exhausted" });
          continue;
        }

        // Pull existing yelp_ids for dedup
        const { data: existRows } = await supabaseDisc
          .from("restaurant_sightings")
          .select("yelp_id")
          .eq("city", dCity);
        const existing = new Set((existRows || []).map((r: any) => r.yelp_id));

        const baseParams: Record<string, string> = {
          location: dCity,
          categories: category,
          sort_by: "review_count", // Yelp: desc only — tail = least reviewed
        };

        // Probe to learn the total (capped at Yelp's 1000 reachable)
        const probe = await yelpSearch(pool, { ...baseParams, limit: "1", offset: "0" });
        if (probe.rateLimited) {
          allKeysExhausted = true;
          results.push({ city: dCity, rate_limited: true, status: probe.status });
          continue;
        }
        const reportedTotal = probe.total;
        const total = Math.min(reportedTotal, YELP_MAX_RESULTS);
        if (total === 0) {
          results.push({ city: dCity, reported_total: 0, found: null, queries: 1 });
          continue;
        }

        // Start at the last reachable page boundary
        let offset = Math.floor((total - 1) / YELP_PAGE_LIMIT) * YELP_PAGE_LIMIT;
        let queries = 1;
        let found: any = null;
        let pagesWalked = 0;
        const visitedOffsets: number[] = [];
        const tag = `discover[${dCity}]`;

        while (offset >= 0 && pagesWalked < maxPagesPerCity) {
          const page = await yelpSearch(pool, {
            ...baseParams, limit: String(YELP_PAGE_LIMIT), offset: String(offset),
          });
          queries++;
          pagesWalked++;
          visitedOffsets.push(offset);

          if (page.rateLimited) {
            console.warn(`${tag} RATE LIMITED at offset=${offset}`);
            allKeysExhausted = true;
            break;
          }

          console.log(`${tag} offset=${offset} returned=${page.businesses.length}`);

          // Walk businesses from END of page (lowest review_count first since desc sort)
          for (let i = page.businesses.length - 1; i >= 0; i--) {
            const biz = page.businesses[i];
            if (!existing.has(biz.id)) {
              found = {
                yelp_id: biz.id,
                name: biz.name,
                review_count: biz.review_count,
                rating: biz.rating,
                offset_found_at: offset,
                index_in_page: i,
              };
              break;
            }
          }
          if (found) break;
          offset -= YELP_PAGE_LIMIT;
          await new Promise((r) => setTimeout(r, 80));
        }

        // Persist the find so subsequent runs skip it
        if (found) {
          const tenYearsAgo = new Date();
          tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
          const { error: upErr } = await supabaseDisc
            .from("restaurant_sightings")
            .upsert(
              {
                yelp_id: found.yelp_id,
                city: dCity,
                first_seen_at: new Date().toISOString(),
                is_new_discovery: true,
              },
              { onConflict: "yelp_id", ignoreDuplicates: true },
            );
          if (upErr) console.error(`${tag} persist error:`, upErr.message);
        }

        results.push({
          city: dCity,
          reported_total: reportedTotal,
          reachable_total: total,
          existing_in_db: existing.size,
          pages_walked: pagesWalked,
          visited_offsets: visitedOffsets,
          queries,
          found,
        });
      }

      return new Response(JSON.stringify({
        mode: "discover",
        cities_processed: results.length,
        all_keys_exhausted: allKeysExhausted,
        results,
        yelpKeys: pool.status(),
      }), {
        status: allKeysExhausted ? 429 : 200,
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
    const { totals, needsPhase2 } = await probePriceTiers(pool, city);

    // If Phase 1 is enough, just do it all
    if (!needsPhase2) {
      const cityIds = new Set<string>();
      let q = 0;
      for (const price of PRICE_TIERS) {
        q += await paginateQuery(pool, { location: city, categories: "restaurants", price, sort_by: "best_match" }, cityIds);
      }
      q += await paginateQuery(pool, { location: city, categories: "restaurants", sort_by: "best_match" }, cityIds);

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

    const q = await paginateQuery(pool, baseParams, cityIds);
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
