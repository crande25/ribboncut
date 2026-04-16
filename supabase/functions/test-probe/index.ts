const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const YELP_API_URL = "https://api.yelp.com/v3";
const PRICE_TIERS = ["1", "2", "3", "4"];
const YELP_MAX_RESULTS = 240;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const YELP_API_KEY = Deno.env.get("YELP_API_KEY");
  if (!YELP_API_KEY) {
    return new Response(JSON.stringify({ error: "No API key" }), { status: 500, headers: corsHeaders });
  }

  let cities = ["Northville, MI"];
  if (req.method === "POST") {
    try { const b = await req.json(); if (b.cities) cities = b.cities; } catch {}
  }

  const results: any[] = [];

  for (const city of cities) {
    const totals: Record<string, number> = {};
    let needsPhase2 = false;

    for (const price of PRICE_TIERS) {
      const res = await fetch(`${YELP_API_URL}/businesses/search?${new URLSearchParams({
        location: city, categories: "restaurants", price, limit: "1", offset: "0",
      })}`, { headers: { Authorization: `Bearer ${YELP_API_KEY}` } });
      const d = await res.json();
      const label = "$".repeat(Number(price));
      totals[label] = d.total || 0;
      if ((d.total || 0) > YELP_MAX_RESULTS) needsPhase2 = true;
    }

    // All restaurants (no price filter)
    const allRes = await fetch(`${YELP_API_URL}/businesses/search?${new URLSearchParams({
      location: city, categories: "restaurants", limit: "1", offset: "0",
    })}`, { headers: { Authorization: `Bearer ${YELP_API_KEY}` } });
    const allData = await allRes.json();
    const allTotal = allData.total || 0;
    const pricedSum = Object.values(totals).reduce((a: number, b: number) => a + b, 0);
    totals["unpriced_est"] = Math.max(0, allTotal - pricedSum);
    totals["all_no_filter"] = allTotal;
    if (totals["unpriced_est"] > YELP_MAX_RESULTS) needsPhase2 = true;

    results.push({ city, totals, needsPhase2 });
  }

  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
