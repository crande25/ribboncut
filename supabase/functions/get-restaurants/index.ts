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
        JSON.stringify({ error: "Missing required environment variables" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Init Yelp key pool (rotates across YELP_API_KEY, YELP_API_KEY_2, ...)
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
    const openedSince = url.searchParams.get("opened_since");
    const citiesParam = url.searchParams.get("cities");
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 50);
    const dietaryCategories = url.searchParams.get("categories");

    // Build PostgREST query
    const filters: string[] = [];
    filters.push(`select=yelp_id,first_seen_at,city`);
    filters.push(`order=first_seen_at.desc`);
    filters.push(`offset=${offset}`);
    filters.push(`limit=${limit}`);

    // Exclude restaurants with future first_seen_at
    filters.push(`first_seen_at=lte.${new Date().toISOString()}`);

    if (openedSince) {
      filters.push(`first_seen_at=gte.${openedSince}`);
    }
    if (citiesParam) {
      const cities = citiesParam.split("|").map((c) => c.trim());
      filters.push(`city=in.(${cities.map((c) => `"${c}"`).join(",")})`);
    }

    const dbUrl = `${SUPABASE_URL}/rest/v1/restaurant_sightings?${filters.join("&")}`;

    const dbRes = await fetch(dbUrl, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "count=exact",
      },
    });

    if (!dbRes.ok) {
      const errText = await dbRes.text();
      console.error("PostgREST error:", dbRes.status, errText);
      return new Response(
        JSON.stringify({ error: "Database query failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contentRange = dbRes.headers.get("content-range");
    const total = contentRange ? parseInt(contentRange.split("/")[1] || "0", 10) : 0;
    const sightings = await dbRes.json();

    if (!sightings || sightings.length === 0) {
      return new Response(
        JSON.stringify({ restaurants: [], total, offset, limit }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Batch-fetch atmosphere cache for all yelp_ids
    const yelpIds = sightings.map((s: any) => s.yelp_id);
    const { data: atmosphereData } = await supabase
      .from("atmosphere_cache")
      .select("yelp_id, atmosphere_summary")
      .in("yelp_id", yelpIds);

    const atmosphereMap = new Map<string, string>();
    for (const row of atmosphereData || []) {
      atmosphereMap.set(row.yelp_id, row.atmosphere_summary);
    }

    // Fetch live Yelp details for each sighting via the rotating key pool
    const restaurants = await Promise.all(
      sightings.map(async (sighting: any) => {
        try {
          const detailRes = await pool.fetch(`${YELP_API_URL}/businesses/${sighting.yelp_id}`);

          if (!detailRes.ok) {
            if (detailRes.exhaustedAllKeys) {
              console.error(`Yelp ALL KEYS EXHAUSTED while fetching ${sighting.yelp_id}`);
            } else {
              console.error(`Yelp detail error for ${sighting.yelp_id}: status=${detailRes.status} key=${detailRes.keyName}`);
            }
            return null;
          }

          const biz = detailRes.body;

          if (dietaryCategories) {
            const filters = dietaryCategories.split(",").map((c) => c.trim().toLowerCase());
            const bizCategories = (biz.categories || []).map((c: any) => c.alias.toLowerCase());
            const hasMatch = filters.some((f) => bizCategories.includes(f));
            if (!hasMatch) return null;
          }

          // Use cached atmosphere or fallback
          const cachedAtmosphere = atmosphereMap.get(sighting.yelp_id);
          const categories = (biz.categories || []).map((c: any) => c.title).join(", ");
          const fallbackAtmosphere = `${categories}${biz.price ? ` · ${biz.price}` : ""}`;

          return {
            id: biz.id,
            name: biz.name,
            city: sighting.city,
            cuisine: categories,
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
            atmosphereSummary: cachedAtmosphere || fallbackAtmosphere,
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
        total,
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
