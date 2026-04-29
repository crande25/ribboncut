# Opt-in Push Notifications for New Restaurants

Notify users via push when newly-discovered restaurants appear in their saved cities, respecting their Notification Frequency choice. Uses the Web Push standard so it works on Android (Chrome/Firefox/Edge) and iOS 16.4+ (Safari, only after the user installs the PWA to home screen).

## Critical platform reality (must read first)

- **Android**: Works in any modern browser, in or out of installed PWA. Solid experience.
- **iOS / iPadOS**: Web Push **only works if the user installs PlatePing to their home screen first** (iOS 16.4+, Safari only). Inside a regular Safari tab, the notification permission API doesn't even exist. The Settings UI will detect this and prompt the user to install the PWA before the toggle becomes available.
- **No native APNs/FCM accounts needed** — Web Push uses VAPID keys we generate ourselves and the browser's push service handles delivery.
- Notifications only fire from the **published URL**, never inside the Lovable editor preview.

## What the user sees

A new "Push Notifications" section in Settings, just under "Install App":

1. **If browser doesn't support push at all** (e.g. iOS Safari in a tab) → message: *"Install PlatePing to your home screen first to enable push notifications."* with a pointer up to the Install card.
2. **If supported but not yet enabled** → toggle labeled "Notify me about new restaurants" + a one-line description: *"You'll be pinged based on your Notification Frequency setting above."*
3. **Enabling it** → triggers the browser's native permission prompt → on grant, registers a push subscription and saves it to the backend tied to their `device_id` + currently-selected cities + frequency.
4. **If permission was denied** → shows a small notice: *"Notifications were blocked. Enable them in your browser settings."*
5. **If enabled** → toggle is on, plus a "Send test notification" button so the user can verify it works.

The existing **Notification Frequency** section's "(Coming soon!)" subtitle gets removed — it's now wired up.

## How it works (technical)

### 1. Database (one new table)

```sql
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  device_id text not null unique,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  cities text[] not null default '{}',
  frequency text not null default 'daily',  -- 'daily' | '3days' | 'weekly'
  last_notified_at timestamptz,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
-- Public anon access (anonymous app, no auth): allow upsert/select by device_id
create policy "anyone can manage their own subscription"
  on public.push_subscriptions for all
  using (true) with check (true);
```

We're following the existing pattern (no auth, `device_id` keyed) used by the rest of the app.

### 2. VAPID keys (one-time setup)

Two new secrets needed:
- `VAPID_PUBLIC_KEY` (also exposed to the frontend so browsers can subscribe)
- `VAPID_PRIVATE_KEY` (server-only, signs push messages)

I'll generate these once and request them via `add_secret`. The public key also lives in `VITE_VAPID_PUBLIC_KEY` for the frontend.

### 3. Service worker push handler

`public/sw-push.js` (loaded alongside the existing vite-plugin-pwa service worker via `importScripts` in a small custom SW config, or as a separate registration) handles:
- `push` event → shows notification with title, body, icon, click URL
- `notificationclick` event → opens the app at `/` (the feed)

### 4. Three new edge functions

- **`subscribe-push`** — POST `{device_id, subscription, cities, frequency}` → upserts row.
- **`unsubscribe-push`** — POST `{device_id}` → sets `enabled = false`.
- **`send-push-notifications`** — Cron-triggered. For each enabled subscription:
  - Skip if not due yet based on `frequency` vs `last_notified_at` (daily = 24h, 3days = 72h, weekly = 168h).
  - Query `restaurant_sightings` joined with `restaurant_metrics` for new discoveries since `last_notified_at` in the user's `cities`.
  - If ≥1 new restaurant → send Web Push via the `web-push` library (Deno port) with VAPID auth. Body example: *"3 new restaurants in Detroit & Ann Arbor — tap to see"*.
  - Update `last_notified_at`.
  - Handle `410 Gone` responses → mark subscription disabled (subscription expired/revoked).

- **`test-push`** — POST `{device_id}` → sends a single test notification immediately. Wired to the "Send test notification" button.

### 5. Cron schedule

One pg_cron job runs `send-push-notifications` hourly. The function itself decides per-user whether they're due. This naturally handles all three frequencies with one schedule.

### 6. Frontend pieces

- `src/hooks/usePushNotifications.ts` — handles support detection, permission request, subscribe/unsubscribe, syncing cities/frequency changes to the backend whenever they change.
- `src/components/PushNotificationsCard.tsx` — the Settings section described above.
- `src/pages/Settings.tsx` — render the new card; remove "(Coming soon!)" from the Frequency section.

When the user changes their selected cities or frequency in Settings, the hook automatically pushes the updated row to `subscribe-push` so the backend always has fresh targeting info.

## Files touched

- `supabase/migrations/...` (new table) — via migration tool
- `supabase/functions/subscribe-push/index.ts` (new)
- `supabase/functions/unsubscribe-push/index.ts` (new)
- `supabase/functions/send-push-notifications/index.ts` (new)
- `supabase/functions/test-push/index.ts` (new)
- `public/sw-push.js` (new)
- `vite.config.ts` (extend PWA config to include the push handler, `injectManifest` strategy)
- `src/hooks/usePushNotifications.ts` (new)
- `src/components/PushNotificationsCard.tsx` (new)
- `src/pages/Settings.tsx` (add card; un-"coming soon" the Frequency section)
- pg_cron SQL via insert tool (hourly schedule)

## Caveats to flag to user

- **iOS users must install the PWA first.** Without that, push is impossible — Apple's restriction, not ours.
- **Editor preview can't test push.** All real testing must happen on the published URL.
- **No backfill of past discoveries.** First notification only includes restaurants discovered *after* the user subscribes.
- **No selected cities = no notifications.** We won't ping users with nothing to say. The card will note this.
- **Browser may revoke subscriptions silently** (uninstall, clearing site data, long inactivity). The hourly job handles `410 Gone` by disabling the row; the user just has to re-toggle to re-subscribe.

## What I'll need from you

When implementation starts I'll:
1. Generate a fresh VAPID keypair and ask you to paste both halves into the secrets prompt.
2. Confirm you want hourly cron evaluation (vs. e.g. every 15 minutes — hourly is plenty for a "new restaurant" use case).
