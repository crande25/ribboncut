// Pure mappers + helpers for the restaurant feed. Extracted from
// RestaurantFeed.tsx so they can be unit-tested without React.

import type { RestaurantResult } from "@/lib/api";
import { mockRestaurants, type Restaurant } from "@/lib/mockData";

/** Shape an API row into the UI's Restaurant type. */
export function mapToRestaurant(r: RestaurantResult): Restaurant {
  return {
    id: r.id,
    name: r.name,
    city: r.city,
    imageUrl: r.imageUrl || r.photos?.[0] || "",
    foodSummary: r.cuisine,
    atmosphereSummary:
      (r as any).atmosphereSummary || `${r.cuisine} · ${r.priceRange || ""}`.replace(/ · $/, ""),
    openedDate: r.firstSeenAt || new Date().toISOString(),
    cuisine: r.cuisine,
    priceRange: r.priceRange,
    rating: r.rating,
    reviewCount: r.reviewCount,
    address: r.address,
    phone: r.phone,
    url: r.url,
    photos: r.photos,
  };
}

/** Build the offline mock-data fallback shown when the live API can't be reached. */
export function buildMockFallback(selectedCities: string[]): Restaurant[] {
  const filtered = mockRestaurants.filter((r) =>
    selectedCities.some((c) => r.city.toLowerCase().includes(c.split(",")[0].toLowerCase())),
  );
  filtered.sort((a, b) => new Date(b.openedDate).getTime() - new Date(a.openedDate).getTime());
  return filtered;
}
