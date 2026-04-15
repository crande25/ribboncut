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
    if (!YELP_API_KEY) {
      return new Response(
        JSON.stringify({ error: "YELP_API_KEY is not configured" }),
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
    // If opened_since is older than that, we skip open_at and rely on default sorting.
    if (openedSince) {
      const sinceDate = new Date(openedSince);
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      if (sinceDate > twoWeeksAgo) {
        const ts = Math.floor(sinceDate.getTime() / 1000);
        params.set("open_at", String(ts));
        // Remove sort_by when using open_at (Yelp API requirement)
        params.delete("sort_by");
      }
    }

    const yelpResponse = await fetch(
      `${YELP_API_URL}/businesses/search?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${YELP_API_KEY}`,
          Accept: "application/json",
        },
      }
    );

    if (!yelpResponse.ok) {
      const errorBody = await yelpResponse.text();
      console.error(`Yelp API error [${yelpResponse.status}]: ${errorBody}`);
      return new Response(
        JSON.stringify({ error: `Yelp API error: ${yelpResponse.status}` }),
        { status: yelpResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await yelpResponse.json();

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

    // Now fetch details for each restaurant to get photos and hours
    // (We do this for the first few to avoid rate limits)
    const enrichedRestaurants = await Promise.all(
      restaurants.slice(0, Math.min(restaurants.length, 5)).map(async (r: any) => {
        try {
          const detailRes = await fetch(`${YELP_API_URL}/businesses/${r.id}`, {
            headers: {
              Authorization: `Bearer ${YELP_API_KEY}`,
              Accept: "application/json",
            },
          });
          if (detailRes.ok) {
            const detail = await detailRes.json();
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
