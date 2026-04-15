import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const YELP_API_URL = "https://api.yelp.com/v3";
const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const SE_MICHIGAN_CITIES = [
  "Detroit, MI", "Ann Arbor, MI", "Novi, MI", "Troy, MI", "Royal Oak, MI",
  "Birmingham, MI", "Dearborn, MI", "Livonia, MI", "Canton, MI", "Plymouth, MI",
  "Farmington Hills, MI", "Southfield, MI", "Warren, MI", "Sterling Heights, MI",
  "Rochester Hills, MI", "Clinton Township, MI", "Pontiac, MI", "West Bloomfield, MI",
  "Taylor, MI", "Ferndale, MI", "Ypsilanti, MI", "Northville, MI", "Grosse Pointe, MI",
  "Bloomfield Hills, MI", "Wyandotte, MI", "Monroe, MI", "Port Huron, MI",
  "Shelby Township, MI", "Waterford, MI",
];

async function fetchGoogleReviews(
  name: string,
  city: string,
  apiKey: string,
): Promise<string[]> {
  try {
    const query = encodeURIComponent(`${name}, ${city}`);
    const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&type=restaurant&key=${apiKey}`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) {
      console.error(`Google Text Search error for "${name}": ${searchRes.status}`);
      return [];
    }
    const searchData = await searchRes.json();
    const placeId = searchData.results?.[0]?.place_id;
    if (!placeId) return [];

    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews&key=${apiKey}`;
    const detailsRes = await fetch(detailsUrl);
    if (!detailsRes.ok) {
      console.error(`Google Place Details error for "${name}": ${detailsRes.status}`);
      return [];
    }
    const detailsData = await detailsRes.json();
    const reviews = detailsData.result?.reviews || [];
    return reviews.map((r: any) => r.text).filter(Boolean).slice(0, 5);
  } catch (err) {
    console.error(`Google Places error for "${name}":`, err);
    return [];
  }
}

async function generateAtmosphereSummary(
  businessName: string,
  categories: string,
  price: string | null,
  rating: number | null,
  city: string,
  reviewTexts: string[],
  lovableApiKey: string,
): Promise<string | null> {
  try {
    let userContent: string;

    if (reviewTexts.length > 0) {
      const snippets = reviewTexts.map((t, i) => `Review ${i + 1}: "${t}"`).join("\n");
      userContent = `Restaurant: ${businessName}\nLocation: ${city}\n\n${snippets}\n\nBased on these real customer reviews, describe the vibe/atmosphere in one sentence.`;
    } else {
      const details = [
        `Restaurant: ${businessName}`,
        `Categories: ${categories}`,
        price ? `Price level: ${price}` : null,
        rating ? `Rating: ${rating}/5` : null,
        `Location: ${city}`,
      ].filter(Boolean).join("\n");
      userContent = `${details}\n\nDescribe the likely vibe/atmosphere in one sentence.`;
    }

    const aiRes = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content:
              "You describe restaurant vibes in one concise sentence. Focus on ambiance, crowd, decor, and energy. Never mention food quality or specific dishes. Be vivid but brief.",
          },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!aiRes.ok) {
      console.error(`AI gateway error for ${businessName}: ${aiRes.status}`);
      return null;
    }

    const aiData = await aiRes.json();
    return aiData.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error(`Error generating atmosphere for ${businessName}:`, err);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let cityFilter: string[] | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body.cities && Array.isArray(body.cities)) {
          cityFilter = body.cities;
        }
      } catch { /* no body, scan all */ }
    }

    const YELP_API_KEY = Deno.env.get("YELP_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY");

    if (!YELP_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing required environment variables" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const results: { city: string; newCount: number; total: number }[] = [];
    const newYelpIds: { yelp_id: string; name: string; categories: string; price: string | null; rating: number | null; city: string }[] = [];
    const citiesToScan = cityFilter || SE_MICHIGAN_CITIES;

    for (const city of citiesToScan) {
      let offset = 0;
      let cityTotal = 0;
      const maxResults = 200;

      while (offset < maxResults) {
        const params = new URLSearchParams({
          location: city, term: "restaurants", sort_by: "best_match",
          limit: "50", offset: String(offset), categories: "restaurants",
        });

        const yelpRes = await fetch(`${YELP_API_URL}/businesses/search?${params}`, {
          headers: { Authorization: `Bearer ${YELP_API_KEY}`, Accept: "application/json" },
        });

        if (!yelpRes.ok) { console.error(`Yelp error for ${city} offset ${offset}: ${yelpRes.status}`); break; }

        const data = await yelpRes.json();
        const businesses = data.businesses || [];
        if (businesses.length === 0) break;

        const rows = businesses.map((biz: any) => ({ yelp_id: biz.id, city }));
        const { error } = await supabase
          .from("restaurant_sightings")
          .upsert(rows, { onConflict: "yelp_id", ignoreDuplicates: true });
        if (error) console.error(`DB error for ${city}:`, error.message);

        for (const biz of businesses) {
          newYelpIds.push({
            yelp_id: biz.id, name: biz.name,
            categories: (biz.categories || []).map((c: any) => c.title).join(", "),
            price: biz.price || null, rating: biz.rating || null, city,
          });
        }

        cityTotal += businesses.length;
        offset += businesses.length;
        if (offset >= (data.total || 0)) break;
      }

      const today = new Date(); today.setHours(0, 0, 0, 0);
      const { count } = await supabase
        .from("restaurant_sightings")
        .select("*", { count: "exact", head: true })
        .eq("city", city)
        .gte("first_seen_at", today.toISOString());

      const cityNewCount = count || 0;
      await supabase.from("scan_log").insert({ city, new_count: cityNewCount });
      results.push({ city, newCount: cityNewCount, total: cityTotal });
      console.log(`Scanned ${city}: ${cityTotal} businesses, ${cityNewCount} new today`);
    }

    // Generate atmosphere summaries for uncached restaurants
    if (LOVABLE_API_KEY && newYelpIds.length > 0) {
      const uniqueMap = new Map<string, typeof newYelpIds[0]>();
      for (const item of newYelpIds) {
        if (!uniqueMap.has(item.yelp_id)) uniqueMap.set(item.yelp_id, item);
      }
      const uniqueIds = Array.from(uniqueMap.keys());

      const { data: existing } = await supabase
        .from("atmosphere_cache")
        .select("yelp_id")
        .in("yelp_id", uniqueIds);

      const existingSet = new Set((existing || []).map((e: any) => e.yelp_id));
      const uncached = uniqueIds.filter((id) => !existingSet.has(id));
      console.log(`Generating atmosphere for ${uncached.length} uncached restaurants`);

      for (const yelpId of uncached) {
        const info = uniqueMap.get(yelpId)!;

        // Fetch real reviews from Google Places
        let reviewTexts: string[] = [];
        if (GOOGLE_PLACES_API_KEY) {
          reviewTexts = await fetchGoogleReviews(info.name, info.city, GOOGLE_PLACES_API_KEY);
        }

        const summary = await generateAtmosphereSummary(
          info.name, info.categories, info.price, info.rating,
          info.city, reviewTexts, LOVABLE_API_KEY,
        );

        if (summary) {
          const { error: cacheError } = await supabase
            .from("atmosphere_cache")
            .upsert({ yelp_id: yelpId, atmosphere_summary: summary }, { onConflict: "yelp_id" });
          if (cacheError) console.error(`Cache error for ${yelpId}:`, cacheError.message);
        }

        await new Promise((r) => setTimeout(r, 300));
      }
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in scan-restaurants:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
