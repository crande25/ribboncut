

## Plan: Atmosphere Summaries at Scan Time

### Overview
Move atmosphere generation into the `scan-restaurants` edge function so summaries are pre-computed when restaurants are first discovered. The feed (`get-restaurants`) simply reads the cached value — zero extra latency at view time.

### Database Change
New `atmosphere_cache` table:
- `yelp_id` (text, primary key)
- `atmosphere_summary` (text, not null)
- `created_at` (timestamptz, default now())
- RLS: public SELECT, no client INSERT/UPDATE/DELETE

### Edge Function: `scan-restaurants/index.ts`
After upserting a batch of restaurant sightings, for each new restaurant (not already in `atmosphere_cache`):
1. Fetch Yelp reviews (`/v3/businesses/{yelp_id}/reviews`) — up to 3 snippets
2. Send review text + restaurant name to Lovable AI (`google/gemini-2.5-flash-lite`) with a prompt like: *"In one sentence, describe the atmosphere/vibe of this restaurant based on these reviews."*
3. Insert result into `atmosphere_cache`

This happens in the background scan — no user is waiting on it.

### Edge Function: `get-restaurants/index.ts`
After fetching Yelp business details, join with `atmosphere_cache`:
- Query `atmosphere_cache` for all `yelp_id`s in the current batch
- Attach `atmosphere_summary` to each restaurant response object
- Fallback: if no cached summary exists yet, derive a simple string from categories/price (e.g. "Upscale · Italian")

### Frontend Changes
**`RestaurantCard.tsx`**: Replace `Wind` icon with `Sparkles` for the Atmosphere section.

**`RestaurantFeed.tsx`**: Map `r.atmosphereSummary` from the API response (already referenced in the card).

### Files Modified
- New migration for `atmosphere_cache` table
- `supabase/functions/scan-restaurants/index.ts` — add review fetch + AI summary + cache write
- `supabase/functions/get-restaurants/index.ts` — read from `atmosphere_cache`, attach to response
- `src/components/RestaurantCard.tsx` — icon swap (`Wind` to `Sparkles`)
- `src/components/RestaurantFeed.tsx` — map `atmosphereSummary` field

