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
  "Farmington Hills, MI", "Southfield, MI", "Warren, MI", "Sterling Heights, MI",
  "Rochester Hills, MI", "Clinton Township, MI", "Pontiac, MI", "West Bloomfield, MI",
  "Taylor, MI", "Ferndale, MI", "Ypsilanti, MI", "Northville, MI", "Grosse Pointe, MI",
  "Bloomfield Hills, MI", "Wyandotte, MI", "Monroe, MI", "Port Huron, MI",
  "Shelby Township, MI", "Waterford, MI",
];

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const YELP_SEARCH_URL = "https://api.yelp.com/v3/businesses/search";

interface Candidate {
  name: string;
  address: string;
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
  city: string,
  today: string,
  sevenDaysAgo: string,
  debug = false,
): Promise<{ candidates: Candidate[]; raw?: any; grounding?: GroundingInfo }> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const prompt = `Search the web for restaurants that officially opened for business in ${city} between ${sevenDaysAgo} and ${today}. Only include permanent locations that are currently fully operational. Exclude pop-ups, food trucks without a permanent address, planned/announced openings, and locations that have already closed.

Return ONLY a JSON array, with no prose, no explanation, and no markdown code fencing. Each item must have exactly this shape:
{"name": "Restaurant name", "address": "Street address, City, State"}

If you find no qualifying restaurants, return exactly: []`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2 },
  };

  if (debug) console.log(`[${city}] DEBUG request body:`, JSON.stringify(body));

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    if (debug) console.log(`[${city}] DEBUG error response [${res.status}]:`, text);
    if (res.status === 429) {
      throw new Error(`Gemini rate limited (free tier 15 RPM / 1500 req/day): ${text.slice(0, 200)}`);
    }
    if (res.status === 403 && text.includes("API_KEY_INVALID")) {
      throw new Error(`Gemini API key invalid — rotate GEMINI_API_KEY: ${text.slice(0, 200)}`);
    }
    throw new Error(`Gemini call failed [${res.status}]: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  if (debug) console.log(`[${city}] DEBUG raw Gemini response:`, JSON.stringify(data));

  // Extract grounding metadata for debug surfacing
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

  // Concat all text parts (model sometimes splits)
  const parts = data?.candidates?.[0]?.content?.parts;
  let text = "";
  if (Array.isArray(parts)) {
    text = parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("").trim();
  }

  if (!text) {
    console.warn(`[${city}] no text in Gemini response`);
    return { candidates: [], raw: debug ? data : undefined, grounding };
  }

  // Strip optional ```json ... ``` fencing
  let jsonText = text;
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) jsonText = fenceMatch[1].trim();

  // If model added prose, try to find the first JSON array in the text
  if (!jsonText.startsWith("[")) {
    const arrMatch = jsonText.match(/\[[\s\S]*\]/);
    if (arrMatch) jsonText = arrMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonText);
    if (debug) console.log(`[${city}] DEBUG parsed candidates:`, JSON.stringify(parsed));
    const list = Array.isArray(parsed) ? parsed : [];
    const candidates = list
      .filter((r: any) => r && typeof r.name === "string" && typeof r.address === "string")
      .map((r: any) => ({ name: r.name.trim(), address: r.address.trim() }));
    return { candidates, raw: debug ? data : undefined, grounding };
  } catch (e) {
    console.warn(`[${city}] failed to parse Gemini text as JSON:`, e);
    if (debug) console.log(`[${city}] DEBUG raw text:`, text);
    return { candidates: [], raw: debug ? data : undefined, grounding };
  }
}

interface VerifiedHit {
  yelp_id: string;
  yelp_name: string;
  yelp_city: string;
  candidate: Candidate;
}

async function verifyOnYelp(
  pool: YelpKeyPool,
  candidate: Candidate,
  targetCity: string,
): Promise<VerifiedHit | null> {
  const params = new URLSearchParams({
    term: candidate.name,
    location: candidate.address,
    limit: "3",
    categories: "restaurants,food",
  });
  const url = `${YELP_SEARCH_URL}?${params.toString()}`;

  const res = await pool.fetch(url);
  if (!res.ok) {
    console.warn(`[verify] Yelp search failed for "${candidate.name}": status=${res.status}`);
    return null;
  }

  const businesses: any[] = res.body?.businesses || [];
  for (const b of businesses) {
    if (!b?.id || !b?.name) continue;
    const yelpCity: string | undefined = b?.location?.city;
    if (!namesMatch(candidate.name, b.name)) continue;
    if (!cityMatch(targetCity, yelpCity)) continue;
    return {
      yelp_id: b.id,
      yelp_name: b.name,
      yelp_city: yelpCity || targetCity,
      candidate,
    };
  }
  return null;
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
    let citiesToScan: string[] = [...SE_MICHIGAN_CITIES];
    let lookbackDays = 30;
    let debug = false;
    try {
      const url = new URL(req.url);
      const citiesParam = url.searchParams.get("cities");
      const daysParam = url.searchParams.get("days");
      const debugParam = url.searchParams.get("debug");
      if (citiesParam) {
        citiesToScan = citiesParam.split("|").map((c) => c.trim()).filter(Boolean);
      }
      if (daysParam) {
        const n = parseInt(daysParam, 10);
        if (!Number.isNaN(n) && n > 0 && n <= 90) lookbackDays = n;
      }
      if (debugParam === "1" || debugParam === "true") debug = true;
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (Array.isArray(body?.cities) && body.cities.length > 0) {
          citiesToScan = body.cities.map((c: any) => String(c).trim()).filter(Boolean);
        }
        if (typeof body?.days === "number" && body.days > 0 && body.days <= 90) {
          lookbackDays = body.days;
        }
        if (body?.debug === true) debug = true;
      }
    } catch (_e) { /* ignore parse errors, use defaults */ }

    // Validate against known cities (drop unknowns rather than waste AI calls)
    const knownSet = new Set(SE_MICHIGAN_CITIES);
    const unknown = citiesToScan.filter((c) => !knownSet.has(c));
    citiesToScan = citiesToScan.filter((c) => knownSet.has(c));
    if (unknown.length > 0) console.warn(`[discover] ignoring unknown cities: ${unknown.join(" | ")}`);
    if (citiesToScan.length === 0) {
      return new Response(JSON.stringify({ error: "No valid cities to scan" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - lookbackDays * 24 * 3600 * 1000);
    const todayStr = formatDate(today);
    const sevenDaysAgoStr = formatDate(sevenDaysAgo);

    console.log(`[discover] starting scan: ${sevenDaysAgoStr} → ${todayStr} (${lookbackDays}d), ${citiesToScan.length} cities${debug ? " [DEBUG MODE]" : ""}`);

    // Debug mode: hit only the first city, return raw AI response, skip Yelp/insert.
    if (debug) {
      const city = citiesToScan[0];
      console.log(`[discover] DEBUG mode — single city only: ${city}`);
      const { candidates, raw, grounding } = await callGeminiGrounded(city, todayStr, sevenDaysAgoStr, true);
      return new Response(
        JSON.stringify({
          ok: true,
          debug: true,
          city,
          window: { from: sevenDaysAgoStr, to: todayStr, days: lookbackDays },
          candidate_count: candidates.length,
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

    for (const city of citiesToScan) {

      const cityResult = { city, candidates: 0, verified: 0, inserted: 0, skipped: 0 } as typeof summary[number];
      try {
        const { candidates } = await callGeminiGrounded(city, todayStr, sevenDaysAgoStr);
        cityResult.candidates = candidates.length;
        console.log(`[${city}] AI returned ${candidates.length} candidates`);

        for (const cand of candidates) {
          const hit = await verifyOnYelp(pool, cand, city);
          if (!hit) {
            cityResult.skipped++;
            console.log(`[${city}] SKIP "${cand.name}" — no Yelp match`);
            continue;
          }
          cityResult.verified++;

          const { error: insertErr, data: inserted } = await supabase
            .from("restaurant_sightings")
            .upsert(
              {
                yelp_id: hit.yelp_id,
                city,
                first_seen_at: new Date().toISOString(),
                is_new_discovery: true,
              },
              { onConflict: "yelp_id", ignoreDuplicates: true },
            )
            .select();

          if (insertErr) {
            console.error(`[${city}] insert failed for ${hit.yelp_id}:`, insertErr.message);
            continue;
          }
          if (inserted && inserted.length > 0) {
            cityResult.inserted++;
            totalInserted++;
            console.log(`[${city}] INSERTED ${hit.yelp_id} "${hit.yelp_name}"`);
          } else {
            console.log(`[${city}] DUPLICATE ${hit.yelp_id} "${hit.yelp_name}" — already tracked`);
          }
        }

        // Log per-city scan
        await supabase.from("scan_log").insert({
          city,
          new_count: cityResult.inserted,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        cityResult.error = msg;
        console.error(`[${city}] city failed:`, msg);
      }
      summary.push(cityResult);

      // Throttle 7s between cities to stay under Gemini grounded free tier (~10 RPM)
      await new Promise((r) => setTimeout(r, 7000));
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
