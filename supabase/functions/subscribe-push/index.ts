// Upserts (or refreshes) a device's push subscription + targeting prefs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SubscribeBody {
  device_id?: string;
  subscription?: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  cities?: string[];
  frequency?: string;
  timezone?: string;
}

const ALLOWED_FREQ = new Set(["daily", "3days", "weekly"]);

// Validate IANA timezone string against the runtime's tz database.
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = (await req.json().catch(() => ({}))) as SubscribeBody;

    const device_id = typeof body.device_id === "string" ? body.device_id.trim() : "";
    const endpoint = body.subscription?.endpoint;
    const p256dh = body.subscription?.keys?.p256dh;
    const auth = body.subscription?.keys?.auth;
    const cities = Array.isArray(body.cities)
      ? body.cities.filter((c) => typeof c === "string" && c.length > 0).slice(0, 50)
      : [];
    const frequency = ALLOWED_FREQ.has(String(body.frequency)) ? String(body.frequency) : "daily";
    const tzCandidate = typeof body.timezone === "string" ? body.timezone.trim() : "";
    const timezone = tzCandidate && isValidTimezone(tzCandidate) ? tzCandidate : "America/Detroit";

    if (!device_id || !endpoint || !p256dh || !auth) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error } = await supabase
      .from("push_subscriptions")
      .upsert({
        device_id,
        endpoint,
        p256dh,
        auth,
        cities,
        frequency,
        timezone,
        enabled: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "device_id" });


    if (error) {
      console.error("[subscribe-push] db error:", error.message);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[subscribe-push] ok device=${device_id.slice(0, 8)} cities=${cities.length} freq=${frequency} tz=${timezone}`);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[subscribe-push] fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
