## Goal

Remove 9 cities from the SE Michigan list across the frontend and edge function. Result: 20 cities → `ceil(20/3) = 7` Gemini grounded calls per daily harvest (down from 10), saving 3 calls/day against the free-tier cap.

## Cities removed

Shelby Township, Wyandotte, Waterford, Grosse Pointe, Taylor, Pontiac, Clinton Township, Warren, Sterling Heights.

## Cities kept (20)

Detroit, Ann Arbor, Novi, Troy, Royal Oak, Birmingham, Dearborn, Livonia, Canton, Plymouth, Farmington Hills, Southfield, Rochester Hills, West Bloomfield, Ferndale, Ypsilanti, Northville, Bloomfield Hills, Monroe, Port Huron.

## Files touched

1. **`src/lib/seMichiganCities.ts`** — drop the 9 cities from the exported array. The `SEMichiganCity` type narrows automatically. Anywhere the frontend filters/searches/displays the city list (e.g. `CityChecklist`, `CitySearch`, settings) updates automatically since they all import from this file.

2. **`supabase/functions/discover-new-restaurants/index.ts`** — drop the same 9 cities from the inline `SE_MICHIGAN_CITIES` array (lines 127–135). This is the master list used for chunking, validation (`knownSet`), and batching. `BATCH_SIZE = 3` stays as-is → 7 batches per run.

## Data already in the database

Existing `restaurant_sightings` and `scan_log` rows for the removed cities are **not deleted**. They'll simply stop receiving new entries. The frontend filters discoveries through the city list, so removed-city restaurants will no longer appear in the feed (they'll be filtered out). If you'd rather purge them, say the word and I'll add a cleanup migration — defaulting to "keep history, hide from UI."

## Cron

No cron change needed. The single daily job at 06:00 UTC still calls the function with `{}`; it'll now process 20 cities in 7 batches (~50–70s runtime) instead of 29 in 10 batches.

## Verification after deploy

Quick debug call to confirm the new list is in effect and a removed city is rejected:

```
POST /discover-new-restaurants
body: {"cities":["Warren, MI","Detroit, MI"], "debug":true}
```

Expect: log line "ignoring unknown cities: Warren, MI" and the debug response covering only Detroit.

## Tradeoffs / risks

- **History stays in DB**: feed already filters by the active city list, so removed cities silently disappear from the UI. No broken links or 404s.
- **Yelp pool / quotas**: unaffected.
- **Free tier headroom**: 7 calls/day leaves 13 calls of headroom under the 20/day cap (was 10).
