import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const YELP_API_KEY = Deno.env.get("YELP_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!YELP_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing required environment variables" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const url = new URL(req.url);
    const openedSince = url.searchParams.get("opened_since");
    const citiesParam = url.searchParams.get("cities"); // comma-separated
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 50);
    const dietaryCategories = url.searchParams.get("categories"); // comma-separated

    // Build query against our sightings table
    let query = supabase
      .from("restaurant_sightings")
      .select("yelp_id, first_seen_at, city", { count: "exact" })
      .order("first_seen_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (openedSince) {
      query = query.gte("first_seen_at", openedSince);
    }

    if (citiesParam) {
      const cities = citiesParam.split(",").map((c) => c.trim());
      query = query.in("city", cities);
    }

    const { data: sightings, error: dbError, count } = await query;

    if (dbError) {
      console.error("DB query error:", dbError.message);
      return new Response(
        JSON.stringify({ error: "Database query failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!sightings || sightings.length === 0) {
      return new Response(
        JSON.stringify({ restaurants: [], total: count || 0, offset, limit }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch live Yelp details for each sighting
    const restaurants = await Promise.all(
      sightings.map(async (sighting) => {
        try {
          const detailRes = await fetch(
            `${YELP_API_URL}/businesses/${sighting.yelp_id}`,
            {
              headers: {
                Authorization: `Bearer ${YELP_API_KEY}`,
                Accept: "application/json",
              },
            }
          );

          if (!detailRes.ok) {
            console.error(`Yelp detail error for ${sighting.yelp_id}: ${detailRes.status}`);
            return null;
          }

          const biz = await detailRes.json();

          // If dietary filter is set, check categories
          if (dietaryCategories) {
            const filters = dietaryCategories.split(",").map((c) => c.trim().toLowerCase());
            const bizCategories = (biz.categories || []).map((c: any) => c.alias.toLowerCase());
            const hasMatch = filters.some((f) => bizCategories.includes(f));
            if (!hasMatch) return null;
          }

          return {
            id: biz.id,
            name: biz.name,
            city: sighting.city,
            cuisine: (biz.categories || []).map((c: any) => c.title).join(", "),
            priceRange: biz.price || "$",
            imageUrl: biz.image_url || "",
            rating: biz.rating,
            reviewCount: biz.review_count,
            address: biz.location?.display_address?.join(", ") || "",
            phone: biz.display_phone || "",
            url: biz.url || "",
            photos: biz.photos || [biz.image_url],
            hours: biz.hours || [],
            coordinates: biz.coordinates,
            firstSeenAt: sighting.first_seen_at,
          };
        } catch (err) {
          console.error(`Error fetching ${sighting.yelp_id}:`, err);
          return null;
        }
      })
    );

    const filtered = restaurants.filter(Boolean);

    return new Response(
      JSON.stringify({
        restaurants: filtered,
        total: count || 0,
        offset,
        limit,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in get-restaurants:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
