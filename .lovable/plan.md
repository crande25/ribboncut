## Goal

Stop redundant metadata refreshes. Make ownership of each metadata field clear:

- **discover-new-restaurants**: only writes metadata for **NEW** sightings (first time we see them). Never overwrites existing rows.
- **nightly-backfill-categories**: refreshes Price / Rating / Review Count / Categories (Offers) and re-generates Vibe for any sighting whose metadata is older than **3 days**. Image is preserved (not overwritten).
- **get-restaurants** (Feed): no time-based lazy refresh. Only fills a field when the cached value is genuinely missing (null/empty).

## Changes

### 1. `supabase/functions/discover-new-restaurants/index.ts`

- Change the categories upsert (lines ~660-670) and metrics upsert (lines ~678-695) so they only write when the row does **not** already exist for that `yelp_id`. Approach: change the `restaurant_sightings` upsert to capture whether it actually inserted (it already uses `ignoreDuplicates: true` and selects); only run the categories + metrics upserts inside the `if (inserted && inserted.length > 0)` branch.
- The trailing "vibe-fill" phase (lines ~727-766) currently iterates **all** sightings missing a vibe. Narrow it to vibes for sightings inserted in **this run** only (track inserted yelp_ids in a Set during the loop, then only generate-vibe for those). This keeps new-discovery vibes flowing without re-touching existing ones.

### 2. `supabase/functions/backfill-categories/index.ts`

- Replace the "scan last N days of sightings" logic with: **select sightings whose `restaurant_metrics.updated_at` is older than 3 days OR is missing**, regardless of `first_seen_at`. Keep the staleness-first ordering for partial runs.
- For each target, fetch Yelp business detail and upsert `restaurant_categories` (aliases/titles) and `restaurant_metrics` (price_level, rating, review_count) — but **do NOT overwrite `image_url`** (leave the column out of the upsert payload entirely so the existing value is preserved). Other display fields (name, address, phone, url, coordinates) — leave those out too unless they were null, since the user only asked us to refresh price/rating/offers/vibe. Simplest rule: the periodic upsert touches only `price_level`, `rating`, `review_count`, `updated_at`.
- After upserting metrics+categories, call `generate-vibe` for the same yelp_id to refresh the vibe text (fire sequentially with the existing throttle pattern from `backfill-vibes`).
- Rename the function description / log prefixes from "backfill" to "refresh" since it's no longer a one-off.
- The `days` and `since`-based parameters become irrelevant; replace with a `staleness_days` param (default 3) and keep `limit` and `dry_run`.

### 3. `supabase/functions/get-restaurants/index.ts`

- Remove the 72-hour `CACHE_TTL_MS` freshness gate (lines ~182-191, ~330-333). Replace the `isCacheFresh()` check with `isCacheUsable()` — true when the cached metrics row exists AND has a non-empty `name`, `image_url`, `rating`, `price_level`, etc. (i.e. all the fields the card needs to render).
- When `isCacheUsable()` returns true → serve from cache, **never** hit Yelp.
- When false → fetch Yelp detail and lazy-write the missing fields (existing lazy-write blocks already do this; keep them).
- Keep the existing inline vibe-fill block (lines ~245-294) — vibes that are missing should still be generated on demand. No change to its behavior (it already only fills when `atmosphereMap` lacks the entry).

### 4. Cron schedule

The user mentioned "every three days after they're discovered" — the existing `nightly-backfill-categories` cron (09:00 UTC daily) is fine because the function itself filters by 3-day staleness. No cron change needed unless the user wants a different cadence.

## Technical details

**Files modified**
- `supabase/functions/discover-new-restaurants/index.ts`
- `supabase/functions/backfill-categories/index.ts`
- `supabase/functions/get-restaurants/index.ts`

**No DB schema changes.** All logic uses existing `restaurant_metrics.updated_at`.

**Behavior matrix after change**

| Field | discover (new only) | backfill (every 3d) | Feed (lazy) |
|---|---|---|---|
| name | write | — | write if missing |
| image_url | write | — (preserved) | write if missing |
| address/phone/url/coords | write | — | write if missing |
| price_level | write | refresh | write if missing |
| rating | write | refresh | write if missing |
| review_count | write | refresh | write if missing |
| categories (Offers) | write | refresh | write if missing |
| vibe (atmosphere) | generate | regenerate | generate if missing |

## Open question

The user said "Image" is excluded from the 3-day refresh. Confirming: the image set at discovery is kept forever (until manually re-discovered) — sound right? If you ever want image refresh on a longer cadence (e.g. every 30d), say so and I'll add it.
