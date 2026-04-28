# Plan: Cache price & rating + add Settings filters

Same pattern as the dietary cache: store cheap, filterable signal in the DB so we can pre-filter sightings before paying for live Yelp detail calls.

## 1. Schema

New table **`restaurant_metrics`** (separate from `restaurant_categories` to keep cache concerns isolated and TTLs independent):

- `yelp_id text PK`
- `price_level smallint` — 1–4, mapped from Yelp's `$`/`$$`/`$$$`/`$$$$`. Nullable (Yelp doesn't always return a price).
- `rating numeric(2,1)` — 0.0–5.0 in 0.5 steps.
- `review_count integer`
- `updated_at timestamptz default now()`
- RLS: public `SELECT`; writes server-only (mirrors `restaurant_categories`).
- Indexes: `(price_level)`, `(rating)`. Skip composite — Postgres will bitmap-AND when both filters are active and the result set is small (≤ page size).

Why `smallint` not text: lets us do `price_level <= 2` for "$$ or cheaper" instead of string matching.

## 2. Settings UI

Two new sections under "Dietary Requirements":

**Price Range** — pill multi-select: `$`, `$$`, `$$$`, `$$$$`. Stored as `useLocalStorage<number[]>("price_filters", [])`. Empty array = no filter.

**Minimum Rating** — single-select pills: `Any`, `3.5★+`, `4.0★+`, `4.5★+`. Stored as `useLocalStorage<number>("min_rating", 0)`. `0` = no filter.

Both follow the existing `dietaryOptions` styling so they feel native.

## 3. Wire into get-restaurants

- `src/lib/api.ts` `getRestaurants()` gains `priceFilters?: number[]` and `minRating?: number` params, passed as query string `prices=1,2` and `min_rating=4.0`.
- `RestaurantFeed.tsx` reads both from localStorage and forwards them; add to the dependency arrays alongside `dietaryFilters`.
- Edge function `get-restaurants`:
  - Batch-fetch `restaurant_metrics` for the page's `yelp_id`s alongside the existing categories/atmosphere fetches.
  - **Strict pre-filter** (matches the dietary behavior the user picked): if either filter is active, drop sightings with no metrics row OR whose metrics fail the predicate, *before* the Yelp detail loop.
  - Lazy-write metrics from the live Yelp response when we ended up calling Yelp anyway and the row was missing (mirrors what we already do for categories).

## 4. Harvest update (`discover-new-restaurants`)

Yelp's `/businesses/search` response already returns `price`, `rating`, and `review_count` per business — no extra API calls needed.

- Extend `VerifiedHit` with `priceLevel`, `rating`, `reviewCount` captured at the same point we capture `categoryAliases`.
- Right after the existing `restaurant_categories` upsert, upsert `restaurant_metrics`. Log `[metrics CITY] cached yelp_id=… price=2 rating=4.3 reviews=128`.
- Price string → number helper: count `$` chars; `null` if absent.

## 5. On-demand backfill

Extend the existing `backfill-categories` edge function rather than create a parallel one — it already loops recent sightings and calls Yelp details. Rename internally to also populate metrics, but **keep the route name** to avoid breakage. New behavior:

- For each missing-categories row, write **both** `restaurant_categories` and `restaurant_metrics` from the same `/businesses/{id}` response.
- "Missing" check becomes: row missing in *either* cache table. (Two `IN` queries, union the gaps.)
- Response JSON gains `metrics_updated` counter alongside the existing `updated`.

Trigger on demand by asking Lovable to "backfill caches for the last 30 days" — same flow as before.

## 6. Logging additions

- Harvest: `[metrics CITY] cached yelp_id=X price=N rating=R reviews=K`
- get-restaurants pre-filter: `[filter] price/rating dropped N sightings (no-cache=A, predicate-fail=B)`
- Backfill: `[backfill] cached metrics yelp_id=X price=… rating=…`

## Out of scope (ask if you want them)

- Rating *range* (max rating) — not a typical user need.
- Showing how many results each filter combo would yield in real time.
- TTL / refresh job for stale metrics rows (rating drifts over time). Right now metrics get refreshed whenever we re-verify a sighting via harvest or call get-restaurants on a row that *was* cached but stale — we don't refresh stale-but-present rows. Can add a `--force` mode to backfill later.

## Technical Details

**Files touched**

- migration: create `restaurant_metrics` + RLS + indexes
- `src/pages/Settings.tsx`: two new sections (~40 lines)
- `src/components/RestaurantFeed.tsx`: read 2 new localStorage keys, pass to API, add to deps
- `src/lib/api.ts`: extend `getRestaurants` signature + query params
- `supabase/functions/get-restaurants/index.ts`: parse `prices` / `min_rating`, batch-fetch metrics, strict pre-filter, lazy upsert
- `supabase/functions/discover-new-restaurants/index.ts`: extend `VerifiedHit`, capture from search hit, upsert after categories
- `supabase/functions/backfill-categories/index.ts`: also populate metrics; expand "missing" check; add counter

**Price mapping**

```text
"$"     -> 1
"$$"    -> 2
"$$$"   -> 3
"$$$$"  -> 4
absent  -> null  (excluded by any active price filter)
```

**Pre-filter SQL-equivalent (done in code against the in-memory map)**

```text
keep sighting iff:
  (no price filter  OR  metrics.price_level IN <selected>)
  AND
  (min_rating == 0  OR  metrics.rating >= min_rating)
  AND
  metrics row exists when either filter is active   ← strict
```
