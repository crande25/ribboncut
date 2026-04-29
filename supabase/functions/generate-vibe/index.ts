// Generates a casual, neutral "vibe" summary for a single restaurant by
// summarizing real customer reviews (Google Places primary, Yelp fallback).
//
// Input:  { yelp_id: string }
// Output: { ok: boolean, vibe?: string, source: "google" | "yelp" | "none", reason?: string }
//
// Side effects:
//   - Caches the resolved Google place_id (or 'NOT_FOUND' sentinel) on restaurant_metrics
//   - Upserts the generated vibe into atmosphere_cache (overwriting any prior value)
//
// Auth: requires SUPABASE_SERVICE_ROLE_KEY in the Authorization header. This
// function is invoked server-to-server only (by backfill-vibes,
// discover-new-restaurants, and get-restaurants).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const YELP_REVIEWS_URL = "https://api.yelp.com/v3/businesses";
const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const NOT_FOUND_SENTINEL = "NOT_FOUND";

const VIBE_SYSTEM_PROMPT = `You write short, casual, neutral "vibe" descriptions of restaurants based on customer reviews.

Rules:
- 1-2 sentences, MAX 160 characters total.
- Casual, friendly tone. No marketing language.
- Describe ONLY look and feel: decor, crowd, energy, lighting, layout, noise level, ambiance.
- Do NOT praise or criticize the food, drinks, service, prices, or value.
- Stay observational and neutral. No superlatives ("amazing", "perfect", "must-visit").
- No emojis. No quotation marks. No restaurant name in the output.
- If reviews don't describe atmosphere, infer carefully from venue type/cuisine and keep it generic.

You MUST respond by calling the set_vibe tool.`;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function namesMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.includes(na)) return true;
  if (nb.length >= 4 && na.includes(nb)) return true;
  return false;
}

function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

interface MetricsRow {
  yelp_id: string;
  name: string | null;
  address: string | null;
  coordinates: { latitude?: number; longitude?: number } | null;
  google_place_id: string | null;
}

/** Resolve a Google place_id from name + address, verified by name + (coords or city) match. */
async function resolveGooglePlaceId(
  metrics: MetricsRow,
  city: string,
  apiKey: string,
): Promise<string | null> {
  if (!metrics.name) return null;

  const query = [metrics.name, metrics.address].filter(Boolean).join(", ") ||
    `${metrics.name} ${city}`;

  const body: any = {
    textQuery: query,
    pageSize: 5,
    includedType: "restaurant",
  };
  // Bias by coordinates if we have them
  if (metrics.coordinates?.latitude && metrics.coordinates?.longitude) {
    body.locationBias = {
      circle: {
        center: {
          latitude: metrics.coordinates.latitude,
          longitude: metrics.coordinates.longitude,
        },
        radius: 5000,
      },
    };
  }

  const res = await fetch(PLACES_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.formattedAddress",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[generate-vibe] Google Places searchText failed ${res.status}: ${text.slice(0, 200)}`);
    return null;
  }

  const data = await res.json();
  const candidates: any[] = data.places || [];
  if (candidates.length === 0) return null;

  const yelpCoords =
    metrics.coordinates?.latitude && metrics.coordinates?.longitude
      ? { latitude: metrics.coordinates.latitude, longitude: metrics.coordinates.longitude }
      : null;
  const cityNorm = normalize(city.split(",")[0]);

  for (const p of candidates) {
    const pName: string = p?.displayName?.text || "";
    if (!namesMatch(metrics.name, pName)) continue;

    if (yelpCoords && p?.location?.latitude && p?.location?.longitude) {
      const dist = distanceMeters(yelpCoords, {
        latitude: p.location.latitude,
        longitude: p.location.longitude,
      });
      if (dist <= 200) return p.id;
      continue;
    }
    // No coords → fall back to city match in formattedAddress
    const addr: string = p?.formattedAddress || "";
    if (normalize(addr).includes(cityNorm)) return p.id;
  }
  return null;
}

