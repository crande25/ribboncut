## Goal

Cut Gemini grounded-search usage from 29 calls/day (one per city) down to **10 calls/day** (one per batch of ~3 cities) so the daily harvest fits inside the free tier's 20 grounded-requests/day cap, with margin for retries and ad-hoc debug runs.

## Why batching works

A single grounded prompt can ask Gemini to search the web for new openings across multiple cities and return results tagged by city. Google Search grounding fires per-prompt, not per-city — so 3 cities in one prompt = 1 grounded call instead of 3. The Yelp verification step is unchanged (still per-candidate) and Yelp has its own quota pool.

Math:
- 29 cities ÷ 3 cities/batch = 10 batches/day
- 10 grounded calls/day fits comfortably under the 20/day free cap
- Leaves ~10 calls/day headroom for manual debug runs

## Step 1 — Refactor `callGeminiGrounded` to accept multiple cities

File: `supabase/functions/discover-new-restaurants/index.ts`

Change the signature from `(city, today, sevenDaysAgo, debug)` to `(cities: string[], today, sevenDaysAgo, debug)` and have it return `Candidate[]` where each candidate carries its source city:

```ts
interface Candidate {
  name: string;
  address: string;
  city: string;  // NEW — which input city this belongs to
}
```

New prompt shape (asks the model to attribute results to the input cities):

```
Search the web for restaurants that officially opened for business between
${sevenDaysAgo} and ${today} in any of these cities:
  - Detroit, MI
  - Ann Arbor, MI
  - Novi, MI

Only include permanent locations currently fully operational. Exclude pop-ups,
food trucks without a permanent address, planned/announced openings, and
locations that have already closed.

Return ONLY a JSON array, no prose, no markdown fencing. Each item:
{"name": "...", "address": "Street, City, State", "city": "<one of the input cities, exact string>"}

If you find none, return exactly: []
```

Parser changes:
- Validate `city` is one of the input cities (drop rows that aren't).
- Existing fence-strip + array-extraction logic stays.

## Step 2 — Refactor the main loop into batches

Replace the per-city loop with a per-batch loop:

```ts
const BATCH_SIZE = 3;
for (let i = 0; i < citiesToScan.length; i += BATCH_SIZE) {
  const batch = citiesToScan.slice(i, i + BATCH_SIZE);
  const { candidates } = await callGeminiGrounded(batch, todayStr, sevenDaysAgoStr);
  // Group candidates by candidate.city, then run existing Yelp verify + upsert
  // per candidate. Per-city scan_log row written for each city in the batch
  // (new_count = inserts attributed to that city, even if 0).
  await new Promise(r => setTimeout(r, 7000)); // throttle between batches
}
```

The chunking (`chunk` / `chunk_size`) params stay — they still slice the master city list — but we no longer need them for cron because 10 batches × ~10s each ≈ 100s, well under the 150s edge limit. Keep the params for ad-hoc / manual full-harvest calls.

Default `chunk_size` raised to `30` (effectively "all cities") so an unparameterized cron call processes everything in one invocation.

## Step 3 — Collapse cron from 30 jobs to 1

Currently 29 per-city jobs + 1 catch-all daily job. Replace with **a single daily job** at 06:00 UTC that calls the function with no body and lets it process all 29 cities in 10 batches inside one invocation.

Migration plan (these run via the SQL insert tool since they reference the project URL + anon key):

```sql
-- Remove all the per-city scan jobs and the legacy daily job
SELECT cron.unschedule(jobid) FROM cron.job
WHERE jobname LIKE 'scan-%' OR jobname = 'discover-new-restaurants-daily';

-- Single daily harvest at 06:00 UTC (~2am EST)
SELECT cron.schedule(
  'discover-new-restaurants-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://dcvgzkhoxlvtynlnxsdw.supabase.co/functions/v1/discover-new-restaurants',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Note: the existing jobs use the **anon key** but the function requires service-role auth (added in the prior pass). That mismatch means the current cron has been failing 403 — confirmed by the empty edge-function logs. The new job uses the service role key so it actually runs.

## Step 4 — Debug mode update

Debug mode currently picks the first city and returns raw + grounding for one city. Update it to send the **first batch** (up to 3 cities) so debug runs accurately reflect production behavior:

```
POST /discover-new-restaurants
body: {"cities":["Detroit, MI","Ann Arbor, MI","Novi, MI"], "days":30, "debug":true}
```

Response includes `cities` (array), per-city candidate counts, and the single `raw_ai_response` + `grounding` block.

## Step 5 — Verification after deploy

1. **Debug call** with 3 cities, 30-day window. Expect:
   - `candidates[]` has items with `city` field set to one of the 3 inputs.
   - `grounding.webSearchQueries` shows queries spanning the input cities.
   - `grounding.sources` URIs point to real news pages.

2. **Full run** with `{}`. Expect ~10 grounded calls in logs, total runtime ~80–120s, non-zero inserts.

3. **Quota check the next day**: confirm we used ≤ 10 grounded calls in the 24h window.

## Files touched

- **Edited**: `supabase/functions/discover-new-restaurants/index.ts`
  - `callGeminiGrounded` signature + prompt + parser (cities array, per-row city tag)
  - Main loop: per-batch instead of per-city
  - Debug branch: emits a batch
  - Default `chunk_size` raised so unparameterized calls cover all cities
- **Cron**: 29 `scan-*` jobs + legacy `discover-new-restaurants-daily` removed; one new daily job inserted with service-role auth
- **No** changes to: DB schema, RLS, Yelp pool, frontend, secrets

## Tradeoffs

1. **Per-batch attribution risk**: model could mis-tag a candidate's city. Mitigation: parser drops rows whose `city` isn't in the input set; Yelp verify still requires `cityMatch(targetCity, yelpCity)` so a wrong tag results in a skip, not a bad insert.
2. **Single point of failure**: if the daily run errors mid-way, fewer cities get scanned vs. the previous 29 independent jobs. Acceptable because the previous setup was failing entirely (403s) and the recovery path is "wait until tomorrow" either way. Manual chunked re-runs remain available via the `chunk` param.
3. **Slightly noisier prompt**: asking for 3 cities at once may dilute model attention. Mitigation: batch size kept small (3) and explicit instructions tell the model to attribute each item to one of the input cities.
4. **Free-tier ceiling still tight**: 10/day production + manual debug runs eat into the 20/day cap. If you need more debug headroom we can drop batch size to 2 (→ 15 calls/day) or raise to 4 (→ 8 calls/day) later.

## What we're NOT doing

- Not changing the model (stays on `gemini-2.5-flash-lite`)
- Not removing the chunk/chunk_size params — they're still useful for manual partial runs
- Not adding billing
- Not changing the throttle delay (7s between batches stays — well within rate limits)
