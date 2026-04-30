/**
 * Standard page size for paginated requests against the get-restaurants
 * edge function. The cursor advances by this number against the unfiltered
 * `total` (server-side filters drop results AFTER paging), so callers must
 * use this constant rather than the length of the returned page when
 * computing the next offset.
 */
export const PAGE_SIZE = 20;

export interface RestaurantResult {
  id: string;
  name: string;
  city: string;
  cuisine: string;
  priceRange: string;
  imageUrl: string;
  rating: number;
  reviewCount: number;
  address: string;
  phone: string;
  url: string;
  photos: string[];
  hours: any[];
  coordinates?: { latitude: number; longitude: number };
  firstSeenAt: string;
}

export interface GetRestaurantsResponse {
  restaurants: RestaurantResult[];
  total: number;
  offset: number;
  limit: number;
}

export async function getRestaurants(
  cities: string[],
  offset = 0,
  limit = 20,
  openedSince?: string,
  dietaryFilters?: string[],
  priceFilters?: number[],
  minRating?: number,
): Promise<GetRestaurantsResponse> {
  const params: Record<string, string> = {
    offset: String(offset),
    limit: String(limit),
  };
  if (cities.length > 0) {
    params.cities = cities.join("|");
  }
  if (openedSince) {
    params.opened_since = openedSince;
  }
  if (dietaryFilters && dietaryFilters.length > 0) {
    params.categories = dietaryFilters.join(",");
  }
  if (priceFilters && priceFilters.length > 0) {
    params.prices = priceFilters.join(",");
  }
  if (minRating && minRating > 0) {
    params.min_rating = String(minRating);
  }

  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  const queryString = new URLSearchParams(params).toString();
  const url = `${supabaseUrl}/functions/v1/get-restaurants?${queryString}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API error ${response.status}: ${errorBody}`);
  }

  return response.json();
}
