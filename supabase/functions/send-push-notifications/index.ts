// Cron-triggered (hourly): for each enabled subscription, if their cadence
// is due and they have new restaurants in their selected cities, send a push.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWebPush } from "../_shared/webpush.ts";
import { checkInternalAuth } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FREQUENCY_HOURS: Record<string, number> = {
  daily: 24,
  "3days": 72,
  weekly: 168,
};

interface Subscription {
  id: string;
  device_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  cities: string[];
  frequency: string;
  last_notified_at: string | null;
  enabled: boolean;
  created_at: string;
  timezone: string;
  preferred_hour: number;
}

// Returns { hour, minute } at the given IANA timezone.
function localTimeIn(tz: string): { hour: number; minute: number } {
  const safeTz = (() => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {
      return "America/Detroit";
    }
  })();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { hour, minute };
}

function buildBody(count: number, cities: string[]): { title: string; body: string } {
  const cityNames = cities.map((c) => c.replace(/,\s*[A-Z]{2}$/, ""));
  const cityText =
    cityNames.length === 1 ? cityNames[0] :
    cityNames.length === 2 ? `${cityNames[0]} & ${cityNames[1]}` :
    `${cityNames[0]}, ${cityNames[1]} +${cityNames.length - 2} more`;
  const title = count === 1 ? "1 new restaurant just opened" : `${count} new restaurants just opened`;
  const body = `In ${cityText} — tap to see what's new`;
  return { title, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:noreply@ribboncut.app";

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return new Response(JSON.stringify({ error: "VAPID keys not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorize via INTERNAL_CRON_TOKEN (constant-time compare against Vault-backed shared secret).
    const auth = checkInternalAuth(req);
    if (!auth.ok) {
      return new Response(JSON.stringify(auth.body), {
        status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("enabled", true);

    if (error) throw error;
    const subscriptions = (subs || []) as Subscription[];
    console.log(`[send-push] found ${subscriptions.length} enabled subscriptions`);

    const now = new Date();
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let disabled = 0;

    for (const sub of subscriptions) {
      // Skip if no cities targeted or no frequency chosen
      if (!sub.cities || sub.cities.length === 0 || !sub.frequency) {
        skipped++;
        continue;
      }

      // Local-time-of-day gate: deliver only during the 10:30 AM half-hour
      // (or whatever preferred_hour is set to, at :30 past). The cron runs
      // every 30 minutes, so the matching slot fires once per day per device.
      const targetHour = sub.preferred_hour ?? 10;
      const { hour: lh, minute: lm } = localTimeIn(sub.timezone || "America/Detroit");
      if (lh !== targetHour || lm < 30) {
        skipped++;
        continue;
      }


      const hoursNeeded = FREQUENCY_HOURS[sub.frequency] ?? 24;
      const sinceTs = sub.last_notified_at
        ? new Date(sub.last_notified_at)
        : new Date(sub.created_at);
      const hoursSince = (now.getTime() - sinceTs.getTime()) / 3_600_000;
      if (hoursSince < hoursNeeded) {
        skipped++;
        continue;
      }

      // Find new restaurants since last notification (or since subscription created)
      const { data: sightings, error: sightErr } = await supabase
        .from("restaurant_sightings")
        .select("yelp_id, city, first_seen_at")
        .in("city", sub.cities)
        .eq("is_new_discovery", true)
        .gte("first_seen_at", sinceTs.toISOString());

      if (sightErr) {
        console.error(`[send-push] sightings query failed for ${sub.device_id.slice(0, 8)}:`, sightErr.message);
        failed++;
        continue;
      }

      const newCount = sightings?.length || 0;
      if (newCount === 0) {
        // Don't update last_notified_at — wait until there's actually news to deliver
        skipped++;
        continue;
      }

      const matchingCities = Array.from(new Set((sightings || []).map((s) => s.city)));
      const { title, body } = buildBody(newCount, matchingCities);

      const result = await sendWebPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        { title, body, url: "/", tag: "new-restaurants" },
        {
          vapidPublic: VAPID_PUBLIC_KEY,
          vapidPrivate: VAPID_PRIVATE_KEY,
          vapidSubject: VAPID_SUBJECT,
        },
      );

      if (result.ok) {
        sent++;
        await supabase
          .from("push_subscriptions")
          .update({ last_notified_at: now.toISOString() })
          .eq("id", sub.id);
        console.log(`[send-push] sent device=${sub.device_id.slice(0, 8)} count=${newCount}`);
      } else if (result.gone) {
        disabled++;
        await supabase
          .from("push_subscriptions")
          .update({ enabled: false })
          .eq("id", sub.id);
        console.log(`[send-push] subscription gone (${result.status}) device=${sub.device_id.slice(0, 8)} — disabled`);
      } else {
        failed++;
        console.error(`[send-push] failed device=${sub.device_id.slice(0, 8)} status=${result.status} err=${result.error}`);
      }
    }

    const summary = { total: subscriptions.length, sent, skipped, failed, disabled };
    console.log("[send-push] DONE", JSON.stringify(summary));
    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[send-push] fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
