// get-restaurants — paginated feed for the RibbonCut UI.
//
// Orchestrator only. The actual work lives in sibling modules:
//   params.ts          query-string parsing + validation
//   sightingsQuery.ts  PostgREST URL builder + page fetcher
//   cache.ts           batch loaders for the three lookup caches
//   prefilter.ts       lodging / dietary / price / rating filters
//   vibeBackfill.ts    inline blocking generation of missing vibes
//   yelpEnrich.ts      per-sighting Yelp fetch + lazy cache writes
//
// Architecture: hybrid. The DB owns "first_seen_at" (what makes a sighting
// new); Yelp owns metadata (name, image, hours, etc.) which we cache
// opportunistically. Periodic refresh of metrics/categories/vibes is the
// refresh-metrics job's responsibility, NOT this function's.

import { YelpKeyPool } from "../_shared/yelpKeyPool.ts";
import { handleOptions, jsonResponse, getServiceClientOr500 } from "../_shared/http.ts";
import { parseQueryParams } from "./params.ts";
import { fetchSightingsPage } from "./sightingsQuery.ts";
import { loadCacheBatches } from "./cache.ts";
import { applyPrefilters } from "./prefilter.ts";
import { backfillMissingVibes } from "./vibeBackfill.ts";
import { enrichSightings } from "./yelpEnrich.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const { client: supabase, error: clientErr } = getServiceClientOr500();
    if (clientErr) return clientErr;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1. Init Yelp key pool (rotates across YELP_API_KEY, YELP_API_KEY_2, ...)
    const pool = new YelpKeyPool(supabase);
    try {
      await pool.load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load Yelp keys";
      return jsonResponse({ error: msg }, 500);
    }

    // 2. Parse + validate query params
    const parsed = parseQueryParams(new URL(req.url));
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);
    const params = parsed.value;

    // 3. Fetch one page of sightings + the unfiltered total
    const pageRes = await fetchSightingsPage(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, params);
    if ("error" in pageRes) {
      return jsonResponse({ error: pageRes.error }, pageRes.status);
    }
    const { sightings, total } = pageRes;

    if (sightings.length === 0) {
      return jsonResponse({ restaurants: [], total, offset: params.offset, limit: params.limit });
    }

    // 4. Batch-load all three caches in parallel
    const cache = await loadCacheBatches(supabase, sightings.map((s) => s.yelp_id));

    // 5. Apply pre-filters (lodging / dietary / price / rating) before paying for Yelp
    const workingSightings = applyPrefilters(sightings, cache, params);

    // 6. Inline backfill of missing vibes (bounded budget — never blocks the feed)
    await backfillMissingVibes(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, workingSightings, cache.atmosphereMap);

    // 7. Enrich each surviving sighting (cache hit, Yelp fetch, or degraded fallback)
    const { restaurants, stats } = await enrichSightings(workingSightings, supabase, pool, cache);

    console.log(
      `[get-restaurants] cache hits=${stats.cacheHits} yelp-fetches=${stats.yelpFetches} ` +
      `(no-TTL: lazy only when fields missing)`
    );

    return jsonResponse({
      restaurants,
      total,
      offset: params.offset,
      limit: params.limit,
    });
  } catch (error: unknown) {
    console.error("[get-restaurants] fatal:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: msg }, 500);
  }
});
