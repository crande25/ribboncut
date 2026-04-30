# Pre-Demo Refactor Plan (Zero Behavior Change)

Goal: clean up the rough edges a developer will notice on a code-walkthrough, without altering any user-visible behavior, API contracts, DB schema, or business logic. Each item below is mechanical (extract / dedupe / rename / type) — no logic changes.

I'll verify "no behavior change" by reading the diffed call sites and relying on the existing test setup. No DB migrations, no edge function contract changes.

---

## 1. `src/components/RestaurantFeed.tsx` (300 lines → ~190)

**Problem:** Three near-identical fetch flows (`fetchInitial`, `loadMore`, `handleRefresh`) duplicate the same "call fetchPage → branch on results/more → set state" block. The mock-data fallback is duplicated twice. Mapping logic is inline.

**Refactor:**
- Extract `mapToRestaurant` to `src/lib/restaurantMapper.ts` (pure function, easy unit-testable).
- Extract a `useRestaurantFeed` hook that owns `restaurants / loading / loadingMore / refreshing / hasMore / currentOffset / usingMockData` plus `loadInitial`, `loadMore`, `refresh`. Component becomes pure presentation.
- Collapse `fetchInitial` and `handleRefresh` into one `loadFromStart(opts: { showSkeleton: boolean })`. Their bodies are identical except for which loading flag they toggle and the toast on the refresh fallback.
- Extract the mock-data fallback into one helper `buildMockFallback(selectedCities)`.

**Verified non-functional:** existing infinite-scroll cursor fix (the `nextOffset = offset + PAGE_SIZE` logic) is preserved verbatim — that's the behavior we just shipped.

## 2. `supabase/functions/get-restaurants/index.ts` (468 lines → ~280 across 4 files)

Currently one giant `Deno.serve` handler doing: env validation, query parsing, PostgREST URL building, batch cache fetches, pre-filtering, inline vibe backfill, per-sighting Yelp fetch + lazy cache writes, response shaping.

**Refactor (split into siblings the function already imports from `./`):**
- `params.ts` — `parseQueryParams(url)` returns a typed `{ offset, limit, openedSince, cities, dietaryCategories, selectedPrices, minRating }`. Move the ISO-8601 validation regex here. Returns `{ ok, value } | { ok: false, error }`.
- `sightingsQuery.ts` — `buildSightingsUrl(params)` returns the PostgREST URL string. Move the city-encoding logic here. Pure function — trivial to add a unit test.
- `cache.ts` — `loadCacheBatches(supabase, yelpIds)` returns `{ atmosphereMap, categoryMap, metricsMap }`. Also exposes `isCacheUsable(yelpId, maps)` and `buildFromCache(sighting, maps)`.
- `prefilter.ts` — `applyPrefilters(sightings, { dietaryCategories, selectedPrices, minRating, hasPriceFilter, hasRatingFilter, categoryMap, metricsMap })`. Includes the lodging-only drop and the dietary/price/rating drops, with the same `console.log` counters.
- `vibeBackfill.ts` — the inline concurrency-limited `generate-vibe` caller, with the same 8/6s/10s budgets.
- `yelpEnrich.ts` — per-sighting Yelp fetch + lazy `restaurant_categories` and `restaurant_metrics` upserts + tombstoning of `BUSINESS_UNAVAILABLE`. Returns the shaped restaurant object.

`index.ts` becomes a thin orchestrator: parse → query DB → load caches → prefilter → backfill vibes → enrich → respond. All `console.log` strings, error handling, status codes, and response shapes preserved exactly.

## 3. CORS + Supabase client bootstrap duplication across edge functions

