

## Plan: Hot & New harvest mode (minimal schema)

### Principle
Don't add columns we don't need. The existing `restaurant_sightings` table already captures everything required: `yelp_id`, `first_seen_at`, `city`. The "new restaurant" experience is driven entirely by `first_seen_at`.

### Schema change
**None.** Reuse the existing table as-is.

### Edge function change
Add `mode: "hot-and-new"` to `supabase/functions/harvest-restaurants/index.ts`:

1. For each city in `seMichiganCities`:
   - Query `/businesses/search?location={city}&categories=restaurants&attributes=hot_and_new&limit=50&offset=N`
   - Walk pages until empty or 240 cap reached
   - For each business: `INSERT ... ON CONFLICT (yelp_id) DO NOTHING` into `restaurant_sightings` with `city` and `first_seen_at = now()`
2. Return per-city counts: `{ city, scanned, newly_inserted }`

Existing restaurants are ignored on conflict — their original `first_seen_at` is preserved. New restaurants appear in the feed automatically because `get-restaurants` already orders by `first_seen_at desc`.

### What we're NOT doing
- No `is_hot_and_new`, `last_seen_at`, `seen_count`, or `hot_and_new_first_seen_at` columns
- No badge/filter UI changes
- No changes to `get-restaurants` — it already does the right thing

### Files touched
- `supabase/functions/harvest-restaurants/index.ts` — add `hot-and-new` mode

### Tradeoff acknowledged
We won't be able to tell *why* a restaurant was discovered (hot_and_new sweep vs. other harvest modes) or detect when it stops being flagged hot_and_new. That's fine — the user just wants "new restaurants in my area," and `first_seen_at` answers that.

