// Cron-triggered (hourly): for each enabled subscription, if their cadence
// is due and they have new restaurants in their selected cities, send a push.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWebPush } from "../_shared/webpush.ts";

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

// Returns the current hour (0-23) at the given IANA timezone.
function localHourIn(tz: string): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });
    return parseInt(fmt.format(new Date()), 10);
  } catch {
    // Fallback to ET if the stored timezone is somehow invalid.
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Detroit",
      hour: "numeric",
      hour12: false,
    });
    return parseInt(fmt.format(new Date()), 10);
  }
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
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:noreply@plateping.app";

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return new Response(JSON.stringify({ error: "VAPID keys not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorize: only service role
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    let authorized = token === SUPABASE_SERVICE_ROLE_KEY;
    if (!authorized && token) {
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
          if (payload?.role === "service_role") authorized = true;
        }
      } catch {}
    }
    if (!authorized) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
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

      // Local-time-of-day gate: only deliver during the device's preferred hour.
      // Cron runs hourly, so this naturally lands the push within that local hour.
      const targetHour = sub.preferred_hour ?? 10;
      const currentLocalHour = localHourIn(sub.timezone || "America/Detroit");
      if (currentLocalHour !== targetHour) {
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
