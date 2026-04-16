import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const YELP_API_URL = "https://api.yelp.com/v3";
const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function fetchGoogleReviews(
  name: string,
  city: string,
  apiKey: string,
): Promise<string[]> {
  try {
    const query = encodeURIComponent(`${name}, ${city}`);
    const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&type=restaurant&key=${apiKey}`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const placeId = searchData.results?.[0]?.place_id;
    if (!placeId) return [];

    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews&key=${apiKey}`;
    const detailsRes = await fetch(detailsUrl);
    if (!detailsRes.ok) return [];
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
    let batchSize = 15;
    let cityFilter: string | null = null;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body.batch_size && typeof body.batch_size === "number") batchSize = Math.min(body.batch_size, 30);
        if (body.city && typeof body.city === "string") cityFilter = body.city;
      } catch { /* defaults */ }
    }

    const YELP_API_KEY = Deno.env.get("YELP_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY");

    if (!YELP_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing required environment variables" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find restaurants missing atmosphere cache
    let query = supabase
      .from("restaurant_sightings")
      .select("yelp_id, city")
      .gte("first_seen_at", new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString());

    if (cityFilter) query = query.eq("city", cityFilter);

    const { data: sightings, error: sErr } = await query;
    if (sErr) throw new Error(`DB error: ${sErr.message}`);
    if (!sightings || sightings.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, remaining: 0, message: "No sightings found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const allIds = sightings.map((s: any) => s.yelp_id);
    const { data: cached } = await supabase
      .from("atmosphere_cache")
      .select("yelp_id")
      .in("yelp_id", allIds);

    const cachedSet = new Set((cached || []).map((e: any) => e.yelp_id));
    const uncached = sightings.filter((s: any) => !cachedSet.has(s.yelp_id));

    if (uncached.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, remaining: 0, message: "All restaurants have vibes" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const batch = uncached.slice(0, batchSize);
    let processed = 0;

    for (const { yelp_id, city } of batch) {
      try {
        // Fetch Yelp details by ID
        const bizRes = await fetch(`${YELP_API_URL}/businesses/${yelp_id}`, {
          headers: { Authorization: `Bearer ${YELP_API_KEY}`, Accept: "application/json" },
        });
        if (!bizRes.ok) {
          console.error(`Yelp detail error for ${yelp_id}: ${bizRes.status}`);
          continue;
        }
        const biz = await bizRes.json();

        const name = biz.name || yelp_id;
        const categories = (biz.categories || []).map((c: any) => c.title).join(", ");
        const price = biz.price || null;
        const rating = biz.rating || null;

        let reviewTexts: string[] = [];
        if (GOOGLE_PLACES_API_KEY) {
          reviewTexts = await fetchGoogleReviews(name, city, GOOGLE_PLACES_API_KEY);
        }

        const summary = await generateAtmosphereSummary(
          name, categories, price, rating, city, reviewTexts, LOVABLE_API_KEY,
        );

        if (summary) {
          const { error: cacheError } = await supabase
            .from("atmosphere_cache")
            .upsert({ yelp_id, atmosphere_summary: summary }, { onConflict: "yelp_id" });
          if (cacheError) console.error(`Cache error for ${yelp_id}:`, cacheError.message);
          else processed++;
        }

        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        console.error(`Error processing ${yelp_id}:`, err);
      }
    }

    const remaining = uncached.length - batch.length;
    console.log(`Backfill complete: ${processed} generated, ${remaining} still remaining`);

    return new Response(
      JSON.stringify({ success: true, processed, remaining, total_missing: uncached.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    console.error("Error in backfill-vibes:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
