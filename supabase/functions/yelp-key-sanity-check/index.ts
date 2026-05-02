// One-off sanity check: hit Yelp search with each key, log results,
// and update api_key_status with the outcome.
// Keys have a monthly quota of 3,000 requests, resetting on the 1st of each month.

import { handleOptions, jsonResponse, getServiceClientOr500 } from "../_shared/http.ts";

const TEST_URL = "https://api.yelp.com/v3/businesses/search?location=Detroit%2C+MI&limit=1";
const MONTHLY_QUOTA = 3000;

/** 1st of next month, midnight UTC. */
function nextMonthlyReset(): Date {
  const now = new Date();
  const year = now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const month = now.getUTCMonth() === 11 ? 0 : now.getUTCMonth() + 1;
  return new Date(Date.UTC(year, month, 1, 0, 0, 0));
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const { client: supabase, error: clientErr } = getServiceClientOr500();
  if (clientErr) return clientErr;

  // Load current DB state for remaining_uses
  const { data: dbStatuses } = await supabase
    .from("api_key_status")
    .select("key_name, remaining_uses")
    .eq("provider", "yelp");
  const remainingMap = new Map<string, number>();
  for (const s of dbStatuses || []) remainingMap.set(s.key_name, s.remaining_uses ?? MONTHLY_QUOTA);

  const keyNames = ["YELP_API_KEY", "YELP_API_KEY_2", "YELP_API_KEY_3", "YELP_API_KEY_4"];
  const results: Array<Record<string, unknown>> = [];

  for (const name of keyNames) {
    const value = Deno.env.get(name);
    if (!value) {
      console.log(`[sanity] ${name}: NOT SET`);
      results.push({ key_name: name, present: false, status: null, verdict: "missing", remaining_uses: null, monthly_quota: MONTHLY_QUOTA });
      continue;
    }

    try {
      const res = await fetch(TEST_URL, {
        headers: { Authorization: `Bearer ${value}`, Accept: "application/json" },
      });

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
          ? "monthly_quota_exhausted" : "rate_limited_transient";
      } else {
        verdict = `error_${res.status}`;
      }

      const currentRemaining = remainingMap.get(name) ?? MONTHLY_QUOTA;
      console.log(`[sanity] ${name}: status=${res.status} verdict=${verdict} remaining=${currentRemaining}/${MONTHLY_QUOTA}`);

      // Update api_key_status
      if (verdict === "healthy") {
        await supabase.from("api_key_status").upsert({
          provider: "yelp",
          key_name: name,
          exhausted_at: null,
          reset_at: null,
          last_error: null,
          last_status: res.status,
          remaining_uses: currentRemaining,
          updated_at: new Date().toISOString(),
        }, { onConflict: "key_name" });
      } else {
        const resetAt = nextMonthlyReset();
        await supabase.from("api_key_status").upsert({
          provider: "yelp",
          key_name: name,
          exhausted_at: new Date().toISOString(),
          reset_at: verdict.includes("quota") ? resetAt.toISOString() : null,
          last_error: snippet,
          last_status: res.status,
          remaining_uses: verdict.includes("quota") ? 0 : currentRemaining,
          updated_at: new Date().toISOString(),
        }, { onConflict: "key_name" });
      }

      results.push({
        key_name: name,
        present: true,
        status: res.status,
        verdict,
        remaining_uses: verdict.includes("quota") ? 0 : currentRemaining,
        monthly_quota: MONTHLY_QUOTA,
        body_snippet: res.ok ? undefined : snippet,
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[sanity] ${name}: FETCH ERROR — ${errMsg}`);
      results.push({ key_name: name, present: true, status: null, verdict: "fetch_error", error: errMsg, remaining_uses: remainingMap.get(name) ?? null, monthly_quota: MONTHLY_QUOTA });
    }
  }

  return jsonResponse({ checked_at: new Date().toISOString(), results });
});
