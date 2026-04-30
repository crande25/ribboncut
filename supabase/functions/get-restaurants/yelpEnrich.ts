// For each (post-filter) sighting, either serve from cache or fetch live
// Yelp details via the rotating key pool. On Yelp success, lazy-write
// missing cache rows. On Yelp failure, fall back to cache (or null).
// Tombstones permanently-unavailable Yelp businesses so we stop re-fetching
// them on every refresh.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { YelpKeyPool } from "../_shared/yelpKeyPool.ts";
import type { SightingRow } from "./sightingsQuery.ts";
import { buildFromCache, CacheBundle, isCacheUsable } from "./cache.ts";

const YELP_API_URL = "https://api.yelp.com/v3";

/** Lazy-write category cache when we have fresh Yelp data. */
function lazyWriteCategories(supabase: SupabaseClient, sighting: SightingRow, biz: any) {
  const aliases = (biz.categories || []).map((c: any) => String(c.alias || "").toLowerCase()).filter(Boolean);
  const titles = (biz.categories || []).map((c: any) => String(c.title || "")).filter(Boolean);
  supabase
    .from("restaurant_categories")
    .upsert(
      { yelp_id: sighting.yelp_id, aliases, titles, updated_at: new Date().toISOString() },
      { onConflict: "yelp_id" },
    )
    .then(({ error }: { error: any }) => {
      if (error) console.error(`[get-restaurants] lazy categories upsert failed ${sighting.yelp_id}: ${error.message}`);
    });
}

/** Lazy-write metrics + display fields when missing or incomplete (no cached name). */
function lazyWriteMetrics(supabase: SupabaseClient, sighting: SightingRow, biz: any) {
  const priceLevel = typeof biz.price === "string" && biz.price.length > 0 ? biz.price.length : null;
  const displayAddress = Array.isArray(biz.location?.display_address)
    ? biz.location.display_address.join(", ")
    : null;
  supabase
    .from("restaurant_metrics")
    .upsert(
      {
        yelp_id: sighting.yelp_id,
        price_level: priceLevel,
        rating: typeof biz.rating === "number" ? biz.rating : null,
        review_count: typeof biz.review_count === "number" ? biz.review_count : null,
        name: typeof biz.name === "string" ? biz.name : null,
        image_url: typeof biz.image_url === "string" ? biz.image_url : null,
        address: displayAddress,
        phone: typeof biz.display_phone === "string" ? biz.display_phone : null,
        url: typeof biz.url === "string" ? biz.url : null,
        coordinates: biz.coordinates && typeof biz.coordinates === "object" ? biz.coordinates : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "yelp_id" },
    )
    .then(({ error }: { error: any }) => {
      if (error) console.error(`[get-restaurants] lazy metrics upsert failed ${sighting.yelp_id}: ${error.message}`);
    });
}

/** Tombstone permanently-unavailable Yelp businesses (403 BUSINESS_UNAVAILABLE). */
function tombstoneUnavailable(supabase: SupabaseClient, sighting: SightingRow) {
  supabase
    .from("restaurant_sightings")
    .update({ yelp_unavailable_at: new Date().toISOString() })
    .eq("yelp_id", sighting.yelp_id)
    .then(({ error }: { error: any }) => {
      if (error) console.error(`[get-restaurants] tombstone failed for ${sighting.yelp_id}: ${error.message}`);
      else console.log(`[get-restaurants] tombstoned ${sighting.yelp_id} (BUSINESS_UNAVAILABLE)`);
    });
}

export interface EnrichStats {
  cacheHits: number;
  yelpFetches: number;
}

/** Enrich a single sighting — cache hit, Yelp fetch, or degraded fallback. */
async function enrichOne(
  sighting: SightingRow,
  supabase: SupabaseClient,
  pool: YelpKeyPool,
  cache: CacheBundle,
  stats: EnrichStats,
) {
  if (isCacheUsable(sighting.yelp_id, cache)) {
    stats.cacheHits++;
    return buildFromCache(sighting, cache);
  }

  try {
    stats.yelpFetches++;
    const detailRes = await pool.fetch(`${YELP_API_URL}/businesses/${sighting.yelp_id}`);

    if (!detailRes.ok) {
      if (detailRes.exhaustedAllKeys) {
        console.error(`[get-restaurants] Yelp ALL KEYS EXHAUSTED for ${sighting.yelp_id} — using cache fallback`);
      } else {
        console.error(`[get-restaurants] Yelp detail error for ${sighting.yelp_id}: status=${detailRes.status} key=${detailRes.keyName} — using cache fallback`);
      }
      const bodyStr = typeof detailRes.body === "string"
        ? detailRes.body
        : JSON.stringify(detailRes.body || {});
      if (detailRes.status === 403 && bodyStr.includes("BUSINESS_UNAVAILABLE")) {
        tombstoneUnavailable(supabase, sighting);
      }
      return buildFromCache(sighting, cache);
    }

    const biz = detailRes.body;

    if (!cache.categoryMap.has(sighting.yelp_id)) {
      lazyWriteCategories(supabase, sighting, biz);
    }
    const existingMetrics = cache.metricsMap.get(sighting.yelp_id);
    if (!existingMetrics || !existingMetrics.name) {
      lazyWriteMetrics(supabase, sighting, biz);
    }

    const cachedAtmosphere = cache.atmosphereMap.get(sighting.yelp_id);
    const categories = (biz.categories || []).map((c: any) => c.title).join(", ");
    const fallbackAtmosphere = `${categories}${biz.price ? ` · ${biz.price}` : ""}`;

    return {
      id: biz.id,
      name: biz.name,
      city: sighting.city,
      cuisine: categories,
      priceRange: biz.price || "$",
      imageUrl: biz.image_url || "",
      rating: biz.rating,
      reviewCount: biz.review_count,
      address: biz.location?.display_address?.join(", ") || "",
      phone: biz.display_phone || "",
      url: biz.url || "",
      photos: biz.photos || [biz.image_url],
      hours: biz.hours || [],
      coordinates: biz.coordinates,
      firstSeenAt: sighting.first_seen_at,
      atmosphereSummary: cachedAtmosphere || fallbackAtmosphere,
    };
  } catch (err) {
    console.error(`[get-restaurants] error fetching ${sighting.yelp_id}:`, err);
    return buildFromCache(sighting, cache);
  }
}

/** Enrich all sightings in parallel and return the stats + non-null restaurants. */
export async function enrichSightings(
  sightings: SightingRow[],
  supabase: SupabaseClient,
  pool: YelpKeyPool,
  cache: CacheBundle,
): Promise<{ restaurants: any[]; stats: EnrichStats }> {
  const stats: EnrichStats = { cacheHits: 0, yelpFetches: 0 };
  const results = await Promise.all(
    sightings.map((s) => enrichOne(s, supabase, pool, cache, stats)),
  );
  return { restaurants: results.filter(Boolean), stats };
}
