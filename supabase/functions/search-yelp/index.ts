const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const YELP_API_KEY = Deno.env.get("YELP_API_KEY");
  if (!YELP_API_KEY) {
    return new Response(JSON.stringify({ error: "No API key" }), { status: 500, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const term = url.searchParams.get("term") || "";
  const location = url.searchParams.get("location") || "Detroit, MI";

  const yelpUrl = `https://api.yelp.com/v3/businesses/search?term=${encodeURIComponent(term)}&location=${encodeURIComponent(location)}&limit=3`;
  
  const res = await fetch(yelpUrl, {
    headers: { Authorization: `Bearer ${YELP_API_KEY}`, Accept: "application/json" },
  });

  const data = await res.json();
  const results = (data.businesses || []).map((b: any) => ({
    id: b.id,
    name: b.name,
    address: b.location?.display_address?.join(", "),
    categories: (b.categories || []).map((c: any) => c.title).join(", "),
  }));

  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
