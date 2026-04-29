// Periodic refresh of restaurant metadata (price, rating, review_count,
// categories) and vibe text for sightings whose `restaurant_metrics.updated_at`
// is older than `staleness_days` (default 3) — OR which have no metrics row yet.
//
// Image URL is intentionally NOT touched: the image set at discovery is kept
// stable to avoid surprise cover swaps. Other display fields (name, address,
// phone, url, coordinates) are also left alone here — discover-new-restaurants
// owns their initial write, and the Feed lazy-fills if any are missing.
//
// Invoke: POST /backfill-categories  (Authorization: Bearer <service_role>)
//   body / query: { staleness_days?: 3, limit?: 500, dry_run?: false }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const YELP_API_URL = "https://api.yelp.com/v3";

// ===== Inlined YelpKeyPool (mirror of discover-new-restaurants) =====
interface YelpFetchResult {
  ok: boolean; status: number; body?: any; rateLimited: boolean;
  authError: boolean; keyName: string; exhaustedAllKeys?: boolean;
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
      .from("api_key_status").select("key_name, reset_at")
      .eq("provider", "yelp").in("key_name", candidates.map((c) => c.name));
    const now = new Date();
    const statusMap = new Map<string, any>();
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

  private async markExhausted(keyName: string, status: number, errorBody: string) {
    const resetAt = nextYelpReset();
    const entry = this.keys.find((k) => k.name === keyName);
    if (entry) { entry.exhausted = true; entry.resetAt = resetAt; }
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Missing supabase env" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role-only gate.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const authorized = token.length > 0 && token === SUPABASE_SERVICE_ROLE_KEY;
    if (!authorized) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Params
    const url = new URL(req.url);
    let stalenessDays = parseInt(url.searchParams.get("staleness_days") || "3", 10);
    let limit = parseInt(url.searchParams.get("limit") || "500", 10);
    let dryRun = url.searchParams.get("dry_run") === "true";
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (typeof body?.staleness_days === "number") stalenessDays = body.staleness_days;
        if (typeof body?.limit === "number") limit = body.limit;
        if (typeof body?.dry_run === "boolean") dryRun = body.dry_run;
      } catch (_) { /* no body, ok */ }
    }
    stalenessDays = Math.max(1, Math.min(stalenessDays, 365));
    limit = Math.max(1, Math.min(limit, 5000));

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const stalenessCutoff = new Date(Date.now() - stalenessDays * 24 * 3600 * 1000).toISOString();

    // 1. Get all sighting yelp_ids (paginate past 1000-row default).
    const allSightings: { yelp_id: string; city: string }[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: page, error } = await supabase
        .from("restaurant_sightings")
        .select("yelp_id, city")
        .range(from, from + PAGE - 1);
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!page || page.length === 0) break;
      allSightings.push(...page);
      if (page.length < PAGE) break;
    }

    if (allSightings.length === 0) {
      return new Response(JSON.stringify({ scanned: 0, refreshable: 0, updated: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch metrics.updated_at for staleness filter.
    const ids = allSightings.map((s) => s.yelp_id);
    const metricsUpdated = new Map<string, number>(); // yelp_id -> updated_at ms; absent = no metrics row
    for (let i = 0; i < ids.length; i += 1000) {
      const slice = ids.slice(i, i + 1000);
      const { data: rows } = await supabase
        .from("restaurant_metrics")
        .select("yelp_id, updated_at")
        .in("yelp_id", slice);
      for (const r of rows || []) metricsUpdated.set(r.yelp_id, new Date(r.updated_at).getTime());
    }
    const cutoffMs = new Date(stalenessCutoff).getTime();

    // 3. Build refresh list: missing metrics OR metrics older than cutoff. Stalest first.
    const refreshTargets = allSightings
      .filter((s) => {
        const ts = metricsUpdated.get(s.yelp_id);
        return ts === undefined || ts < cutoffMs;
      })
      .sort((a, b) => (metricsUpdated.get(a.yelp_id) ?? 0) - (metricsUpdated.get(b.yelp_id) ?? 0))
      .slice(0, limit);

    const uncachedCount = refreshTargets.filter((s) => !metricsUpdated.has(s.yelp_id)).length;
    console.log(`[refresh-metrics] sightings=${allSightings.length} stale=${refreshTargets.length} (uncached=${uncachedCount}, restale=${refreshTargets.length - uncachedCount}) staleness_days=${stalenessDays} dry=${dryRun}`);

    if (dryRun) {
      return new Response(JSON.stringify({
        scanned: allSightings.length, refreshable: refreshTargets.length, updated: 0, metrics_updated: 0,
        sample: refreshTargets.slice(0, 10).map((m) => ({
          yelp_id: m.yelp_id, city: m.city,
          metrics_age_ms: metricsUpdated.get(m.yelp_id) ? Date.now() - (metricsUpdated.get(m.yelp_id) as number) : null,
        })),
        staleness_days: stalenessDays, limit, dry_run: true,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const pool = new YelpKeyPool(supabase);
    await pool.load();

    let updated = 0;
    let metricsUpdatedCount = 0;
    let vibesRefreshed = 0;
    let vibesFailed = 0;
    let yelpErrors = 0;
    let exhausted = false;

    for (const m of refreshTargets) {
      const detailRes = await pool.fetch(`${YELP_API_URL}/businesses/${m.yelp_id}`);
      if (!detailRes.ok) {
        if (detailRes.exhaustedAllKeys) {
          console.error(`[refresh-metrics] ALL YELP KEYS EXHAUSTED at ${m.yelp_id}`);
          exhausted = true;
          break;
        }
        console.error(`[refresh-metrics] yelp error ${detailRes.status} for ${m.yelp_id}`);
        yelpErrors++;
        continue;
      }
      const biz = detailRes.body;

      // Categories (Offers) — refresh
      const aliases = (biz.categories || []).map((c: any) => String(c.alias || "").toLowerCase()).filter(Boolean);
      const titles = (biz.categories || []).map((c: any) => String(c.title || "")).filter(Boolean);
      const { error: upErr } = await supabase
        .from("restaurant_categories")
        .upsert(
          { yelp_id: m.yelp_id, aliases, titles, updated_at: new Date().toISOString() },
          { onConflict: "yelp_id" },
        );
      if (upErr) {
        console.error(`[refresh-metrics] categories upsert failed ${m.yelp_id}: ${upErr.message}`);
      } else {
        updated++;
      }

      // Metrics — refresh price/rating/review_count ONLY. Image URL and other
      // display fields (name/address/phone/url/coords) are intentionally not
      // touched here; they were set by discover-new-restaurants on first sight.
      const priceLevel = typeof biz.price === "string" && biz.price.length > 0 ? biz.price.length : null;
      const { error: metErr } = await supabase
        .from("restaurant_metrics")
        .upsert(
          {
            yelp_id: m.yelp_id,
            price_level: priceLevel,
            rating: typeof biz.rating === "number" ? biz.rating : null,
            review_count: typeof biz.review_count === "number" ? biz.review_count : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "yelp_id" },
        );
      if (metErr) {
        console.error(`[refresh-metrics] metrics upsert failed ${m.yelp_id}: ${metErr.message}`);
      } else {
        metricsUpdatedCount++;
      }

      // Vibe — regenerate (overwrites atmosphere_cache)
      try {
        const vRes = await fetch(`${SUPABASE_URL}/functions/v1/generate-vibe`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ yelp_id: m.yelp_id }),
        });
        const vData = await vRes.json();
        if (vData?.ok) vibesRefreshed++;
        else { vibesFailed++; console.warn(`[refresh-metrics→vibe] ${m.yelp_id} failed: ${vData?.reason || vRes.status}`); }
      } catch (e) {
        vibesFailed++;
        console.error(`[refresh-metrics→vibe] ${m.yelp_id} threw: ${e instanceof Error ? e.message : e}`);
      }

      console.log(`[refresh-metrics] refreshed ${m.yelp_id} (${m.city}) price=${priceLevel} rating=${biz.rating} reviews=${biz.review_count} aliases=[${aliases.join(",")}]`);

      // Light throttle between businesses to spare downstream services.
      await new Promise((r) => setTimeout(r, 250));
    }

    return new Response(JSON.stringify({
      scanned: allSightings.length, refreshable: refreshTargets.length,
      updated, metrics_updated: metricsUpdatedCount,
      vibes_refreshed: vibesRefreshed, vibes_failed: vibesFailed,
      yelp_errors: yelpErrors, exhausted, staleness_days: stalenessDays, limit,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("refresh-metrics error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
