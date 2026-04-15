

## Plan: Google Places Reviews for Vibe Summaries

### Overview
Update `scan-restaurants` to look up each uncached restaurant on Google Places via Text Search, fetch its reviews, and feed real review text to Lovable AI for a vibe summary. This replaces the current metadata-only inference with actual customer impressions.

### How the mapping works
For each restaurant without a cached atmosphere summary:
1. **Google Places Text Search** — query `"{name}", {city}` to get a `place_id`
2. **Google Places Details** — fetch `reviews` field using the `place_id` (up to 5 reviews returned)
3. **AI summary** — send review snippets to `gemini-2.5-flash-lite` with the existing vibe prompt, now grounded in real customer language
4. **Cache** — upsert result into `atmosphere_cache`

If Google Places returns no match or no reviews, fall back to the current metadata-based inference (name + categories + price).

### Changes to `scan-restaurants/index.ts`

1. **Add `GOOGLE_PLACES_API_KEY`** env var read (already configured as a secret)
2. **New function `fetchGoogleReviews(name, city, apiKey)`**:
   - Calls Google Places Text Search: `https://maps.googleapis.com/maps/api/place/textsearch/json?query={name}+{city}&type=restaurant&key=...`
   - Takes the first result's `place_id`
   - Calls Place Details: `https://maps.googleapis.com/maps/api/place/details/json?place_id=...&fields=reviews&key=...`
   - Returns up to 5 review text strings, or empty array
3. **Update `generateAtmosphereSummary`** — add a `reviewTexts: string[]` parameter. When reviews are available, include them in the AI prompt so the model summarizes actual customer impressions. When empty, fall back to current metadata-only prompt.
4. **Update the atmosphere generation loop** — before calling AI, call `fetchGoogleReviews`. Pass results into the updated summary function.
5. **Rate limiting** — increase delay between restaurants to ~300ms to stay within Google's QPS limits.

### Cost
- Each uncached restaurant = 2 Google API calls (Text Search + Details)
- Covered by Google's $200/month free credit
- Already-cached restaurants are skipped (no additional cost)

### No other files change
- `get-restaurants/index.ts` already reads from `atmosphere_cache` and attaches summaries — no changes needed
- Frontend already displays `atmosphereSummary` — no changes needed

### Files Modified
- `supabase/functions/scan-restaurants/index.ts` — add Google Places lookup + review-based AI prompts