/** Fetch up to 5 review texts from Google Places. */
async function fetchGoogleReviews(placeId: string, apiKey: string): Promise<string[]> {
  const url = `https://places.googleapis.com/v1/places/${placeId}`;
  const res = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "reviews",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[generate-vibe] Google place details failed ${res.status}: ${text.slice(0, 200)}`);
    return [];
  }
  const data = await res.json();
  const reviews: any[] = data.reviews || [];
  return reviews
    .map((r) => String(r?.text?.text || r?.originalText?.text || "").trim())
    .filter((t) => t.length > 0)
    .slice(0, 5);
}

/** Fetch business metadata (name, address, coords, etc.) from Yelp via rotating keys. */
async function fetchYelpBusiness(yelpId: string, supabase: any): Promise<any | null> {
  const { data: statuses } = await supabase
    .from("api_key_status")
    .select("key_name, reset_at")
    .eq("provider", "yelp");
  const exhaustedSet = new Set<string>();
  const now = new Date();
  for (const s of statuses || []) {
    if (s.reset_at && new Date(s.reset_at) > now) exhaustedSet.add(s.key_name);
  }

  const candidateKeys: string[] = [];
  const primary = Deno.env.get("YELP_API_KEY");
  if (primary && !exhaustedSet.has("YELP_API_KEY")) candidateKeys.push(primary);
  for (let i = 2; i <= 20; i++) {
    const name = `YELP_API_KEY_${i}`;
    const v = Deno.env.get(name);
    if (v && !exhaustedSet.has(name)) candidateKeys.push(v);
  }

  for (const key of candidateKeys) {
    const res = await fetch(`${YELP_REVIEWS_URL}/${yelpId}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (res.ok) return await res.json();
    if (res.status === 404) {
      console.warn(`[generate-vibe] Yelp business ${yelpId} not found (404)`);
      return null;
    }
    if (res.status !== 429 && res.status !== 401 && res.status !== 403) {
      const text = await res.text();
      console.error(`[generate-vibe] Yelp business fetch failed ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }
    // quota / auth → try next key
  }
  return null;
}

async function fetchYelpReviews(yelpId: string, supabase: any): Promise<string[]> {
  // Try each key until we get a 200 or all keys are exhausted.
  const { data: statuses } = await supabase
    .from("api_key_status")
    .select("key_name, reset_at")
    .eq("provider", "yelp");
  const exhaustedSet = new Set<string>();
  const now = new Date();
  for (const s of statuses || []) {
    if (s.reset_at && new Date(s.reset_at) > now) exhaustedSet.add(s.key_name);
  }

  const candidateKeys: string[] = [];
  const primary = Deno.env.get("YELP_API_KEY");
  if (primary && !exhaustedSet.has("YELP_API_KEY")) candidateKeys.push(primary);
  for (let i = 2; i <= 20; i++) {
    const name = `YELP_API_KEY_${i}`;
    const v = Deno.env.get(name);
    if (v && !exhaustedSet.has(name)) candidateKeys.push(v);
  }

  for (const key of candidateKeys) {
    const res = await fetch(`${YELP_REVIEWS_URL}/${yelpId}/reviews?limit=3`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (res.ok) {
      const data = await res.json();
      const reviews: any[] = data.reviews || [];
      return reviews
        .map((r) => String(r?.text || "").trim())
        .filter((t) => t.length > 0);
    }
    if (res.status !== 429 && res.status !== 401 && res.status !== 403) {
      // Non-quota error — give up
      const text = await res.text();
      console.error(`[generate-vibe] Yelp reviews failed ${res.status}: ${text.slice(0, 200)}`);
      return [];
    }
    // quota / auth → try next key
  }
  return [];
}

/** Call Lovable AI to summarize reviews into a vibe string via tool calling. */
async function summarizeReviews(
  restaurantName: string,
  cuisine: string,
  reviews: string[],
  apiKey: string,
): Promise<string | null> {
  // Truncate reviews to keep token use sane (~600 chars each)
  const trimmed = reviews.map((r) => r.slice(0, 600)).join("\n---\n");
  const userPrompt = `Restaurant: ${restaurantName}
Cuisine/category: ${cuisine || "unknown"}

Customer reviews:
${trimmed || "(no reviews available)"}

Write the vibe.`;

  const body = {
    model: "google/gemini-3-flash-preview",
    messages: [
      { role: "system", content: VIBE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "set_vibe",
          description: "Record the casual, neutral vibe description.",
          parameters: {
            type: "object",
            properties: {
              vibe: {
                type: "string",
                description: "1-2 sentences, max 160 chars, casual, neutral, look-and-feel only.",
              },
            },
            required: ["vibe"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "set_vibe" } },
  };

  const res = await fetch(LOVABLE_AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[generate-vibe] Lovable AI failed ${res.status}: ${text.slice(0, 300)}`);
    return null;
  }

  const data = await res.json();
  const toolCalls = data?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    console.error(`[generate-vibe] Lovable AI returned no tool calls`);
    return null;
  }
  try {
    const args = JSON.parse(toolCalls[0]?.function?.arguments || "{}");
    const vibe = String(args.vibe || "").trim();
    if (!vibe) return null;
    // Hard-clamp length to keep card layouts predictable
    return vibe.length > 200 ? vibe.slice(0, 197).trimEnd() + "..." : vibe;
  } catch (e) {
    console.error(`[generate-vibe] failed to parse tool args: ${e}`);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ ok: false, reason: "missing supabase env" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ ok: false, reason: "LOVABLE_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Restrict callers to service-role bearer
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
      return new Response(JSON.stringify({ ok: false, reason: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let yelpId: string;
    try {
      const body = await req.json();
      yelpId = String(body?.yelp_id || "").trim();
    } catch {
      return new Response(JSON.stringify({ ok: false, reason: "invalid body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!yelpId) {
      return new Response(JSON.stringify({ ok: false, reason: "yelp_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up sighting (for city) + metrics + categories in parallel
    const [sightingRes, metricsRes, catRes] = await Promise.all([
      supabase.from("restaurant_sightings").select("city").eq("yelp_id", yelpId).maybeSingle(),
      supabase.from("restaurant_metrics")
        .select("yelp_id, name, address, coordinates, google_place_id")
        .eq("yelp_id", yelpId).maybeSingle(),
      supabase.from("restaurant_categories").select("titles").eq("yelp_id", yelpId).maybeSingle(),
    ]);

    const city: string = sightingRes.data?.city || "";
    const metrics: MetricsRow | null = metricsRes.data
      ? { ...metricsRes.data, yelp_id: yelpId }
      : null;
    const cuisine: string = (catRes.data?.titles || []).join(", ");

    if (!metrics || !metrics.name) {
      console.warn(`[generate-vibe] ${yelpId}: no cached metrics/name; cannot resolve place`);
      return new Response(JSON.stringify({ ok: false, source: "none", reason: "no metrics" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 1: resolve Google place_id (cached) — only if API key configured
    let placeId: string | null = null;
    if (metrics.google_place_id && metrics.google_place_id !== NOT_FOUND_SENTINEL) {
      placeId = metrics.google_place_id;
    } else if (!metrics.google_place_id && GOOGLE_PLACES_API_KEY) {
      placeId = await resolveGooglePlaceId(metrics, city, GOOGLE_PLACES_API_KEY);
      // Cache result (or NOT_FOUND so we don't keep retrying)
      await supabase.from("restaurant_metrics").update({
        google_place_id: placeId || NOT_FOUND_SENTINEL,
        updated_at: new Date().toISOString(),
      }).eq("yelp_id", yelpId);
      console.log(`[generate-vibe] ${yelpId}: resolved place_id=${placeId || "NOT_FOUND"}`);
    }

    // Step 2: fetch reviews (Google primary, Yelp fallback)
    let reviews: string[] = [];
    let source: "google" | "yelp" | "none" = "none";
    if (placeId && GOOGLE_PLACES_API_KEY) {
      reviews = await fetchGoogleReviews(placeId, GOOGLE_PLACES_API_KEY);
      if (reviews.length > 0) source = "google";
    }
    if (reviews.length === 0) {
      reviews = await fetchYelpReviews(yelpId, supabase);
      if (reviews.length > 0) source = "yelp";
    }

    // Step 3: summarize via Lovable AI (works even with zero reviews — model
    // will produce a generic neutral description from cuisine alone).
    const vibe = await summarizeReviews(metrics.name, cuisine, reviews, LOVABLE_API_KEY);
    if (!vibe) {
      return new Response(JSON.stringify({ ok: false, source, reason: "ai failed" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 4: upsert into atmosphere_cache (overwrite)
    const { error: upsertErr } = await supabase.from("atmosphere_cache").upsert(
      { yelp_id: yelpId, atmosphere_summary: vibe, created_at: new Date().toISOString() },
      { onConflict: "yelp_id" },
    );
    if (upsertErr) {
      console.error(`[generate-vibe] ${yelpId}: upsert failed: ${upsertErr.message}`);
      return new Response(JSON.stringify({ ok: false, source, reason: upsertErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[generate-vibe] ${yelpId}: ok source=${source} reviews=${reviews.length} vibe="${vibe}"`);
    return new Response(JSON.stringify({ ok: true, vibe, source }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[generate-vibe] error:", e);
    const msg = e instanceof Error ? e.message : "unknown error";
    return new Response(JSON.stringify({ ok: false, reason: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
