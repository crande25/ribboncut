/**
 * Standard page size for paginated requests against the get-restaurants
 * edge function. The cursor advances by this number against the unfiltered
 * `total` (server-side filters drop results AFTER paging), so callers must
 * use this constant rather than the length of the returned page when
 * computing the next offset.
 */
export const PAGE_SIZE = 20;

/**
 * Raw shape returned by the get-restaurants edge function. Several fields
 * are nullable because Yelp doesn't always provide them (price, rating, and
 * review_count in particular). Display code is responsible for fallbacks.
 */
export interface RestaurantResult {
  id: string;
  name: string;
  city: string;
  cuisine: string;
  priceRange: string | null;
  imageUrl: string;
  rating: number | null;
  reviewCount: number | null;
  address: string;
  phone: string;
  url: string;
  photos: string[];
  hours: unknown[];
  coordinates?: { latitude: number; longitude: number } | null;
  firstSeenAt: string;
  /**
   * AI-generated mood/atmosphere blurb. Backend always returns a string —
   * either a real generated vibe, or a "<categories> · <price>" fallback.
   */
  atmosphereSummary: string;
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
