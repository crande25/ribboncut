

## Plan: Diff-Based New Restaurant Detection

### Problem
Currently, any restaurant discovered for the first time gets `first_seen_at = now()`, making old restaurants appear "new." Yelp results are non-deterministic, so old restaurants surface unpredictably.

### Solution
Change the logic so that `first_seen_at` defaults to 10 years ago for all inserts. Then, after each scan, diff today's result set against what was in the DB *before* the scan. Any `yelp_id` that was truly absent from `restaurant_sightings` before this scan is a genuinely new discovery — update its `first_seen_at` to now().

This way, only restaurants that literally did not exist in our database before today's scan get marked as recent. Restaurants we simply hadn't encountered in previous scans get silently added with an old date.

### Implementation

**1. Add a `discovered_new` column (migration)**
- Add `is_new_discovery boolean default false` to `restaurant_sightings`
- This flags restaurants that appeared for the first time in the diff, distinguishing them from baseline backfill

**2. Update `scan-restaurants/index.ts`**

Before the Yelp scan loop:
- Query all existing `yelp_id`s from `restaurant_sightings` for the cities being scanned → `existingIds` Set

In the upsert logic:
- Change the insert default: set `first_seen_at` to `now() - interval '10 years'` for all new rows (instead of `now()`)
- Use `ignoreDuplicates: true` so existing rows aren't touched

After the scan loop (the diff):
- Compute `newlyDiscovered = scannedIds - existingIds`
- For each newly discovered ID, update `first_seen_at = now()` and `is_new_discovery = true`
- Log how many genuinely new restaurants were found

Atmosphere generation continues as before — only uncached restaurants get summaries.

**3. Update `get-restaurants/index.ts`**
- No changes needed — it already reads `first_seen_at` and the `opened_since` filter works naturally

### Why this works
- Day 1 scan: all restaurants go in with old dates (baseline)
- Day 2 scan: same restaurants are skipped (ignoreDuplicates). Any new `yelp_id` not in yesterday's set gets `first_seen_at = today`
- Yelp result shuffling doesn't matter — once a restaurant is in the DB, it stays with its original date

### Files Modified
- `supabase/functions/scan-restaurants/index.ts` — diff logic, default old dates
- New migration — add `is_new_discovery` column

