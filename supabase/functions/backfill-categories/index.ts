// On-demand backfill of restaurant_categories for sightings first seen in the
// last N days that don't yet have a cache row. Service-role gated.
//
// Invoke: POST /backfill-categories  (Authorization: Bearer <service_role>)
//   body / query: { days?: 30, limit?: 500, dry_run?: false }

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

    // Service-role-only gate (mirror of discover-new-restaurants)
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    let authorized = false;
    if (token && token === SUPABASE_SERVICE_ROLE_KEY) {
      authorized = true;
    } else if (token) {
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
          if (payload?.role === "service_role") authorized = true;
        }
      } catch (_) { /* ignore */ }
    }
    if (!authorized) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse params (query OR JSON body)
    const url = new URL(req.url);
    let days = parseInt(url.searchParams.get("days") || "30", 10);
    let limit = parseInt(url.searchParams.get("limit") || "500", 10);
    let dryRun = url.searchParams.get("dry_run") === "true";
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (typeof body?.days === "number") days = body.days;
        if (typeof body?.limit === "number") limit = body.limit;
        if (typeof body?.dry_run === "boolean") dryRun = body.dry_run;
      } catch (_) { /* no body, ok */ }
    }
    days = Math.max(1, Math.min(days, 365));
    limit = Math.max(1, Math.min(limit, 2000));

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

    // Pull recent sightings
    const { data: sightings, error: sErr } = await supabase
      .from("restaurant_sightings")
      .select("yelp_id, city, first_seen_at")
      .gte("first_seen_at", since)
      .order("first_seen_at", { ascending: false })
      .limit(limit);

    if (sErr) {
      console.error("sightings query error", sErr);
      return new Response(JSON.stringify({ error: sErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!sightings || sightings.length === 0) {
      return new Response(JSON.stringify({ scanned: 0, missing: 0, updated: 0, days, limit }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ids = sightings.map((s) => s.yelp_id);
    const [{ data: existingCats }, { data: existingMetrics }] = await Promise.all([
      supabase.from("restaurant_categories").select("yelp_id").in("yelp_id", ids),
      supabase.from("restaurant_metrics").select("yelp_id").in("yelp_id", ids),
    ]);
    const haveCats = new Set((existingCats || []).map((r: any) => r.yelp_id));
    const haveMetrics = new Set((existingMetrics || []).map((r: any) => r.yelp_id));
    // Missing = sighting lacks EITHER cache row
    const missing = sightings.filter((s) => !haveCats.has(s.yelp_id) || !haveMetrics.has(s.yelp_id));

    console.log(`[backfill] scanned=${sightings.length} missing=${missing.length} (cats_missing=${sightings.length - haveCats.size}, metrics_missing=${sightings.length - haveMetrics.size}) days=${days} dry=${dryRun}`);

    if (dryRun) {
      return new Response(JSON.stringify({
        scanned: sightings.length, missing: missing.length, updated: 0, metrics_updated: 0,
        sample: missing.slice(0, 10).map((m) => ({ yelp_id: m.yelp_id, city: m.city })),
        days, limit, dry_run: true,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const pool = new YelpKeyPool(supabase);
    await pool.load();

    let updated = 0;
    let yelpErrors = 0;
    let exhausted = false;

    for (const m of missing) {
      const detailRes = await pool.fetch(`${YELP_API_URL}/businesses/${m.yelp_id}`);
      if (!detailRes.ok) {
        if (detailRes.exhaustedAllKeys) {
          console.error(`[backfill] ALL YELP KEYS EXHAUSTED at ${m.yelp_id}`);
          exhausted = true;
          break;
        }
        console.error(`[backfill] yelp error ${detailRes.status} for ${m.yelp_id}`);
        yelpErrors++;
        continue;
      }
      const biz = detailRes.body;
      const aliases = (biz.categories || []).map((c: any) => String(c.alias || "").toLowerCase()).filter(Boolean);
      const titles = (biz.categories || []).map((c: any) => String(c.title || "")).filter(Boolean);

      const { error: upErr } = await supabase
        .from("restaurant_categories")
        .upsert(
          { yelp_id: m.yelp_id, aliases, titles, updated_at: new Date().toISOString() },
          { onConflict: "yelp_id" },
        );
      if (upErr) {
        console.error(`[backfill] upsert failed ${m.yelp_id}: ${upErr.message}`);
        continue;
      }
      updated++;
      console.log(`[backfill] cached ${m.yelp_id} (${m.city}) aliases=[${aliases.join(",")}]`);
    }

    return new Response(JSON.stringify({
      scanned: sightings.length, missing: missing.length, updated,
      yelp_errors: yelpErrors, exhausted, days, limit,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("backfill-categories error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
