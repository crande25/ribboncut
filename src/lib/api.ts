export interface PlacesRestaurant {
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
  hours: string[];
  coordinates?: { latitude: number; longitude: number };
  openingDate: string | null;
}

export interface DiscoverResponse {
  restaurants: PlacesRestaurant[];
  total: number;
  nextPageToken?: string | null;
}

export async function discoverRestaurants(
  location: string,
  openedSince?: string,
  pageToken?: string
): Promise<DiscoverResponse> {
  const params: Record<string, string> = { location };
  if (openedSince) params.opened_since = openedSince;
  if (pageToken) params.page_token = pageToken;

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
