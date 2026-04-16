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

    // Step 1: Snapshot existing yelp_ids BEFORE the scan
    const { data: existingRows } = await supabase
      .from("restaurant_sightings")
      .select("yelp_id");
    const existingIds = new Set((existingRows || []).map((r: any) => r.yelp_id));
    console.log(`Pre-scan snapshot: ${existingIds.size} existing restaurants in DB`);

    // Track all yelp_ids found in this scan
    const scannedIds = new Set<string>();

    // Step 2: Default insert date is 10 years ago
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    const defaultFirstSeen = tenYearsAgo.toISOString();

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

        // Insert with backdated first_seen_at; ignoreDuplicates keeps existing rows untouched
        const rows = businesses.map((biz: any) => ({
          yelp_id: biz.id,
          city,
          first_seen_at: defaultFirstSeen,
          is_new_discovery: false,
        }));
        const { error } = await supabase
          .from("restaurant_sightings")
          .upsert(rows, { onConflict: "yelp_id", ignoreDuplicates: true });
        if (error) console.error(`DB error for ${city}:`, error.message);

        for (const biz of businesses) {
          scannedIds.add(biz.id);
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

      results.push({ city, newCount: 0, total: cityTotal });
      console.log(`Scanned ${city}: ${cityTotal} businesses`);
    }

    // Step 3: Diff — find genuinely new restaurants
    const newlyDiscovered = [...scannedIds].filter((id) => !existingIds.has(id));
    console.log(`Diff result: ${newlyDiscovered.length} genuinely new restaurants discovered`);

    // Update newly discovered restaurants with current timestamp
    if (newlyDiscovered.length > 0) {
      const now = new Date().toISOString();
      for (const yelpId of newlyDiscovered) {
        const { error } = await supabase
          .from("restaurant_sightings")
          .update({ first_seen_at: now, is_new_discovery: true })
          .eq("yelp_id", yelpId);
        if (error) console.error(`Error marking ${yelpId} as new:`, error.message);
      }

      // Update results with accurate new counts
      for (const r of results) {
        const cityNewIds = newlyDiscovered.filter((id) => {
          const info = newYelpIds.find((n) => n.yelp_id === id);
          return info?.city === r.city;
        });
        r.newCount = cityNewIds.length;
      }
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

    // Backfill: generate atmosphere for DB-tracked restaurants not seen in this scan
    if (LOVABLE_API_KEY && YELP_API_KEY) {
      const scannedCities = citiesToScan;
      for (const city of scannedCities) {
        // Find sightings in this city that still lack atmosphere cache
        const { data: uncachedSightings } = await supabase
          .from("restaurant_sightings")
          .select("yelp_id")
          .eq("city", city)
          .not("yelp_id", "in", `(${Array.from(newYelpIds.map(r => r.yelp_id)).join(",")})`)

        if (!uncachedSightings || uncachedSightings.length === 0) continue;

        const sightingIds = uncachedSightings.map((s: any) => s.yelp_id);
        const { data: alreadyCached } = await supabase
          .from("atmosphere_cache")
          .select("yelp_id")
          .in("yelp_id", sightingIds);

        const cachedSet = new Set((alreadyCached || []).map((e: any) => e.yelp_id));
        const toBackfill = sightingIds.filter((id: string) => !cachedSet.has(id));

        if (toBackfill.length === 0) continue;
        console.log(`Backfilling ${toBackfill.length} restaurants in ${city} not in scan results`);

        for (const yelpId of toBackfill) {
          try {
            // Fetch individual business details from Yelp
            const bizRes = await fetch(`${YELP_API_URL}/businesses/${yelpId}`, {
              headers: { Authorization: `Bearer ${YELP_API_KEY}`, Accept: "application/json" },
            });
            if (!bizRes.ok) { console.error(`Yelp detail error for ${yelpId}: ${bizRes.status}`); continue; }
            const biz = await bizRes.json();

            const name = biz.name || yelpId;
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
                .upsert({ yelp_id: yelpId, atmosphere_summary: summary }, { onConflict: "yelp_id" });
              if (cacheError) console.error(`Backfill cache error for ${yelpId}:`, cacheError.message);
            }

            await new Promise((r) => setTimeout(r, 300));
          } catch (err) {
            console.error(`Backfill error for ${yelpId}:`, err);
          }
        }
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
