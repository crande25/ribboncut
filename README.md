# RibbonCut

A mobile-first PWA that surfaces brand-new restaurants opening across Southeast Michigan. Users pick the cities they care about, set price/rating/dietary filters, and get a chronological feed of "what just opened."

## Architecture

Hybrid: the database tracks lightweight sightings (`yelp_id` + `first_seen_at` + `city`), and metadata (name, image, hours, rating) is fetched live from Yelp on demand and cached opportunistically. A daily pg_cron job (`discover-new-restaurants`) uses Lovable AI (Gemini with Google Search grounding) to find candidates per city, then verifies each against Yelp before inserting a sighting.

```text
                                 ┌──────────────────────────┐
  pg_cron (daily 3am ET)  ─────► │ discover-new-restaurants │ ─► restaurant_sightings
                                 └──────────────────────────┘
                                                                       │
                                                                       ▼
   PWA  ──►  get-restaurants  ──►  PostgREST page  +  cache batch  +  Yelp enrich  ──►  Feed
```

## Stack

- React 18 + Vite 5 + TypeScript + Tailwind v3 + shadcn/ui
- Lovable Cloud (Supabase under the hood) for DB, Auth, Edge Functions
- Yelp Fusion API for restaurant metadata (with rotating multi-key pool)
- Lovable AI Gateway (Gemini) for candidate discovery and atmosphere blurbs
- Web Push for "new restaurant near you" notifications

## Run locally

```bash
bun install
bun run dev
```

Edge functions deploy automatically when changed in Lovable; no manual deploy step.

## Project layout

```
src/
  components/        UI components (RestaurantFeed, RestaurantCard, settings/, ui/)
  hooks/             useRestaurantFeed, useTheme, usePushNotifications, ...
  lib/               api.ts (edge-fn client), restaurantMapper, seMichiganCities
  pages/             Index (feed), Settings, Unsubscribe
supabase/
  functions/
    _shared/         http.ts, yelpKeyPool.ts (CORS, JSON helpers, key rotation)
    get-restaurants/ params, sightingsQuery, cache, prefilter, vibeBackfill, yelpEnrich, index
    discover-new-restaurants/  daily AI-driven discovery
    generate-vibe/   AI atmosphere blurb generator
    ...              push, email, backfill jobs
```
