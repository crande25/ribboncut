import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const YELP_API_URL = "https://api.yelp.com/v3";

const SE_MICHIGAN_CITIES = [
  "Detroit, MI",
  "Ann Arbor, MI",
  "Novi, MI",
  "Troy, MI",
  "Royal Oak, MI",
  "Birmingham, MI",
  "Dearborn, MI",
  "Livonia, MI",
  "Canton, MI",
  "Plymouth, MI",
  "Farmington Hills, MI",
  "Southfield, MI",
  "Warren, MI",
  "Sterling Heights, MI",
  "Rochester Hills, MI",
];

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

    const results: { city: string; newCount: number; total: number }[] = [];

    for (const city of SE_MICHIGAN_CITIES) {
      let offset = 0;
      let cityNewCount = 0;
      let cityTotal = 0;
      const maxResults = 200; // Yelp max offset is 1000, but keep reasonable

      while (offset < maxResults) {
        const params = new URLSearchParams({
          location: city,
          term: "restaurants",
          sort_by: "best_match",
          limit: "50",
          offset: String(offset),
          categories: "restaurants",
        });

        const yelpRes = await fetch(
          `${YELP_API_URL}/businesses/search?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${YELP_API_KEY}`,
              Accept: "application/json",
            },
          }
        );

        if (!yelpRes.ok) {
          console.error(`Yelp error for ${city} offset ${offset}: ${yelpRes.status}`);
          break;
        }

        const data = await yelpRes.json();
        const businesses = data.businesses || [];

        if (businesses.length === 0) break;

        // Build sighting rows
        const rows = businesses.map((biz: any) => ({
          yelp_id: biz.id,
          city,
        }));

        // Upsert — ON CONFLICT DO NOTHING preserves first_seen_at
        const { error } = await supabase
          .from("restaurant_sightings")
          .upsert(rows, { onConflict: "yelp_id", ignoreDuplicates: true });

        if (error) {
          console.error(`DB error for ${city}:`, error.message);
        }

        // Count genuinely new ones (rows that didn't conflict)
        // We can't know exactly from upsert, so we'll count after
        cityTotal += businesses.length;
        offset += businesses.length;

        if (offset >= (data.total || 0)) break;
      }

      // Count new sightings for this city (seen today)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { count } = await supabase
        .from("restaurant_sightings")
        .select("*", { count: "exact", head: true })
        .eq("city", city)
        .gte("first_seen_at", today.toISOString());

      cityNewCount = count || 0;

      // Log the scan
      await supabase.from("scan_log").insert({
        city,
        new_count: cityNewCount,
      });

      results.push({ city, newCount: cityNewCount, total: cityTotal });

      console.log(`Scanned ${city}: ${cityTotal} businesses, ${cityNewCount} new today`);
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
