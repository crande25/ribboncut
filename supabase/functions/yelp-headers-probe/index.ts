// One-off diagnostic: hit Yelp /businesses/search with each YELP_API_KEY*
// env var and return the rate-limit headers Yelp sends back.
//
// Used to confirm whether RateLimit-ResetTime is populated for our keys
// (especially the ones currently in ACCESS_LIMIT_REACHED state) so we can
// drive the pool's reset_at off the real value instead of guessing.
//
// SAFE TO DELETE after diagnosis.

import { jsonResponse, handleOptions } from "../_shared/http.ts";

const YELP_URL = "https://api.yelp.com/v3/businesses/search?location=Detroit%2C+MI&limit=1";

function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replaceAll("-", "+").replaceAll("_", "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch { return null; }
}

const RL_HEADERS = [
  "ratelimit-dailylimit",
  "ratelimit-remaining",
  "ratelimit-resourcedailylimit",
  "ratelimit-resourceremaining",
  "ratelimit-resettime",
  "retry-after",
];

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const claims = parseJwtClaims(auth.slice(7).trim());
  if (claims?.role !== "service_role") {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  const keyNames = ["YELP_API_KEY", "YELP_API_KEY_2", "YELP_API_KEY_3", "YELP_API_KEY_4"];
  const out: Array<Record<string, unknown>> = [];

  for (const name of keyNames) {
    const value = Deno.env.get(name);
    if (!value) {
      out.push({ key_name: name, present: false });
      continue;
    }
    try {
      const res = await fetch(YELP_URL, {
        headers: { Authorization: `Bearer ${value}`, Accept: "application/json" },
      });
      const headers: Record<string, string> = {};
      for (const h of RL_HEADERS) {
        const v = res.headers.get(h);
        if (v !== null) headers[h] = v;
      }
      let bodySnippet: string | undefined;
      if (!res.ok) {
        const text = await res.text();
        bodySnippet = text.slice(0, 300);
      } else {
        await res.body?.cancel();
      }
      out.push({
        key_name: name,
        present: true,
        status: res.status,
        rate_limit_headers: headers,
        body_snippet: bodySnippet,
      });
    } catch (e) {
      out.push({ key_name: name, present: true, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return jsonResponse({ ok: true, probed_at: new Date().toISOString(), results: out });
});
