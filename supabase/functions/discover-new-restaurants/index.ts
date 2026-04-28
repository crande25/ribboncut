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

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
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

async function callLovableAI(city: string, today: string, sevenDaysAgo: string): Promise<Candidate[]> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

  const prompt = `Search for and list all restaurants that officially opened for business in ${city} between ${sevenDaysAgo} and ${today}. For each result, provide only the restaurant name and address. Do not include opening dates, source links, cuisine type, or any additional commentary or descriptions. Focus only on permanent locations that are currently fully operational.`;

  const body = {
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: "You are a precise local-news researcher. Return only verified, permanent, currently operating restaurants. If none are found, return an empty list." },
      { role: "user", content: prompt },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "report_new_restaurants",
          description: "Report newly opened restaurants found in the search.",
          parameters: {
            type: "object",
            properties: {
              restaurants: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Restaurant name only" },
                    address: { type: "string", description: "Street address with city/state" },
                  },
                  required: ["name", "address"],
                  additionalProperties: false,
                },
              },
            },
            required: ["restaurants"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "report_new_restaurants" } },
  };

  const res = await fetch(LOVABLE_AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error(`AI rate limited: ${text.slice(0, 200)}`);
    if (res.status === 402) throw new Error(`AI credits exhausted: ${text.slice(0, 200)}`);
    throw new Error(`AI call failed [${res.status}]: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    console.warn(`[${city}] no tool_call in AI response`);
    return [];
  }

  try {
    const parsed = JSON.parse(toolCall.function.arguments);
    const list = Array.isArray(parsed?.restaurants) ? parsed.restaurants : [];
    return list
      .filter((r: any) => r && typeof r.name === "string" && typeof r.address === "string")
      .map((r: any) => ({ name: r.name.trim(), address: r.address.trim() }));
  } catch (e) {
    console.warn(`[${city}] failed to parse tool args:`, e);
    return [];
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

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const pool = new YelpKeyPool(supabase);
    await pool.load();

    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 3600 * 1000);
    const todayStr = formatDate(today);
    const sevenDaysAgoStr = formatDate(sevenDaysAgo);

    console.log(`[discover] starting daily scan: ${sevenDaysAgoStr} → ${todayStr}, ${SE_MICHIGAN_CITIES.length} cities`);

    const summary: Array<{
      city: string;
      candidates: number;
      verified: number;
      inserted: number;
      skipped: number;
      error?: string;
    }> = [];

    let totalInserted = 0;

    for (const city of SE_MICHIGAN_CITIES) {
      const cityResult = { city, candidates: 0, verified: 0, inserted: 0, skipped: 0 } as typeof summary[number];
      try {
        const candidates = await callLovableAI(city, todayStr, sevenDaysAgoStr);
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

      // Throttle 600ms between cities
      await new Promise((r) => setTimeout(r, 600));
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
