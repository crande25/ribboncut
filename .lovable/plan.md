

# Revised Plan: Lightweight "First Seen" Tracking + Live Yelp Data

## Core Idea
Store **only** the minimum needed to track when a restaurant was first discovered: `yelp_id` and `first_seen_at`. All other data (name, photos, ratings, address, etc.) is fetched **live** from Yelp at request time so it never goes stale.

## Database

**`restaurant_sightings`** — minimal tracking table:
- `yelp_id` (text, primary key) — Yelp business ID
- `first_seen_at` (timestamptz, default now()) — when we first discovered it
- `city` (text) — which SE Michigan area it belongs to

RLS: public read, service-role write only (edge functions write via service role key).

**`scan_log`** — optional, tracks scan history:
- `id`, `city`, `scanned_at`, `new_count`

## Edge Functions

### `scan-restaurants` (scheduled daily via pg_cron)
- For each SE Michigan city, call Yelp search API
- For each result, INSERT into `restaurant_sightings` ON CONFLICT DO NOTHING (preserves original `first_seen_at`)
- Only stores `yelp_id`, `first_seen_at`, `city` — nothing else

### `get-restaurants` (replaces `discover-restaurants`)
1. Query `restaurant_sightings` filtered by `first_seen_at >= opened_since` and selected cities → get list of `yelp_id`s
2. Fetch live details from Yelp for those IDs (batch `/businesses/{id}` calls)
3. Return merged data: `first_seen_at` from our DB + everything else live from Yelp
4. Paginated — fetch Yelp details only for the current page of results

This keeps all restaurant metadata fresh (ratings, photos, hours change over time) while giving us reliable "opened date" tracking.

## Frontend Changes

**Settings:**
- Replace free-form location search with multi-select of SE Michigan areas
- Remove geolocation button
- Keep dietary filters and "Opened Within" as-is

**Feed:**
- Update `api.ts` to call `get-restaurants`
- Cards show "First spotted X days ago"
- Rest of feed behavior unchanged (infinite scroll, pull-to-refresh)

## Trade-offs
- Yelp detail calls at request time add latency (~1-2s for a page of 20), but data is always current
- Could add a short TTL cache layer later if needed
- Initial scan seeds everything as "new" — accuracy improves over time

