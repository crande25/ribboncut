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

// ===== Inlined YelpKeyPool (edge functions can't share files across folders) =====
interface YelpFetchResult {
  ok: boolean;
  status: number;
  body?: any;
  rateLimited: boolean;
  authError: boolean;
  keyName: string;
  exhaustedAllKeys?: boolean;
}
interface KeyEntry { name: string; value: string; exhausted: boolean; resetAt?: Date; }

function nextYelpReset(): Date {
  const now = new Date();
  const pacificOffsetHours = 8;
  const pacific = new Date(now.getTime() - pacificOffsetHours * 3600 * 1000);
  pacific.setUTCHours(24, 0, 0, 0);
  return new Date(pacific.getTime() + pacificOffsetHours * 3600 * 1000);
}

class YelpKeyPool {
  private keys: KeyEntry[] = [];
  private supabase: any;
  private loaded = false;
  constructor(supabase: any) { this.supabase = supabase; }

  async load(): Promise<void> {
    if (this.loaded) return;
    const candidates: KeyEntry[] = [];
    const primary = Deno.env.get("YELP_API_KEY");
    if (primary) candidates.push({ name: "YELP_API_KEY", value: primary, exhausted: false });
    for (let i = 2; i <= 20; i++) {
      const v = Deno.env.get(`YELP_API_KEY_${i}`);
      if (v) candidates.push({ name: `YELP_API_KEY_${i}`, value: v, exhausted: false });
    }
    if (candidates.length === 0) throw new Error("No YELP_API_KEY* env vars found");

    const { data: statuses } = await this.supabase
      .from("api_key_status").select("key_name, exhausted_at, reset_at")
      .eq("provider", "yelp").in("key_name", candidates.map((c) => c.name));

    const now = new Date();
    const statusMap = new Map<string, { reset_at: string | null }>();
    for (const s of statuses || []) statusMap.set(s.key_name, s);
    for (const c of candidates) {
      const s = statusMap.get(c.name);
      if (s?.reset_at) {
        const resetAt = new Date(s.reset_at);
        if (resetAt > now) { c.exhausted = true; c.resetAt = resetAt; }
      }
    }
    this.keys = candidates;
    this.loaded = true;
    const available = this.keys.filter((k) => !k.exhausted).length;
    console.log(`[YelpKeyPool] loaded ${this.keys.length} keys, ${available} available`);
  }

