const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const YELP_API_KEY = Deno.env.get("YELP_API_KEY");
  if (!YELP_API_KEY) return new Response(JSON.stringify({ error: "No key" }), { status: 500, headers: corsHeaders });

  const allIds = new Set<string>();
  let noPriceCount = 0;
  let offset = 0;
  const limit = 50;
  let yelpTotal = 0;

  // Page through up to 1000 results for category=american in Detroit
  while (offset < 1000) {
    const params = new URLSearchParams({
      location: "Detroit, MI",
      categories: "american",
      limit: String(limit),
      offset: String(offset),
      sort_by: "best_match",
    });

    const res = await fetch(`https://api.yelp.com/v3/businesses/search?${params}`, {
      headers: { Authorization: `Bearer ${YELP_API_KEY}`, Accept: "application/json" },
    });

    if (!res.ok) {
      console.error(`Yelp error at offset ${offset}: ${res.status}`);
      break;
    }

    const data = await res.json();
    yelpTotal = data.total || 0;
    const businesses = data.businesses || [];
    if (businesses.length === 0) break;

    for (const b of businesses) {
      allIds.add(b.id);
      if (!b.price) noPriceCount++;
    }

    offset += businesses.length;
    if (offset >= yelpTotal) break;
  }

  return new Response(JSON.stringify({
    yelp_reported_total: yelpTotal,
    fetched: allIds.size,
    no_price_count: noPriceCount,
    has_price_count: allIds.size - noPriceCount,
    exceeded_1000: yelpTotal > 1000,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
