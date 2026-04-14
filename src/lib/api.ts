import { supabase } from "@/integrations/supabase/client";

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
  openedSince?: string
): Promise<DiscoverResponse> {
  const params: Record<string, string> = {
    location,
    offset: String(offset),
    limit: String(limit),
  };
  if (openedSince) {
    params.opened_since = openedSince;
  }

  const { data, error } = await supabase.functions.invoke("discover-restaurants", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    body: undefined,
  });

  // supabase.functions.invoke doesn't support query params natively for GET,
  // so we'll use fetch directly with the project URL
  const projectId = import.meta.env.VITE_SUPABASE_URL?.replace("https://", "").split(".")[0];
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const queryString = new URLSearchParams(params).toString();
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/discover-restaurants?${queryString}`;

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
