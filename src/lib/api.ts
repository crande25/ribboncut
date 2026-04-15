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
  dietaryFilters?: string[]
): Promise<GetRestaurantsResponse> {
  const params: Record<string, string> = {
    offset: String(offset),
    limit: String(limit),
  };
  if (cities.length > 0) {
    params.cities = cities.join(",");
  }
  if (openedSince) {
    params.opened_since = openedSince;
  }
  if (dietaryFilters && dietaryFilters.length > 0) {
    params.categories = dietaryFilters.join(",");
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
