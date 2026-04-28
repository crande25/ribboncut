## Secret-leakage audit

I scanned every `console.*` call, every place env vars are read, and every outbound `fetch` in the edge functions and client. Here is what I found, ranked by real risk.

### 1. HIGH-ish: Gemini API key in URL query string

`supabase/functions/discover-new-restaurants/index.ts:225`
```ts
res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, { ... });
```

We never log this URL directly today, BUT:
- Any future `console.log(url)` or unhandled fetch error that includes `res.url` would dump the key into Supabase edge logs (which are retained and searchable).
- Google's own server-side logs see the key in the query string (unavoidable for the v1beta REST endpoint, but we can stop mirroring it on our side).
- If Deno ever surfaces the URL inside a thrown `TypeError` (network failures sometimes do), the key would land in the catch-block `console.error("[discover] fatal:", msg)` at line 662.

**Fix**: send the key via header instead of query string. Google's Gemini REST API accepts `x-goog-api-key: <KEY>`. Then the URL is safe to log.

### 2. LOW: Yelp keys in `Authorization: Bearer …` headers

`supabase/functions/get-restaurants/yelpKeys.ts:143` and `discover-new-restaurants/index.ts:94`. Headers are never logged, response body errors are sliced to 200 chars and don't echo the request header. Safe today.

**Hardening**: keep an explicit rule never to log `req`/`fetch` objects whole — only specific fields. Already followed.

### 3. LOW: Service-role key usage

`get-restaurants/index.ts:70-71` puts `SUPABASE_SERVICE_ROLE_KEY` into request headers to PostgREST. Never logged. The error path at line 79 logs only `dbRes.status` and `errText` (response body, not request headers). Safe.

### 4. NOISE, not a leak: key *names* (not values) appear in logs

Lines like `[YelpKeyPool] marking YELP_API_KEY_2 EXHAUSTED…` log the env var **name**, not its value. Same for `key=${detailRes.keyName}` at `get-restaurants/index.ts:119`. This is fine — names are not secrets — but worth noting so we don't accidentally "fix" it by swapping in `key.value`.

### 5. Database

- `api_key_status` stores `key_name` (e.g. `"YELP_API_KEY_2"`), `last_status`, `last_error`. No key values written. Safe.
- `restaurant_sightings`, `scan_log`, `atmosphere_cache`: business data only.
- All four tables have public SELECT RLS, so we must continue to never write secrets into them. Currently true.

### 6. Disk

Edge functions are stateless; nothing is written to disk. Client writes only `useLocalStorage` keys (city selections, theme) and a `useDeviceId` UUID — no secrets.

### 7. Client (`src/`)

Only `VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_URL` are referenced — both are publishable by design. No service role, Yelp, Gemini, or Google Places keys touch the client.

---

## Proposed changes (single file)

**Edit `supabase/functions/discover-new-restaurants/index.ts` around line 225**, switching the Gemini call from query-string auth to header auth:

```ts
res = await fetch(GEMINI_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-goog-api-key": GEMINI_API_KEY,
  },
  body: JSON.stringify(body),
});
```

That's the only code change. Optional follow-ups (ask before doing):
- Add a tiny `redact()` helper that masks anything matching `/AIza[0-9A-Za-z_-]{20,}/` and Yelp-shaped tokens before any `console.error` in catch blocks. Defense in depth.
- Add a one-line note at the top of each edge function: "Never log full request/response objects; log status + slice(0,200) of body only."

### Out of scope / not changing
- Yelp `Authorization: Bearer` usage (already safe; header, not URL).
- Existing key-name logging (names ≠ secrets).
- Database schema (no secrets stored).

### Verification after change
1. Re-run a small discover batch (e.g. Detroit only).
2. `supabase--edge_function_logs discover-new-restaurants` and grep for `AIza` / `key=` — should be zero hits.
3. Confirm Gemini still returns 200 with the header form.

Approve and I'll make the edit and verify with a single Detroit batch.