Every function re-declares the same `corsHeaders` object and the same `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env-check boilerplate.

**Refactor:** add `supabase/functions/_shared/http.ts` exporting:
- `corsHeaders`
- `jsonResponse(body, status)`
- `handleOptions(req)`
- `getServiceClient()` (throws a typed error on missing env, caller returns a 500)

Apply to `get-restaurants`, `discover-new-restaurants`, `generate-vibe`, `backfill-vibes`, `backfill-categories`, push-notification functions, etc. There's already a `_shared/` folder used by the email templates — same pattern.

## 4. `discover-new-restaurants/index.ts` — remove the inlined `YelpKeyPool`

Lines 14–~150 of this file are an exact-copy reimplementation of `get-restaurants/yelpKeys.ts`, with a comment explaining edge functions can't share folders. They can — via `_shared/`.

**Refactor:** move `YelpKeyPool` to `supabase/functions/_shared/yelpKeyPool.ts` and import from both `get-restaurants` and `discover-new-restaurants`. ~140 lines deleted, no behavior change.

## 5. `src/pages/Settings.tsx` (328 lines)

The page has six independent setting groups (theme, cities, opened-within, dietary, price, rating, install card, push card, contact). Each is rendered inline.

**Refactor (extract pure presentational components, no state moves):**
- `ThemeSelector.tsx` (uses `useTheme` directly — already a hook)
- `OpenedWithinControl.tsx` (owns the `rawInput` local state + validation)
- `MultiToggleGroup.tsx` — generic chip-toggle list, then use it for dietary / price / rating

State remains in `Settings.tsx` via the same `useLocalStorage` keys, passed down as props. Page becomes a layout shell.

## 6. `src/lib/api.ts` — small typing tightening

`getRestaurants` returns `RestaurantResult[]` whose fields are typed loosely (`rating: number` even though backend can return null; `coordinates?` is `{latitude, longitude}` but `cache.ts` assigns the raw `coordinates: any`). 

**Refactor:** make nullable fields explicit (`rating: number | null`, `priceRange: string | null`), and add a single shared `Restaurant` type re-exported from one place rather than the duplicated shape between `mockData.ts` and `api.ts`. Update consumers — TS will guide. The runtime `mapToRestaurant` already handles nulls via `||` fallbacks, so behavior is unchanged.

## 7. Misc small wins

- Delete unused imports flagged by ESLint (currently `no-unused-vars` is off — re-enabling it as `warn` would surface a clean baseline).
- `RestaurantFeed.tsx`: extract `PAGE_SIZE` constant into `lib/api.ts` next to `getRestaurants` since the comment about cursor advancement is really about the API contract.
- Consistent log prefix convention: `[get-restaurants]`, `[discover]`, `[vibe-fill]` — many functions already do this, a few don't.
- Replace the empty `README.md` (`TODO: Document your project here`) with a 1-paragraph project description, run instructions, and an architecture link to the memory note about hybrid DB+Yelp.

---

## Out of scope (intentionally NOT touching)

- DB schema, migrations, RLS policies.
- Edge function HTTP contracts (request/response shapes, status codes).
- The cursor-pagination fix.
- Yelp key rotation logic.
- Authentication, push notifications, email — these are stable and untouched.

## Validation strategy

- For each extracted module: read every call site of the moved code and confirm signatures match.
- Run `vitest` (existing setup) after each phase.
- For edge functions: run `supabase--test_edge_functions` if tests exist; otherwise smoke via `curl_edge_functions` against the same query the user just used (Ann Arbor / Detroit / Ypsi, $-$$, 4★+) and diff the JSON response shape.

## Rough order / size

| # | Area | Risk | Lines moved |
|---|------|------|-------------|
| 4 | Inlined YelpKeyPool dedup | very low | ~140 deleted |
| 3 | Shared CORS / client helpers | very low | ~60 deduped |
| 1 | RestaurantFeed hook extraction | low | ~110 reorganized |
| 2 | get-restaurants split | medium | ~470 reorganized |
| 5 | Settings component extraction | low | ~150 reorganized |
| 6 | api.ts type tightening | low | small |
| 7 | Misc | very low | small |

Items can ship independently; recommend doing them in the order above (cheapest-and-safest first).