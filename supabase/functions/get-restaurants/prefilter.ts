// Drop sightings that don't satisfy active filters BEFORE paying for Yelp
// detail calls. Includes:
//   1. Lodging-only drop (hotels with onsite restaurants — Yelp surfaces them
//      even with the "restaurants,food" category filter on search). We only
//      drop when we have cached aliases; entries with no cached data yet
//      stay in the working set and get re-evaluated after enrichment.
//   2. Dietary filter — strict: drops anything with no cached aliases.
//   3. Price/rating filters — strict: drops anything with no cached metrics.

import type { SightingRow } from "./sightingsQuery.ts";
import type { CacheBundle } from "./cache.ts";

const NON_RESTAURANT_ALIASES = new Set([
  "hotels", "hotelstravel", "resorts", "bedbreakfast", "guesthouses", "hostels",
]);

export interface PrefilterOptions {
  dietaryCategories: string | null;
  selectedPrices: number[];
  minRating: number;
  hasPriceFilter: boolean;
  hasRatingFilter: boolean;
}

export function applyPrefilters(
  sightings: SightingRow[],
  cache: CacheBundle,
  opts: PrefilterOptions,
): SightingRow[] {
  let working = sightings;

  // 1. Lodging-only drop
  let droppedLodging = 0;
  working = working.filter((s) => {
    const aliases = cache.categoryMap.get(s.yelp_id);
    if (!aliases || aliases.length === 0) return true;
    const lodgingOnly = aliases.every((a) => NON_RESTAURANT_ALIASES.has(a));
    if (lodgingOnly) {
      droppedLodging++;
      return false;
    }
    return true;
  });
  if (droppedLodging > 0) {
    console.log(`[get-restaurants] filter: dropped ${droppedLodging} lodging-only entries`);
  }

  // 2. Dietary filter
  if (opts.dietaryCategories) {
    const filters = opts.dietaryCategories.split(",").map((c) => c.trim().toLowerCase());
    working = working.filter((s) => {
      const aliases = cache.categoryMap.get(s.yelp_id);
      if (!aliases) return false; // strict: exclude unknowns
      return filters.some((f) => aliases.includes(f));
    });
  }

  // 3. Price/rating filters
  if (opts.hasPriceFilter || opts.hasRatingFilter) {
    let droppedNoCache = 0;
    let droppedPredicate = 0;
    working = working.filter((s) => {
      const m = cache.metricsMap.get(s.yelp_id);
      if (!m) { droppedNoCache++; return false; }
      if (opts.hasPriceFilter && (m.price_level === null || !opts.selectedPrices.includes(m.price_level))) {
        droppedPredicate++;
        return false;
      }
      if (opts.hasRatingFilter && (m.rating === null || m.rating < opts.minRating)) {
        droppedPredicate++;
        return false;
      }
      return true;
    });
    console.log(`[get-restaurants] filter: price/rating dropped no-cache=${droppedNoCache} predicate-fail=${droppedPredicate}`);
  }

  return working;
}
