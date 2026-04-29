## Goal
Get vibes generated for the 6 failing restaurants and prevent the same failure mode going forward.

## Root cause analysis

**Cause A — 5 sightings have no `restaurant_metrics` row at all** (`kIcqQ4vhVYWQViiW4HfHnQ`, `nC-t0W3ks-ejzva4NW4OKw`, `nGtr3_lNGyoXxc8C0xkR2w`, `qqRyfavBWHwbBdjeI_XoXg`, `uq3Y2YSqUmeIEJJBUOlIZA`)
These were inserted as sightings but never had Yelp metadata cached. `generate-vibe` needs `name` + `address` + `coordinates` to do a Google Places text search and bails with `"no metrics"`.

**Cause B — 1 sighting has a metrics row with NULL name/address** (`Kcc9VS2jNPzrRyHqCkE2Iw`)
`generate-vibe` itself caches `google_place_id` on `restaurant_metrics` via an **`UPDATE ... WHERE yelp_id = ?`** at `generate-vibe/index.ts:373`. If no row exists yet, the UPDATE silently affects 0 rows. But Postgres treats it differently when combined with how Supabase `.update()` handles missing rows — and more importantly, an earlier code path (likely a prior version, or a partial insert from `discover-new-restaurants` failing mid-batch) created a bare row containing only `yelp_id`. Either way, the row exists with NULL name/address, so the next `generate-vibe` call can't proceed.

**Stale vibes** — 2 of the 6 (`nC-t0W3ks…`, `uq3Y2YSqUmeIEJJBUOlIZA`) still show pre-backfill non-grounded summaries because the backfill failed mid-write for them.

## What to build (4 changes)

### 1. Harden `generate-vibe` — fetch Yelp metadata on demand when missing
Before bailing with `"no metrics"`, attempt a Yelp `/businesses/{yelp_id}` fetch. If it returns name+address+coordinates, upsert them into `restaurant_metrics` and continue. This makes the pipeline self-healing for future sightings that bypass the normal cache path.

If Yelp also returns 404/no data, *then* return `"no metrics"`. New telemetry: log `source: yelp_lookup` when this path triggers.

### 2. Fix the partial-row bug in `generate-vibe`'s place_id cache write
Change the `google_place_id` update at line 373 from `UPDATE` to a real `UPSERT` keyed on `yelp_id`, but **only set google_place_id + updated_at** in the upsert (don't blank out other columns). Use `.upsert(..., { onConflict: "yelp_id", ignoreDuplicates: false })` with explicit column list — or better, switch to a `.update()` after we've already ensured a full row exists via #1.

This guarantees we never create a bare-bones row from `generate-vibe`.

### 3. One-time data fix for the 6 affected restaurants
After deploying #1 and #2:
- Delete the stale `atmosphere_cache` rows for `nC-t0W3ks-ejzva4NW4OKw` and `uq3Y2YSqUmeIEJJBUOlIZA` so they don't show old summaries.
- Delete the bare metrics row for `Kcc9VS2jNPzrRyHqCkE2Iw` (so the new self-healing path can repopulate it cleanly).
- Re-run `backfill-vibes` (one-shot token again, then revoke) targeting only those 6.

### 4. Make `backfill-vibes` accept an explicit list of yelp_ids
Add optional body field `{ yelp_ids: string[] }` so we don't have to regenerate all 47 again. If provided, process only those; otherwise current behavior.

## Files changed
- `supabase/functions/generate-vibe/index.ts` — add Yelp metadata fallback, fix place_id cache write
- `supabase/functions/backfill-vibes/index.ts` — accept `yelp_ids` array
- Data ops via `supabase--insert` tool: delete 2 stale atmosphere rows + 1 bare metrics row
- One-shot run: re-add `BACKFILL_TOKEN`, run targeted backfill, delete token

## Out of scope
- Investigating *why* `Kcc9VS2jNPzrRyHqCkE2Iw` ended up with a bare metrics row historically (could be a deleted-then-resighted business, or a prior buggy code path that's already been removed). #2 prevents recurrence regardless.
- Changing the `discover-new-restaurants` upsert at line 678 — it already writes a full row.

## Verification
After deploy + targeted backfill, confirm via SQL:
- `atmosphere_cache` count = sightings count = 47
- All 6 target yelp_ids have a fresh `atmosphere_cache` row with `created_at` after deploy
- All 6 have a non-null `name` in `restaurant_metrics`
