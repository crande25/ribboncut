// Daily AI-driven restaurant discovery for SE Michigan.
//
// Flow (per city, sequential with throttle):
//   1. Ask Lovable AI (Gemini with Google Search grounding) for restaurants
//      that opened in the last 7 days in that city.
//   2. For each candidate {name, address}, verify via Yelp /businesses/search.
//   3. If a strict match exists (fuzzy name match + city match), insert into
//      restaurant_sightings with first_seen_at = now(), is_new_discovery = true.
//
// Triggered by pg_cron daily at 08:00 UTC (~3am EST). No UI.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { YelpKeyPool } from "../_shared/yelpKeyPool.ts";
import { jsonResponse, handleOptions } from "../_shared/http.ts";
import { checkInternalAuth } from "../_shared/internalAuth.ts";

// Inline copy — edge functions can't import from src/
const SE_MICHIGAN_CITIES = [
  "Detroit, MI", "Ann Arbor, MI", "Novi, MI", "Troy, MI", "Royal Oak, MI",
  "Birmingham, MI", "Dearborn, MI", "Livonia, MI", "Canton, MI", "Plymouth, MI",
  "Farmington Hills, MI", "Southfield, MI", "Rochester Hills, MI",
  "West Bloomfield, MI", "Ferndale, MI", "Ypsilanti, MI", "Northville, MI",
  "Bloomfield Hills, MI", "Monroe, MI", "Port Huron, MI",
];

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const YELP_SEARCH_URL = "https://api.yelp.com/v3/businesses/search";

interface Candidate {
  name: string;
  address: string;
  city: string;
}

const BATCH_SIZE = 3;

/** Decode a JWT payload without verifying its signature.
 *  Safe here only because the Supabase gateway has already verified the
 *  signature (verify_jwt = true) before the handler runs. */
function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1]
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
    timeZone: "America/Detroit",
  });
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Fuzzy match: candidate name appears in (or vice versa) Yelp result name after normalization. */
function namesMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Allow substring match if reasonably long
  if (na.length >= 4 && nb.includes(na)) return true;
  if (nb.length >= 4 && na.includes(nb)) return true;
  return false;
}

/** City match: target city's main token appears in Yelp address city. */
function cityMatch(targetCity: string, yelpCity: string | undefined): boolean {
  if (!yelpCity) return false;
  const targetMain = normalize(targetCity.split(",")[0]);
  const yelpNorm = normalize(yelpCity);
  return yelpNorm === targetMain || yelpNorm.includes(targetMain) || targetMain.includes(yelpNorm);
}

interface GroundingInfo {
  webSearchQueries?: string[];
  sources?: Array<{ uri?: string; title?: string }>;
}

