

# Urban Restaurant Discovery App — Implementation Plan

## Architecture
Client-only with Edge Function proxy to protect API keys. No database initially. All preferences in localStorage. Structured for future notifications.

## Phase 1: Core UI & Anonymous Identity
- Dark, moody themed layout (deep blacks, warm accents)
- Bottom nav: "New Openings" + "Settings" (Lucide icons)
- Generate UUID on first visit, store in localStorage
- Skeleton loaders for loading states
- `user-select: none` on interactive elements

## Phase 2: Settings & Preferences
- **City input**: Free-text search field with autocomplete (Google Places Autocomplete or similar) — user can select any city or town, not limited to a preset list
- Selected cities displayed as removable chips/tags
- Notification frequency: tap-to-select buttons (Daily, Every 3 Days, Weekly)
- All saved to localStorage with instant UI updates

## Phase 3: Discovery Feed
- Scrollable restaurant cards: name, image, food summary, atmosphere summary
- Distinct styling for food vs atmosphere (icons + color differentiation)
- **No result cap** — show all restaurants since last run
- **Auto-paging**: infinite scroll / "load more" pattern to handle large result sets
- Pull-to-refresh gesture
- "Last updated" timestamp
- Empty state: "No new openings — check back soon!"
- Mock data seeded for development

## Phase 4: Edge Function Proxy (Supabase)
- Single Edge Function that proxies restaurant discovery API calls
- API keys stored as environment secrets, never exposed to client
- Accepts city + last_checked timestamp, returns results
- Structured so cron/notifications can be layered on later

## Phase 5: PWA + Capacitor
- Web app manifest with dark theme
- Service worker for offline caching
- Capacitor config for Android native wrapper
- Custom install prompt after first city selection

## Technical Details
- **Files**: New pages (Index feed, Settings), shared layout with bottom nav, custom hooks for localStorage, city search component
- **Stack**: React + TypeScript + Tailwind + Vite (existing), Supabase Edge Function for API proxy
- **Mock data first**, real API integration deferred until keys are available

