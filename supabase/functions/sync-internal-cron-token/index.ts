// One-off function: copies INTERNAL_CRON_TOKEN env var into vault.secrets so
// pg_cron jobs can read it. Idempotent. Requires INTERNAL_CRON_TOKEN to match
// the existing vault value OR for the vault entry to be empty/placeholder.
//
// Auth: requires header `x-sync-secret` matching INTERNAL_CRON_TOKEN itself
// (proof-of-possession).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const token = Deno.env.get("INTERNAL_CRON_TOKEN");
  if (!token || token.length < 32) {
    return new Response(JSON.stringify({ error: "INTERNAL_CRON_TOKEN not configured or too short" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const provided = req.headers.get("x-sync-secret") ?? "";
  // constant-time compare
  if (provided.length !== token.length) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ provided.charCodeAt(i);
  if (diff !== 0) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Use vault.update_secret if it exists, else delete + create.
  // We do this via a SECURITY DEFINER RPC we'll create in a migration.
  const { error } = await supabase.rpc("set_internal_cron_token", { new_token: token });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, length: token.length }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
