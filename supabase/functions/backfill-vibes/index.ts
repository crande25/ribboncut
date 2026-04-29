// One-time backfill: regenerates vibes for all current sightings.
//
// Iterates restaurant_sightings sequentially and calls generate-vibe for each.
// Overwrites any existing atmosphere_cache row. Throttled to be polite to
// Google Places, Yelp, and Lovable AI.
//
// Auth: requires the SUPABASE_SERVICE_ROLE_KEY in the Authorization header.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PER_CALL_DELAY_MS = 500;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "missing supabase env" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Optional body: { only_missing?: boolean } — default false (regenerate all)
    let onlyMissing = false;
    try {
      const body = await req.json();
      onlyMissing = Boolean(body?.only_missing);
    } catch {
      // empty body is fine
    }

    // Fetch all sighting yelp_ids
    const { data: sightings, error: sErr } = await supabase
      .from("restaurant_sightings")
      .select("yelp_id");
    if (sErr) {
      return new Response(JSON.stringify({ error: sErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let targets: string[] = (sightings || []).map((s: any) => s.yelp_id);

    if (onlyMissing) {
      const { data: cached } = await supabase
        .from("atmosphere_cache")
        .select("yelp_id");
      const cachedSet = new Set((cached || []).map((c: any) => c.yelp_id));
      targets = targets.filter((id) => !cachedSet.has(id));
    }

    console.log(`[backfill-vibes] processing ${targets.length} restaurants (only_missing=${onlyMissing})`);

    const startedAt = Date.now();
    const results = { ok: 0, failed: 0, sources: { google: 0, yelp: 0, none: 0 } as Record<string, number> };
    const failures: Array<{ yelp_id: string; reason: string }> = [];

    for (let i = 0; i < targets.length; i++) {
      const yelpId = targets[i];
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-vibe`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ yelp_id: yelpId }),
        });
        const data = await res.json();
        if (data?.ok) {
          results.ok++;
          const src = String(data?.source || "none");
          results.sources[src] = (results.sources[src] || 0) + 1;
        } else {
          results.failed++;
          failures.push({ yelp_id: yelpId, reason: String(data?.reason || `status ${res.status}`) });
          console.warn(`[backfill-vibes] ${yelpId} failed: ${data?.reason || res.status}`);
        }
      } catch (e) {
        results.failed++;
        const reason = e instanceof Error ? e.message : "unknown";
        failures.push({ yelp_id: yelpId, reason });
        console.error(`[backfill-vibes] ${yelpId} threw: ${reason}`);
      }
      // throttle
      if (i < targets.length - 1) {
        await new Promise((r) => setTimeout(r, PER_CALL_DELAY_MS));
      }
      // periodic progress log
      if ((i + 1) % 10 === 0) {
        console.log(`[backfill-vibes] progress ${i + 1}/${targets.length} ok=${results.ok} failed=${results.failed}`);
      }
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(`[backfill-vibes] DONE in ${elapsedMs}ms — ok=${results.ok} failed=${results.failed} sources=${JSON.stringify(results.sources)}`);

    return new Response(JSON.stringify({
      processed: targets.length,
      elapsedMs,
      ...results,
      failures: failures.slice(0, 50),
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[backfill-vibes] error:", e);
    const msg = e instanceof Error ? e.message : "unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
