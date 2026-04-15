export interface YelpRestaurant {
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
}

export interface DiscoverResponse {
  restaurants: YelpRestaurant[];
  total: number;
  offset: number;
  limit: number;
}

export async function discoverRestaurants(
  location: string,
  offset = 0,
  limit = 20,
  dietaryFilters?: string[]
): Promise<DiscoverResponse> {
  const params: Record<string, string> = {
    location,
    offset: String(offset),
    limit: String(limit),
  };
  if (dietaryFilters && dietaryFilters.length > 0) {
    params.categories = dietaryFilters.join(",");
  }

  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  const queryString = new URLSearchParams(params).toString();
  const url = `${supabaseUrl}/functions/v1/discover-restaurants?${queryString}`;

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
