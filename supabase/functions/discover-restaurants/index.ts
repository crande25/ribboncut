import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { YelpKeyPool } from "./yelpKeys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const YELP_API_URL = "https://api.yelp.com/v3";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing required Supabase env vars" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Init Yelp key pool (rotates across YELP_API_KEY, YELP_API_KEY_2, ...)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const pool = new YelpKeyPool(supabase);
    try {
      await pool.load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load Yelp keys";
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const location = url.searchParams.get("location");
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 50);
    const openedSince = url.searchParams.get("opened_since"); // ISO date string
    const dietaryCategories = url.searchParams.get("categories"); // comma-separated dietary filters

    if (!location) {
      return new Response(
        JSON.stringify({ error: "location parameter is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Search for restaurants, sorted by newest
    // Build categories: always include restaurants, plus any dietary filters
    const baseCategories = ["restaurants"];
    if (dietaryCategories) {
      baseCategories.push(...dietaryCategories.split(",").map((c: string) => c.trim()));
    }

    const params = new URLSearchParams({
      location,
      term: "restaurants",
      sort_by: "best_match",
      limit: String(limit),
      offset: String(offset),
      categories: baseCategories.join(","),
    });

    // Yelp's open_at only accepts timestamps within the last 2 weeks.
    if (openedSince) {
      const sinceDate = new Date(openedSince);
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      if (sinceDate > twoWeeksAgo) {
        const ts = Math.floor(sinceDate.getTime() / 1000);
        params.set("open_at", String(ts));
        params.delete("sort_by");
      }
    }

    const searchRes = await pool.fetch(`${YELP_API_URL}/businesses/search?${params.toString()}`);
    if (!searchRes.ok) {
      if (searchRes.exhaustedAllKeys) {
        console.error("Yelp ALL KEYS EXHAUSTED");
        return new Response(
          JSON.stringify({ error: "All Yelp API keys exhausted", keys: pool.status() }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const bodyStr = typeof searchRes.body === "string" ? searchRes.body : JSON.stringify(searchRes.body);
      console.error(`Yelp search error [${searchRes.status}] key=${searchRes.keyName}: ${bodyStr}`);
      return new Response(
        JSON.stringify({ error: `Yelp API error: ${searchRes.status}` }),
        { status: searchRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = searchRes.body;

    // Transform Yelp data to our app's format
    const restaurants = (data.businesses || []).map((biz: any) => ({
      id: biz.id,
      name: biz.name,
      city: `${biz.location?.city || ""}, ${biz.location?.state || ""}`,
      cuisine: (biz.categories || []).map((c: any) => c.title).join(", "),
      priceRange: biz.price || "$",
      imageUrl: biz.image_url || "",
      rating: biz.rating,
      reviewCount: biz.review_count,
      address: biz.location?.display_address?.join(", ") || "",
      phone: biz.display_phone || "",
      url: biz.url || "",
      coordinates: biz.coordinates,
    }));

    // Enrich first few with detail fetches (photos, hours) via the pool
    const enrichedRestaurants = await Promise.all(
      restaurants.slice(0, Math.min(restaurants.length, 5)).map(async (r: any) => {
        try {
          const detailRes = await pool.fetch(`${YELP_API_URL}/businesses/${r.id}`);
          if (detailRes.ok) {
            const detail = detailRes.body;
            return {
              ...r,
              photos: detail.photos || [r.imageUrl],
              hours: detail.hours || [],
            };
          }
          return { ...r, photos: [r.imageUrl], hours: [] };
        } catch {
          return { ...r, photos: [r.imageUrl], hours: [] };
        }
      })
    );

    // For remaining restaurants (not enriched), just add defaults
    const remaining = restaurants.slice(5).map((r: any) => ({
      ...r,
      photos: [r.imageUrl],
      hours: [],
    }));

    return new Response(
      JSON.stringify({
        restaurants: [...enrichedRestaurants, ...remaining],
        total: data.total || 0,
        offset,
        limit,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error in discover-restaurants:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
