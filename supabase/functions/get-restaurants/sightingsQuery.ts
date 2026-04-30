// Build the PostgREST URL for restaurant_sightings + execute it.
//
// Separated so it can be unit-tested without a live DB.

import type { GetRestaurantsParams } from "./params.ts";

export interface SightingRow {
  yelp_id: string;
  first_seen_at: string;
  city: string;
}

/** Build the PostgREST URL string for a sightings page query. */
export function buildSightingsUrl(supabaseUrl: string, params: GetRestaurantsParams): string {
  const filters: string[] = [
    `select=yelp_id,first_seen_at,city`,
    `order=first_seen_at.desc`,
    `offset=${params.offset}`,
    `limit=${params.limit}`,
    // Exclude restaurants with future first_seen_at
    `first_seen_at=lte.${new Date().toISOString()}`,
    // Exclude tombstoned (Yelp BUSINESS_UNAVAILABLE) sightings — they will
    // never resolve and just burn API calls on every refresh.
    `yelp_unavailable_at=is.null`,
  ];

  if (params.openedSince) {
    // Already validated as ISO 8601 by parseQueryParams.
    filters.push(`first_seen_at=gte.${encodeURIComponent(params.openedSince)}`);
  }

  if (params.citiesParam) {
    // URL-encode each city token so embedded quotes/&/= cannot break out of
    // the in.(...) filter or inject new PostgREST parameters.
    const cities = params.citiesParam
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0 && c.length <= 100)
      .slice(0, 50);
    if (cities.length > 0) {
      const encoded = cities
        .map((c) => `"${encodeURIComponent(c).replace(/"/g, "%22")}"`)
        .join(",");
      filters.push(`city=in.(${encoded})`);
    }
  }

  return `${supabaseUrl}/rest/v1/restaurant_sightings?${filters.join("&")}`;
}

/** Fetch a page of sightings + the unfiltered total via Content-Range. */
export async function fetchSightingsPage(
  supabaseUrl: string,
  serviceRoleKey: string,
  params: GetRestaurantsParams,
): Promise<{ sightings: SightingRow[]; total: number } | { error: string; status: number }> {
  const dbUrl = buildSightingsUrl(supabaseUrl, params);
  const res = await fetch(dbUrl, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "count=exact",
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("[get-restaurants] PostgREST error:", res.status, errText);
    return { error: "Database query failed", status: 500 };
  }
  const contentRange = res.headers.get("content-range");
  const total = contentRange ? parseInt(contentRange.split("/")[1] || "0", 10) : 0;
  const sightings = (await res.json()) as SightingRow[];
  return { sightings: sightings || [], total };
}