async function callGeminiGrounded(
  cities: string[],
  today: string,
  sevenDaysAgo: string,
  debug = false,
): Promise<{ candidates: Candidate[]; raw?: any; grounding?: GroundingInfo }> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  if (cities.length === 0) return { candidates: [] };

  const label = cities.join(" | ");
  const cityNames = cities.map((c) => c.replace(/,\s*[A-Z]{2}$/, ""));
  const cityPhrase =
    cityNames.length === 1
      ? cityNames[0]
      : cityNames.length === 2
        ? `${cityNames[0]} or ${cityNames[1]}`
        : `${cityNames.slice(0, -1).join(", ")}, or ${cityNames[cityNames.length - 1]}`;

  const prompt = `Search for restaurants that NEWLY OPENED (first opened their doors to customers) in ${cityPhrase} between ${sevenDaysAgo} and ${today}. This means the restaurant did not exist or was not serving customers before ${sevenDaysAgo}.

Include soft openings, grand openings, and preview/trial service periods — but ONLY if the restaurant started serving customers for the first time within this date range.

EXCLUDE all of the following:
- Established restaurants that have been open for months or years (e.g. chain restaurants like Applebee's, Chili's, McDonald's, etc. that have long existed at their current location)
- Restaurants that merely renovated, rebranded, or changed ownership but were already operating at that address
- Pop-ups, food trucks without a permanent address, planned/announced openings not yet serving customers, and locations that have already closed
- Any restaurant you cannot confirm opened within the last 7 days from a credible source

Return ONLY a JSON array, with no prose, no explanation, and no markdown code fencing. Each item must have exactly this shape:
{"name": "Restaurant name", "address": "Street address, City, State", "city": "<one of the input cities, copied exactly as written above>"}

If you find no qualifying newly opened restaurants in any of these cities, return exactly: []`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2 },
  };

  if (debug) console.log(`[${label}] DEBUG request body:`, JSON.stringify(body));

  const MAX_ATTEMPTS = 3;
  let res: Response | undefined;
  let geminiStart = Date.now();
  let lastErrText = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    geminiStart = Date.now();
    res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
    });

    if (res.ok) break;

    lastErrText = await res.text();
    const errMs = Date.now() - geminiStart;
    const retriable = res.status >= 500 && res.status < 600;
    console.log(`[gemini ${label}] attempt ${attempt}/${MAX_ATTEMPTS} FAILED status=${res.status} after ${errMs}ms${retriable && attempt < MAX_ATTEMPTS ? " — retrying" : ""}`);
    if (debug) console.log(`[${label}] DEBUG error response [${res.status}]:`, lastErrText);

    if (!retriable || attempt === MAX_ATTEMPTS) {
      if (res.status === 429) {
        throw new Error(`Gemini 429: ${lastErrText.slice(0, 1500)}`);
      }
      if (res.status === 403 && lastErrText.includes("API_KEY_INVALID")) {
        throw new Error(`Gemini API key invalid — rotate GEMINI_API_KEY: ${lastErrText.slice(0, 200)}`);
      }
      throw new Error(`Gemini call failed [${res.status}] after ${attempt} attempt(s): ${lastErrText.slice(0, 300)}`);
    }

    // Exponential backoff: 2s, 5s
    const backoffMs = attempt === 1 ? 2000 : 5000;
    await new Promise((r) => setTimeout(r, backoffMs));
  }

  const data = await res!.json();
  const geminiMs = Date.now() - geminiStart;
  console.log(`[gemini ${label}] roundtrip=${geminiMs}ms model=${GEMINI_MODEL}`);
  if (debug) console.log(`[${label}] DEBUG raw Gemini response:`, JSON.stringify(data));

  const gm = data?.candidates?.[0]?.groundingMetadata;
  const grounding: GroundingInfo | undefined = gm
    ? {
        webSearchQueries: gm.webSearchQueries,
        sources: (gm.groundingChunks || [])
          .map((c: any) => c?.web)
          .filter((w: any) => w?.uri)
          .map((w: any) => ({ uri: w.uri, title: w.title })),
      }
    : undefined;

  const parts = data?.candidates?.[0]?.content?.parts;
  let text = "";
  if (Array.isArray(parts)) {
    text = parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("").trim();
  }

  // Always log a concise Gemini response summary so harvest logs show what came back
  console.log(`[gemini ${label}] response: textLen=${text.length} groundingQueries=${grounding?.webSearchQueries?.length ?? 0} sources=${grounding?.sources?.length ?? 0}`);
  if (grounding?.webSearchQueries?.length) {
    console.log(`[gemini ${label}] search queries: ${JSON.stringify(grounding.webSearchQueries)}`);
  }
  // Truncate raw text to keep logs readable but useful
  const textPreview = text.length > 1500 ? text.slice(0, 1500) + `…(+${text.length - 1500} chars)` : text;
  console.log(`[gemini ${label}] raw text: ${textPreview}`);

  if (!text) {
    console.warn(`[gemini ${label}] no text in Gemini response`);
    return { candidates: [], raw: debug ? data : undefined, grounding };
  }

  let jsonText = text;
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) jsonText = fenceMatch[1].trim();
  if (!jsonText.startsWith("[")) {
    const arrMatch = jsonText.match(/\[[\s\S]*\]/);
    if (arrMatch) jsonText = arrMatch[0];
  }

  const citySet = new Set(cities);
  // Build a normalized lookup so the model can be slightly off ("Detroit" vs "Detroit, MI")
  const normCityMap = new Map<string, string>();
  for (const c of cities) normCityMap.set(normalize(c.split(",")[0]), c);

  try {
    const parsed = JSON.parse(jsonText);
    const list = Array.isArray(parsed) ? parsed : [];
    console.log(`[gemini ${label}] parsed ${list.length} raw items from JSON`);
    const candidates: Candidate[] = [];
    for (const r of list) {
      if (!r || typeof r.name !== "string" || typeof r.address !== "string") {
        console.warn(`[gemini ${label}] dropping item — missing name/address: ${JSON.stringify(r)}`);
        continue;
      }
      const rawCity = typeof r.city === "string" ? r.city.trim() : "";
      let resolvedCity: string | undefined;
      if (citySet.has(rawCity)) {
        resolvedCity = rawCity;
      } else {
        const norm = normalize(rawCity.split(",")[0] || "");
        resolvedCity = normCityMap.get(norm);
      }
      if (!resolvedCity) {
        console.warn(`[gemini ${label}] dropping "${r.name}" — city "${rawCity}" not in batch`);
        continue;
      }
      candidates.push({ name: r.name.trim(), address: r.address.trim(), city: resolvedCity });
    }
    console.log(`[gemini ${label}] kept ${candidates.length}/${list.length} candidates: ${JSON.stringify(candidates.map((c) => `${c.name} @ ${c.city}`))}`);
    return { candidates, raw: debug ? data : undefined, grounding };
  } catch (e) {
    console.warn(`[gemini ${label}] failed to parse Gemini text as JSON: ${e instanceof Error ? e.message : String(e)}`);
    return { candidates: [], raw: debug ? data : undefined, grounding };
  }
}