  private async markExhausted(keyName: string, status: number, errorBody: string): Promise<void> {
    const resetAt = nextYelpReset();
    const entry = this.keys.find((k) => k.name === keyName);
    if (entry) { entry.exhausted = true; entry.resetAt = resetAt; }
    console.warn(`[YelpKeyPool] marking ${keyName} EXHAUSTED status=${status}`);
    await this.supabase.from("api_key_status").upsert({
      provider: "yelp", key_name: keyName,
      exhausted_at: new Date().toISOString(),
      reset_at: resetAt.toISOString(),
      last_error: errorBody.slice(0, 500), last_status: status,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key_name" });
  }

  private nextAvailable(): KeyEntry | null {
    return this.keys.find((k) => !k.exhausted) || null;
  }

  async fetch(url: string): Promise<YelpFetchResult> {
    if (!this.loaded) await this.load();
    while (true) {
      const key = this.nextAvailable();
      if (!key) return { ok: false, status: 0, rateLimited: true, authError: false, keyName: "(none)", exhaustedAllKeys: true };
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key.value}`, Accept: "application/json" } });
      if (res.status === 401 || res.status === 403) {
        const body = await res.text();
        await this.markExhausted(key.name, res.status, body);
        continue;
      }
      if (res.status === 429) {
        const body = await res.text();
        if (/TOO_MANY_REQUESTS_PER_SECOND/i.test(body)) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        await this.markExhausted(key.name, res.status, body);
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, status: res.status, body, rateLimited: false, authError: false, keyName: key.name };
      }
      const data = await res.json();
      return { ok: true, status: 200, body: data, rateLimited: false, authError: false, keyName: key.name };
    }
  }
}
// ===== End YelpKeyPool =====


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

  const prompt = `Search for restaurants that are active in any capacity (including soft openings, permanent pop-up residencies, or preview phases) in ${cityPhrase} as of ${sevenDaysAgo} to ${today}. Do not restrict the list to 'officially' opened grand openings; include any business currently serving customers at a physical street address.

Only include permanent locations that are currently fully operational. Exclude pop-ups, food trucks without a permanent address, planned/announced openings, and locations that have already closed.

Return ONLY a JSON array, with no prose, no explanation, and no markdown code fencing. Each item must have exactly this shape:
{"name": "Restaurant name", "address": "Street address, City, State", "city": "<one of the input cities, copied exactly as written above>"}

If you find no qualifying restaurants in any of these cities, return exactly: []`;

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
    return {
      hit: {
        yelp_id: b.id,
        yelp_name: b.name,
        yelp_city: yelpCity || targetCity,
        candidate,
        categoryAliases: (b.categories || []).map((c: any) => String(c.alias || "").toLowerCase()).filter(Boolean),
        categoryTitles: (b.categories || []).map((c: any) => String(c.title || "")).filter(Boolean),
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Missing supabase env" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Restrict callers: only requests bearing the service role key (used by
    // pg_cron and Lovable server-side invocations) are allowed. We accept
    // either a direct match on SUPABASE_SERVICE_ROLE_KEY, or any JWT whose
    // `role` claim is `service_role` (handles legacy/new key formats).
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    let authorized = false;
    if (token && token === SUPABASE_SERVICE_ROLE_KEY) {
      authorized = true;
    } else if (token) {
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(
            atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
          );
          if (payload?.role === "service_role") authorized = true;
        }
      } catch (_) { /* ignore */ }
    }
    if (!authorized) {
      console.log("forbidden: missing or non-service-role token");
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
      return new Response(JSON.stringify({ ok: true, message: "No cities in this chunk", chunk }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
      return new Response(
        JSON.stringify({
          ok: true,
          debug: true,
          cities: batch,
          window: { from: sevenDaysAgoStr, to: todayStr, days: lookbackDays },
          candidate_count: candidates.length,
          per_city_counts: perCity,
          candidates,
          grounding,
          raw_ai_response: raw,
        }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const summary: Array<{
      city: string;
      candidates: number;
      verified: number;
      inserted: number;
      skipped: number;
      error?: string;
    }> = [];

    let totalInserted = 0;

    // Process cities in batches — one Gemini grounded call per batch (cuts daily
    // grounded-call usage to fit free-tier 20/day cap).
    for (let i = 0; i < citiesToScan.length; i += BATCH_SIZE) {
      const batch = citiesToScan.slice(i, i + BATCH_SIZE);
      const batchLabel = batch.join(" | ");

      // Initialize per-city result rows so cities with zero candidates still appear.
      const batchResults = new Map<string, typeof summary[number]>();
      for (const c of batch) {
        batchResults.set(c, { city: c, candidates: 0, verified: 0, inserted: 0, skipped: 0 });
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
            console.log(`[db ${cand.city}] INSERTED yelp_id=${hit.yelp_id} "${hit.yelp_name}"`);
          } else {
            console.log(`[db ${cand.city}] NOT-INSERTED yelp_id=${hit.yelp_id} "${hit.yelp_name}" — duplicate (already in restaurant_sightings)`);
          }
        }

        // Log per-city scan rows for every city in the batch
        for (const [city, r] of batchResults) {
          await supabase.from("scan_log").insert({ city, new_count: r.inserted });
        }
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

    return new Response(
      JSON.stringify({ ok: true, total_inserted: totalInserted, elapsed_ms: elapsedMs, summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[discover] fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
