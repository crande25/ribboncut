// Sends a single test notification to a device, for the user to verify push works.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWebPush } from "../_shared/webpush.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:noreply@ribboncut.app";

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return new Response(JSON.stringify({ error: "VAPID keys not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { device_id } = await req.json().catch(() => ({}));
    if (typeof device_id !== "string" || !device_id.trim()) {
      return new Response(JSON.stringify({ error: "device_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: sub, error } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("device_id", device_id)
      .eq("enabled", true)
      .maybeSingle();

    if (error) throw error;
    if (!sub) {
      return new Response(JSON.stringify({ error: "No active subscription for this device" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await sendWebPush(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      { title: "RibbonCut test 🍽️", body: "Push notifications are working!", url: "/", tag: "test-push" },
      { vapidPublic: VAPID_PUBLIC_KEY, vapidPrivate: VAPID_PRIVATE_KEY, vapidSubject: VAPID_SUBJECT },
    );

    if (result.gone) {
      await supabase.from("push_subscriptions").update({ enabled: false }).eq("id", sub.id);
      return new Response(JSON.stringify({ error: "Subscription expired — please re-enable notifications" }), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!result.ok) {
      console.error(`[test-push] failed status=${result.status} err=${result.error}`);
      return new Response(JSON.stringify({ error: `Push failed (${result.status}): ${result.error}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[test-push] fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
