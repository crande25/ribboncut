// One-off sanity check: hit Yelp search with each key, log results,
// and update api_key_status with the outcome.

import { handleOptions, jsonResponse, getServiceClientOr500 } from "../_shared/http.ts";

const TEST_URL = "https://api.yelp.com/v3/businesses/search?location=Detroit%2C+MI&limit=1";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const { client: supabase, error: clientErr } = getServiceClientOr500();
  if (clientErr) return clientErr;

  const keyNames = ["YELP_API_KEY", "YELP_API_KEY_2", "YELP_API_KEY_3", "YELP_API_KEY_4"];
  const results: Array<Record<string, unknown>> = [];

  for (const name of keyNames) {
    const value = Deno.env.get(name);
    if (!value) {
      console.log(`[sanity] ${name}: NOT SET`);
      results.push({ key_name: name, present: false, status: null, verdict: "missing" });
      continue;
    }

    try {
      const res = await fetch(TEST_URL, {
        headers: { Authorization: `Bearer ${value}`, Accept: "application/json" },
      });

      const rlRemaining = res.headers.get("ratelimit-remaining");
      const rlDailyLimit = res.headers.get("ratelimit-dailylimit");
      const bodyText = await res.text();
      const snippet = bodyText.slice(0, 300);

      let verdict: string;
      if (res.ok) {
        verdict = "healthy";
      } else if (res.status === 401) {
        verdict = "auth_invalid";
      } else if (res.status === 403) {
        verdict = /TOKEN_INVALID|TOKEN_MISSING|TOKEN_REVOKED/i.test(bodyText)
          ? "token_problem" : "forbidden_other";
      } else if (res.status === 429) {
        verdict = /ACCESS_LIMIT_REACHED/i.test(bodyText)
          ? "daily_quota_exhausted" : "rate_limited_transient";
      } else {
        verdict = `error_${res.status}`;
      }

      console.log(`[sanity] ${name}: status=${res.status} verdict=${verdict} remaining=${rlRemaining}/${rlDailyLimit}`);

      // Update api_key_status
      if (verdict === "healthy") {
        // Clear any exhaustion
        await supabase.from("api_key_status").upsert({
          provider: "yelp",
          key_name: name,
          exhausted_at: null,
          reset_at: null,
          last_error: null,
          last_status: res.status,
          updated_at: new Date().toISOString(),
        }, { onConflict: "key_name" });
      } else {
        // Mark problematic
        const resetAt = new Date();
        resetAt.setUTCHours(resetAt.getUTCHours() + 8 + (24 - resetAt.getUTCHours())); // rough next midnight PT
        await supabase.from("api_key_status").upsert({
          provider: "yelp",
          key_name: name,
          exhausted_at: new Date().toISOString(),
          reset_at: verdict.includes("quota") ? resetAt.toISOString() : null,
          last_error: snippet,
          last_status: res.status,
          updated_at: new Date().toISOString(),
        }, { onConflict: "key_name" });
      }

      results.push({
        key_name: name,
        present: true,
        status: res.status,
        verdict,
        ratelimit_remaining: rlRemaining,
        ratelimit_daily_limit: rlDailyLimit,
        body_snippet: res.ok ? undefined : snippet,
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[sanity] ${name}: FETCH ERROR — ${errMsg}`);
      results.push({ key_name: name, present: true, status: null, verdict: "fetch_error", error: errMsg });
    }
  }

  return jsonResponse({ checked_at: new Date().toISOString(), results });
});
