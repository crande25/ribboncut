## Goal
Daily at 3am EST, run a per-city AI web search for restaurants opened in the last 7 days, verify each candidate via Yelp, and insert verified hits into `restaurant_sightings`. Console logs only — no UI.

## Architecture

```text
pg_cron (0 8 * * * UTC ≈ 3am EST)
  └─> POST /functions/v1/discover-new-restaurants
       │
       ├─ Compute date window: today, today - 7 days ("Month D, YYYY")
       │
       ├─ For EACH city in SE_MICHIGAN_CITIES (one call per city, 600ms throttle):
       │    └─> Perplexity Sonar API
       │         model: "sonar"
       │         search_recency_filter: "week"
       │         response_format: json_schema → { restaurants: [{ name, address }] }
       │         prompt: "Search for and list all restaurants that officially
       │                  opened for business in {City} between {7daysAgo}
       │                  and {today}. For each result, provide only the
       │                  restaurant name and address. Do not include opening
       │                  dates, source links, cuisine type, or any additional
       │                  commentary or descriptions. Focus only on permanent
       │                  locations that are currently fully operational."
       │
       ├─ For each candidate { name, address }:
       │    └─> Yelp /businesses/search?term={name}&location={address}, limit=3
       │         match: candidate name fuzzy-matches Yelp result name
       │                AND Yelp result city == target city
       │         on match → INSERT INTO restaurant_sightings
       │           (yelp_id, city, first_seen_at = now(), is_new_discovery = true)
       │           ON CONFLICT (yelp_id) DO NOTHING
       │
       └─ console.log({ summary: [...per-city counters], totals })
```

## Step 1 — Connect Perplexity
Use `standard_connectors--connect` with `connector_id: perplexity`. After connection, `PERPLEXITY_API_KEY` is auto-injected into edge function env.

## Step 2 — Edge function
File: `supabase/functions/discover-new-restaurants/index.ts`

- Single file (no subfolders)
- Public function (`verify_jwt = false`); pg_cron passes service-role key in header
- Inline copy of the SE Michigan cities list (edge functions can't import from `src/`)
- Inline Yelp key rotation (3 keys: `YELP_API_KEY`, `YELP_API_KEY_2`, `YELP_API_KEY_3`)
- Per-city flow: build prompt → Perplexity call → for each candidate, Yelp verify → insert
- Final `console.log` summary visible in edge function logs

## Step 3 — Schedule cron
Enable `pg_cron` and `pg_net` extensions, then insert (via insert tool, not migration — contains project-specific URL/key):

```sql
SELECT cron.schedule(
  'discover-new-restaurants-daily',
  '0 8 * * *',
  $$ SELECT net.http_post(
       url := 'https://dcvgzkhoxlvtynlnxsdw.supabase.co/functions/v1/discover-new-restaurants',
       headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
```

## Step 4 — Frontend
**No changes.** New rows surface in the feed via existing `first_seen_at desc` ordering in `get-restaurants`.

## What we're NOT building
- No admin UI, no manual trigger button
- No source URL or opening date storage (per prompt spec — name + address only)
- No new tables; reuse `restaurant_sightings` with `is_new_discovery = true`
- No schema changes
- No retries within a single run (next day's run is the retry)

## Files touched
- **Created**: `supabase/functions/discover-new-restaurants/index.ts`
- **Connector**: Perplexity linked
- **DB**: `pg_cron` + `pg_net` enabled; one cron job inserted

## Tradeoffs
1. **No source URL stored** — per the prompt, Perplexity returns name+address only. No audit trail. Can add later if desired.
2. **`first_seen_at = now()`** — prompt excludes opening dates, so we use insertion time. Feed ordering still correct.
3. **Strict Yelp verification** drops anything Yelp doesn't index yet; future runs will catch them when Yelp updates.
4. **Conservative match heuristic** (substring + city) — generic names could in theory match wrong Yelp business. Acceptable.
5. **Cost**: ~29 Perplexity calls/day ≈ $0.03/day. Negligible.
