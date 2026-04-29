# Vibe Generation from Reviews

Replace the current ungrounded vibe text with AI summaries written from real customer reviews (Google Places primary, Yelp fallback). Casual, friendly, neutral tone — describes look & feel only, no praise or critique.

## Architecture

```text
                                      ┌──────────────────────┐
                                      │  restaurant_metrics  │
                                      │   yelp_id (PK)       │
                                      │   google_place_id ★  │  ← new column
                                      │   ... existing cols  │
                                      └──────────┬───────────┘
                                                 │
   ┌─────────────────────┐    no place_id?   ┌───▼────────────┐  reviews   ┌──────────────┐
   │  vibe missing for   │────────────────►  │ Google Places  │ ─────────► │  Lovable AI  │
   │  this yelp_id?      │                   │   resolver     │            │  summarize   │
   └─────────────────────┘                   └────────────────┘            └──────┬───────┘
                                                                                  │
                                                                                  ▼
                                                                       atmosphere_cache
```

★ = new nullable column. Stores the resolved Google `place_id`, or sentinel `'NOT_FOUND'` so we don't keep retrying.

## Components

**1. Schema change** — add `google_place_id TEXT NULL` to `restaurant_metrics`. Cached forever once resolved.

**2. New edge function: `generate-vibe`** (single-restaurant worker)
   - Input: `{ yelp_id }`
   - Reads cached metrics (name, address, coords, place_id)
   - If no `google_place_id` → resolve via Google Places `searchText` and verify with fuzzy name + city + (if coords present) ≤150m distance check. Cache result or `'NOT_FOUND'`.
   - Fetch reviews — Google Places `place/details` (up to 5 reviews); fall back to Yelp `/v3/businesses/{id}/reviews` (3 short snippets) if Google failed.
   - Call Lovable AI (`google/gemini-3-flash-preview`) using tool-calling for structured output: `{ vibe: string }`.
   - Upsert into `atmosphere_cache` (overwriting any prior value).
   - Returns `{ ok, vibe?, source: "google" | "yelp" | "none" }`.

**3. Backfill (run once)** — admin-only edge function `backfill-vibes`. Iterates all `restaurant_sightings.yelp_id`, sequentially throttled, calls `generate-vibe` for each. Overwrites all 47 existing summaries with review-grounded ones. I'll trigger this once and report results.

**4. Daily auto-fill (inline, after discovery)** — at the very end of `discover-new-restaurants`, run a "fill missing vibes" pass: query sightings whose `yelp_id` is missing from `atmosphere_cache`, call `generate-vibe` for each. Throttled; fault-tolerant (one failure doesn't stop the batch).

**5. Inline blocking fallback in `get-restaurants`** — after batch-loading sightings + atmosphere cache, if any visible restaurant on the page lacks a vibe, call `generate-vibe` for those before returning. Bounded:
   - Max 8 concurrent
   - Per-call timeout ~6s
   - Overall budget ~10s; anything still missing falls back to the cuisine string for that card so the Feed never hangs

## Style prompt (sent to Lovable AI)

> Write a 1–2 sentence vibe description (max ~160 characters) for this restaurant based on the customer reviews below. Casual, friendly tone. Describe the look and feel — decor, crowd, energy, lighting, layout, noise level. Do NOT praise or criticize the food, service, or value. Stay neutral and observational. Output via the `set_vibe` tool.

Tool-calling schema enforces a single `vibe` string field.

## Failure handling

- **Google Place not found** → mark `'NOT_FOUND'`, fall through to Yelp reviews
- **Both review sources empty** → skip this run, leave atmosphere_cache empty (will retry tomorrow)
- **Lovable AI 429 / 402** → log + skip (don't fail the batch)
- **Yelp keys exhausted** → still attempt Google only

## Files affected

- `supabase/migrations/...` — add `google_place_id` column (migration tool)
- `supabase/functions/generate-vibe/index.ts` — new
- `supabase/functions/backfill-vibes/index.ts` — new (one-shot, admin-only)
- `supabase/functions/discover-new-restaurants/index.ts` — append vibe-fill phase at end
- `supabase/functions/get-restaurants/index.ts` — inline blocking fallback for missing vibes

## Out of scope (not changing)

- The `atmosphere_cache` table schema itself (still `yelp_id` + `atmosphere_summary` + `created_at`)
- The Feed UI / `RestaurantCard` rendering
- Yelp key pool / discovery filtering / hotel exclusion
- Vibe regeneration / refresh — once written, a vibe stays cached indefinitely (we can add a refresh policy later if reviews drift)

## Sequence of execution

1. Migration: add column
2. Build & deploy `generate-vibe`
3. Build & deploy `backfill-vibes`, run it once, report results (47 restaurants)
4. Wire vibe-fill phase into `discover-new-restaurants`, deploy
5. Wire blocking fallback into `get-restaurants`, deploy
