// Batch loaders for the three caches that get-restaurants reads:
//   - atmosphere_cache  (vibe summary string per yelp_id)
//   - restaurant_categories (category aliases per yelp_id)
//   - restaurant_metrics (price/rating/review_count + display fields per yelp_id)
//
// Also exposes:
//   - isCacheUsable: can we skip Yelp for this sighting entirely?
//   - buildFromCache: shape a Restaurant object using cache only (degraded path).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SightingRow } from "./sightingsQuery.ts";

export type MetricsRow = {
  price_level: number | null;
  rating: number | null;
  review_count: number | null;
  name: string | null;
  image_url: string | null;
  address: string | null;
  phone: string | null;
  url: string | null;
  coordinates: any | null;
  updated_at: string | null;
};

export interface CacheBundle {
  atmosphereMap: Map<string, string>;
  categoryMap: Map<string, string[]>;
  metricsMap: Map<string, MetricsRow>;
}

export async function loadCacheBatches(
  supabase: SupabaseClient,
  yelpIds: string[],
): Promise<CacheBundle> {
  const atmosphereMap = new Map<string, string>();
  const categoryMap = new Map<string, string[]>();
  const metricsMap = new Map<string, MetricsRow>();

  if (yelpIds.length === 0) {
    return { atmosphereMap, categoryMap, metricsMap };
  }

  const [{ data: atmosphereData }, { data: categoryData }, { data: metricsData }] = await Promise.all([
    supabase.from("atmosphere_cache").select("yelp_id, atmosphere_summary").in("yelp_id", yelpIds),
    supabase.from("restaurant_categories").select("yelp_id, aliases").in("yelp_id", yelpIds),
    supabase
      .from("restaurant_metrics")
      .select("yelp_id, price_level, rating, review_count, name, image_url, address, phone, url, coordinates, updated_at")
      .in("yelp_id", yelpIds),
  ]);

  for (const row of atmosphereData || []) {
    atmosphereMap.set(row.yelp_id, row.atmosphere_summary);
  }
  for (const row of categoryData || []) {
    categoryMap.set(row.yelp_id, row.aliases || []);
  }
  for (const row of metricsData || []) {
    metricsMap.set(row.yelp_id, {
      price_level: row.price_level,
      rating: row.rating !== null ? Number(row.rating) : null,
      review_count: row.review_count,
      name: row.name,
      image_url: row.image_url,
      address: row.address,
      phone: row.phone,
      url: row.url,
      coordinates: row.coordinates,
      updated_at: row.updated_at,
    });
  }

  return { atmosphereMap, categoryMap, metricsMap };
}

/**
 * Cache usability check: serve from cache when the display fields the card
 * needs are present. NULL price_level / rating are valid cached states (Yelp
 * often omits price for small businesses) — do NOT treat them as cache misses
 * or we'd hit Yelp on every refresh forever. Periodic refresh of
 * price/rating/categories/vibe is owned by the refresh-metrics job.
 */
export function isCacheUsable(yelpId: string, cache: CacheBundle): boolean {
  const m = cache.metricsMap.get(yelpId);
  if (!m) return false;
  if (!m.name || !m.image_url) return false;
  const cats = cache.categoryMap.get(yelpId);
  if (!cats || cats.length === 0) return false;
  return true;
}

/** Build a degraded restaurant from cached data only (used when Yelp is exhausted/failing). */
export function buildFromCache(sighting: SightingRow, cache: CacheBundle) {
  const m = cache.metricsMap.get(sighting.yelp_id);
  if (!m || !m.name) return null;
  const titles = (cache.categoryMap.get(sighting.yelp_id) || []) as string[];
  const cuisine = titles.join(", ");
  const cachedAtmosphere = cache.atmosphereMap.get(sighting.yelp_id);
  const priceRange = m.price_level ? "$".repeat(m.price_level) : "$";
  return {
    id: sighting.yelp_id,
    name: m.name,
    city: sighting.city,
    cuisine,
    priceRange,
    imageUrl: m.image_url || "",
    rating: m.rating,
    reviewCount: m.review_count,
    address: m.address || "",
    phone: m.phone || "",
    url: m.url || "",
    photos: m.image_url ? [m.image_url] : [],
    hours: [],
    coordinates: m.coordinates || undefined,
    firstSeenAt: sighting.first_seen_at,
    atmosphereSummary: cachedAtmosphere || cuisine || "",
  };
}
