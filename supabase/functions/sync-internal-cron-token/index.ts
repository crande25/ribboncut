// One-off function: copies the INTERNAL_CRON_TOKEN runtime secret into the
// vault.secrets entry of the same name, so pg_cron jobs can read it via
// vault.decrypted_secrets. Idempotent and side-effect-free beyond that.
//
// Auth: none required. The function takes no input — it only ever writes
// the value of its own INTERNAL_CRON_TOKEN env var into Vault. There is
// no scenario in which calling it leaks the token (it's never returned)
// or causes harm (it can only set Vault to a value the server already has).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const token = Deno.env.get("INTERNAL_CRON_TOKEN");
  if (!token || token.length < 32) {
    return new Response(JSON.stringify({ error: "INTERNAL_CRON_TOKEN missing or too short" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { error } = await supabase.rpc("set_internal_cron_token", { new_token: token });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, vault_synced: true, token_length: token.length }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