interface VerifiedHit {
  yelp_id: string;
  yelp_name: string;
  yelp_city: string;
  candidate: Candidate;
  categoryAliases: string[];
  categoryTitles: string[];
  priceLevel: number | null;
  rating: number | null;
  reviewCount: number | null;
  imageUrl: string | null;
  address: string | null;
  phone: string | null;
  url: string | null;
  coordinates: { latitude?: number; longitude?: number } | null;
}

interface VerifyResult {
  hit: VerifiedHit | null;
  reason: string;
  yelpResultCount: number;
  yelpUrl: string;
}

async function verifyOnYelp(
  pool: YelpKeyPool,
  candidate: Candidate,
  targetCity: string,
): Promise<VerifyResult> {
  const params = new URLSearchParams({
    term: candidate.name,
    location: candidate.address,
    limit: "3",
    categories: "restaurants,food",
  });
  const url = `${YELP_SEARCH_URL}?${params.toString()}`;

  const res = await pool.fetch(url);
  if (!res.ok) {
    return {
      hit: null,
      reason: `yelp-error status=${res.status}${res.exhaustedAllKeys ? " (all keys exhausted)" : ""}`,
      yelpResultCount: 0,
      yelpUrl: url,
    };
  }

  const businesses: any[] = res.body?.businesses || [];
  if (businesses.length === 0) {
    return { hit: null, reason: "no-yelp-results", yelpResultCount: 0, yelpUrl: url };
  }

  const rejections: string[] = [];
  // Reject results whose ONLY food-relevant alias is a lodging category.
  // Yelp's "restaurants,food" search filter still surfaces hotels with onsite
  // restaurants (e.g., "The Vanguard Ann Arbor, Autograph Collection" tagged
  // only as "hotels"). We want true restaurants, not hotels-with-a-restaurant.
  const NON_RESTAURANT_ALIASES = new Set([
    "hotels", "hotelstravel", "resorts", "bedbreakfast", "guesthouses", "hostels",
  ]);
  const isLodgingOnly = (aliases: string[]) =>
    aliases.length > 0 && aliases.every((a) => NON_RESTAURANT_ALIASES.has(a));

  for (const b of businesses) {
    if (!b?.id || !b?.name) {
      rejections.push("missing-id-or-name");
      continue;
    }
    const yelpCity: string | undefined = b?.location?.city;
    if (!namesMatch(candidate.name, b.name)) {
      rejections.push(`name-mismatch("${b.name}")`);
      continue;
    }
    if (!cityMatch(targetCity, yelpCity)) {
      rejections.push(`city-mismatch("${b.name}" → ${yelpCity ?? "?"})`);
      continue;
    }
    const aliases: string[] = (b.categories || [])
      .map((c: any) => String(c.alias || "").toLowerCase())
      .filter(Boolean);
    if (isLodgingOnly(aliases)) {
      rejections.push(`lodging-only("${b.name}" aliases=${JSON.stringify(aliases)})`);
      continue;
    }
    const displayAddress = Array.isArray(b?.location?.display_address)
      ? b.location.display_address.join(", ")
      : null;
    return {
      hit: {
        yelp_id: b.id,
        yelp_name: b.name,
        yelp_city: yelpCity || targetCity,
        candidate,
        categoryAliases: aliases,
        categoryTitles: (b.categories || []).map((c: any) => String(c.title || "")).filter(Boolean),
        priceLevel: typeof b.price === "string" && b.price.length > 0 ? b.price.length : null,
        rating: typeof b.rating === "number" ? b.rating : null,
        reviewCount: typeof b.review_count === "number" ? b.review_count : null,
        imageUrl: typeof b.image_url === "string" ? b.image_url : null,
        address: displayAddress,
        phone: typeof b.display_phone === "string" ? b.display_phone : null,
        url: typeof b.url === "string" ? b.url : null,
        coordinates: b.coordinates && typeof b.coordinates === "object" ? b.coordinates : null,
      },
      reason: "match",
      yelpResultCount: businesses.length,
      yelpUrl: url,
    };
  }

  return {
    hit: null,
    reason: `no-strict-match [${rejections.join("; ")}]`,
    yelpResultCount: businesses.length,
    yelpUrl: url,
  };
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const startedAt = Date.now();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ error: "Missing supabase env" }, 500);
    }

    // Restrict callers: only requests bearing the INTERNAL_CRON_TOKEN are allowed.
    // This replaces the previous service_role-JWT check, which couldn't be
    // invalidated without rotating the project's JWT signing keys. The shared
    // secret lives in Vault + the runtime env and can be rotated at will.
    const auth = checkInternalAuth(req);
    if (!auth.ok) {
      console.log("[discover] auth rejected", auth.status);
      return jsonResponse(auth.body, auth.status);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const pool = new YelpKeyPool(supabase);
    await pool.load();


    // Optional on-demand override: pipe-delimited city list (cities contain commas).
    // Accepts ?cities=Detroit,%20MI|Ann%20Arbor,%20MI  OR  JSON body { cities: [...], days?: 7 }
    // Cron uses ?chunk=N&chunk_size=8 to slice the master city list (stays under
    // edge-function 150s ceiling and Gemini's ~10 RPM grounded free tier).
    let citiesToScan: string[] = [...SE_MICHIGAN_CITIES];
    let lookbackDays = 7;
    let debug = false;
    let chunk: number | null = null;
    let chunkSize = 30;
    try {
      const url = new URL(req.url);
      const citiesParam = url.searchParams.get("cities");
      const daysParam = url.searchParams.get("days");
      const debugParam = url.searchParams.get("debug");
      const chunkParam = url.searchParams.get("chunk");
      const chunkSizeParam = url.searchParams.get("chunk_size");
      if (citiesParam) {
        citiesToScan = citiesParam.split("|").map((c) => c.trim()).filter(Boolean);
      }
      if (daysParam) {
        const n = parseInt(daysParam, 10);
        if (!Number.isNaN(n) && n > 0 && n <= 90) lookbackDays = n;
      }
      if (debugParam === "1" || debugParam === "true") debug = true;
      if (chunkParam !== null) {
        const n = parseInt(chunkParam, 10);
        if (!Number.isNaN(n) && n >= 0) chunk = n;
      }
      if (chunkSizeParam) {
        const n = parseInt(chunkSizeParam, 10);
        if (!Number.isNaN(n) && n > 0 && n <= 50) chunkSize = n;
      }
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (Array.isArray(body?.cities) && body.cities.length > 0) {
          citiesToScan = body.cities.map((c: any) => String(c).trim()).filter(Boolean);
        }
        if (typeof body?.days === "number" && body.days > 0 && body.days <= 90) {
          lookbackDays = body.days;
        }
        if (body?.debug === true) debug = true;
        if (typeof body?.chunk === "number" && body.chunk >= 0) chunk = body.chunk;
        if (typeof body?.chunk_size === "number" && body.chunk_size > 0 && body.chunk_size <= 50) {
          chunkSize = body.chunk_size;
        }
      }
    } catch (_e) { /* ignore parse errors, use defaults */ }

    // Validate against known cities (drop unknowns rather than waste AI calls)
    const knownSet = new Set(SE_MICHIGAN_CITIES);
    const unknown = citiesToScan.filter((c) => !knownSet.has(c));
    citiesToScan = citiesToScan.filter((c) => knownSet.has(c));
    if (unknown.length > 0) console.warn(`[discover] ignoring unknown cities: ${unknown.join(" | ")}`);

    // Apply chunking AFTER validation so chunk indices are stable.
    if (chunk !== null) {
      const start = chunk * chunkSize;
      const end = start + chunkSize;
      const sliced = citiesToScan.slice(start, end);
      console.log(`[discover] chunk=${chunk} size=${chunkSize} → cities ${start}..${end - 1} (${sliced.length} of ${citiesToScan.length})`);
      citiesToScan = sliced;
    }

    if (citiesToScan.length === 0) {
      return jsonResponse({ ok: true, message: "No cities in this chunk", chunk });
    }

    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - lookbackDays * 24 * 3600 * 1000);
    const todayStr = formatDate(today);
    const sevenDaysAgoStr = formatDate(sevenDaysAgo);

    console.log(`[discover] starting scan: ${sevenDaysAgoStr} → ${todayStr} (${lookbackDays}d), ${citiesToScan.length} cities${debug ? " [DEBUG MODE]" : ""}`);

    // Debug mode: hit the first batch only, return raw AI response, skip Yelp/insert.
    if (debug) {
      const batch = citiesToScan.slice(0, BATCH_SIZE);
      console.log(`[discover] DEBUG mode — single batch only: ${batch.join(" | ")}`);
      const { candidates, raw, grounding } = await callGeminiGrounded(batch, todayStr, sevenDaysAgoStr, true);
      const perCity: Record<string, number> = {};
      for (const c of batch) perCity[c] = 0;
      for (const cand of candidates) perCity[cand.city] = (perCity[cand.city] || 0) + 1;
      return jsonResponse({
        ok: true,
        debug: true,
        cities: batch,
        window: { from: sevenDaysAgoStr, to: todayStr, days: lookbackDays },
        candidate_count: candidates.length,
        per_city_counts: perCity,
        candidates,
        grounding,
        raw_ai_response: raw,
      });
    }

    const summary: Array<{
      city: string;
      candidates: number;
      verified: number;
      inserted: number;
      already_known: number;
      skipped: number;
      error?: string;
    }> = [];

    let totalInserted = 0;
    const insertedYelpIds = new Set<string>();

    // Process cities in batches — one Gemini grounded call per batch (cuts daily
    // grounded-call usage to fit free-tier 20/day cap).
    for (let i = 0; i < citiesToScan.length; i += BATCH_SIZE) {
      const batch = citiesToScan.slice(i, i + BATCH_SIZE);
      const batchLabel = batch.join(" | ");

      // Initialize per-city result rows so cities with zero candidates still appear.
      const batchResults = new Map<string, typeof summary[number]>();
      for (const c of batch) {
        batchResults.set(c, { city: c, candidates: 0, verified: 0, inserted: 0, already_known: 0, skipped: 0 });
      }

      try {
        const { candidates } = await callGeminiGrounded(batch, todayStr, sevenDaysAgoStr);
        console.log(`[batch ${batchLabel}] AI returned ${candidates.length} candidates`);

        for (const cand of candidates) {
          const cityResult = batchResults.get(cand.city);
          if (!cityResult) continue;
          cityResult.candidates++;

          console.log(`[yelp ${cand.city}] LOOKUP term="${cand.name}" location="${cand.address}"`);
          const verify = await verifyOnYelp(pool, cand, cand.city);
          console.log(`[yelp ${cand.city}] RESULT term="${cand.name}" yelpResults=${verify.yelpResultCount} reason=${verify.reason}${verify.hit ? ` matched=${verify.hit.yelp_id}/"${verify.hit.yelp_name}"` : ""}`);

          if (!verify.hit) {
            cityResult.skipped++;
            console.log(`[db ${cand.city}] SKIP "${cand.name}" — ${verify.reason}`);
            continue;
          }
          cityResult.verified++;
          const hit = verify.hit;

          // Probe Yelp's detail endpoint for BUSINESS_UNAVAILABLE. Yelp's
          // /businesses/search will surface businesses that /businesses/{id}
          // refuses to serve (403 BUSINESS_UNAVAILABLE — typically venues with
          // no reviews, like university dining halls). Inserting them puts a
          // bare card in the feed until get-restaurants lazily tombstones it.
          // Do the probe here once so unavailable venues never enter the feed,
          // and tombstone any pre-existing sighting for the same yelp_id.
          const detailRes = await pool.fetch(`https://api.yelp.com/v3/businesses/${hit.yelp_id}`);
          const detailBodyStr = typeof detailRes.body === "string"
            ? detailRes.body
            : JSON.stringify(detailRes.body || {});
          const isUnavailable = detailRes.status === 403 && detailBodyStr.includes("BUSINESS_UNAVAILABLE");
          if (isUnavailable) {
            cityResult.skipped++;
            console.log(`[db ${cand.city}] SKIP yelp_id=${hit.yelp_id} "${hit.yelp_name}" — BUSINESS_UNAVAILABLE`);
            // If we previously sighted this id, tombstone it so it stops
            // appearing in the feed. Only stamps rows that aren't already tombstoned.
            const { error: tombErr, data: tombData } = await supabase
              .from("restaurant_sightings")
              .update({ yelp_unavailable_at: new Date().toISOString() })
              .eq("yelp_id", hit.yelp_id)
              .is("yelp_unavailable_at", null)
              .select("yelp_id");
            if (tombErr) {
              console.error(`[db ${cand.city}] tombstone failed yelp_id=${hit.yelp_id}: ${tombErr.message}`);
            } else if (tombData && tombData.length > 0) {
              console.log(`[db ${cand.city}] tombstoned existing sighting yelp_id=${hit.yelp_id}`);
            }
            continue;
          }
          if (!detailRes.ok) {
            // Non-403 detail failure (rate limit, 5xx, network, all keys exhausted).
            // Don't insert — we can't confirm availability. The next discovery run
            // will retry. This keeps bad data out of the feed without permanently
            // discarding the candidate.
            cityResult.skipped++;
            console.log(`[db ${cand.city}] SKIP yelp_id=${hit.yelp_id} "${hit.yelp_name}" — detail-probe-failed status=${detailRes.status}${detailRes.exhaustedAllKeys ? " (all keys exhausted)" : ""}`);
            continue;
          }

          const { error: insertErr, data: inserted } = await supabase
            .from("restaurant_sightings")
            .upsert(
              {
                yelp_id: hit.yelp_id,
                city: cand.city,
                first_seen_at: new Date().toISOString(),
                is_new_discovery: true,
              },
              { onConflict: "yelp_id", ignoreDuplicates: true },
            )
            .select();

          if (insertErr) {
            console.error(`[db ${cand.city}] NOT-INSERTED yelp_id=${hit.yelp_id} "${hit.yelp_name}" — db-error: ${insertErr.message}`);
            continue;
          }
          if (inserted && inserted.length > 0) {
            cityResult.inserted++;
            totalInserted++;
            insertedYelpIds.add(hit.yelp_id);
            console.log(`[db ${cand.city}] INSERTED yelp_id=${hit.yelp_id} "${hit.yelp_name}"`);

            // Cache categories — only on first insertion (NEW sightings only).
            const { error: catErr } = await supabase
              .from("restaurant_categories")
              .upsert(
                {
                  yelp_id: hit.yelp_id,
                  aliases: hit.categoryAliases,
                  titles: hit.categoryTitles,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "yelp_id" },
              );
            if (catErr) {
              console.error(`[cache ${cand.city}] categories upsert failed yelp_id=${hit.yelp_id}: ${catErr.message}`);
            } else {
              console.log(`[cache ${cand.city}] categories cached yelp_id=${hit.yelp_id} aliases=[${hit.categoryAliases.join(",")}]`);
            }

            // Cache metrics + display fields — only on first insertion (NEW sightings only).
            const { error: metErr } = await supabase
              .from("restaurant_metrics")
              .upsert(
                {
                  yelp_id: hit.yelp_id,
                  price_level: hit.priceLevel,
                  rating: hit.rating,
                  review_count: hit.reviewCount,
                  name: hit.yelp_name,
                  image_url: hit.imageUrl,
                  address: hit.address,
                  phone: hit.phone,
                  url: hit.url,
                  coordinates: hit.coordinates,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "yelp_id" },
              );
            if (metErr) {
              console.error(`[metrics ${cand.city}] upsert failed yelp_id=${hit.yelp_id}: ${metErr.message}`);
            } else {
              console.log(`[metrics ${cand.city}] cached yelp_id=${hit.yelp_id} price=${hit.priceLevel} rating=${hit.rating} reviews=${hit.reviewCount}`);
            }
          } else {
            console.log(`[db ${cand.city}] NOT-INSERTED yelp_id=${hit.yelp_id} "${hit.yelp_name}" — duplicate (already in restaurant_sightings); skipping metadata refresh`);
          }
        }

        // (scan_log table removed — no per-city scan logging needed)

      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[batch ${batchLabel}] failed:`, msg);
        for (const r of batchResults.values()) r.error = msg;
      }

      for (const r of batchResults.values()) summary.push(r);

      // Throttle 7s between batches (well under Gemini's ~10 RPM grounded limit)
      if (i + BATCH_SIZE < citiesToScan.length) {
        await new Promise((r) => setTimeout(r, 7000));
      }
    }


    const elapsedMs = Date.now() - startedAt;
    console.log("[discover] DONE", JSON.stringify({
      elapsed_ms: elapsedMs,
      total_inserted: totalInserted,
      summary,
    }, null, 2));

    // Inline vibe-fill: generate vibes for sightings inserted IN THIS RUN only.
    // Existing sightings keep their cached vibe (refreshed by the periodic
    // refresh-metrics job, not here).
    const vibeFill = { processed: 0, ok: 0, failed: 0 };
    try {
      const { data: cachedVibes } = await supabase
        .from("atmosphere_cache")
        .select("yelp_id")
        .in("yelp_id", Array.from(insertedYelpIds));
      const cachedSet = new Set((cachedVibes || []).map((c: any) => c.yelp_id));
      const missing = Array.from(insertedYelpIds).filter((id) => !cachedSet.has(id));
      console.log(`[discover→vibe] ${missing.length} newly-inserted sightings missing vibes (of ${insertedYelpIds.size} inserted this run)`);
      vibeFill.processed = missing.length;
      for (let i = 0; i < missing.length; i++) {
        try {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-vibe`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ yelp_id: missing[i] }),
          });
          const d = await r.json();
          if (d?.ok) vibeFill.ok++;
          else { vibeFill.failed++; console.warn(`[discover→vibe] ${missing[i]} failed: ${d?.reason || r.status}`); }
        } catch (e) {
          vibeFill.failed++;
          console.error(`[discover→vibe] ${missing[i]} threw: ${e instanceof Error ? e.message : e}`);
        }
        if (i < missing.length - 1) await new Promise((r) => setTimeout(r, 500));
      }
      console.log(`[discover→vibe] DONE ok=${vibeFill.ok} failed=${vibeFill.failed}`);
    } catch (e) {
      console.error(`[discover→vibe] phase failed: ${e instanceof Error ? e.message : e}`);
    }

    return jsonResponse({ ok: true, total_inserted: totalInserted, elapsed_ms: elapsedMs, summary, vibe_fill: vibeFill });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[discover] fatal:", msg);
    return jsonResponse({ error: msg }, 500);
  }
});
