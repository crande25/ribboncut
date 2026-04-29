## Rename app to "RibbonCut"

Replace every user-visible and config reference to "PlatePing" with "RibbonCut" across the codebase. The change is purely textual — no schema, no logic, no asset regeneration.

### Files to change

**App shell / PWA metadata**
- `index.html` — `<title>`, `og:title`, `apple-mobile-web-app-title` → "RibbonCut" (tagline kept as "What Just Opened?")
- `public/manifest.json` — `name`, `short_name`
- `capacitor.config.ts` — `appName: "RibbonCut"` (leave `appId` alone; changing it would break existing installs)

**UI copy**
- `src/components/InstallAppCard.tsx` — "Add PlatePing…", "Install PlatePing"
- `src/components/PushNotificationsCard.tsx` — "Install PlatePing first", "add PlatePing"

**Edge functions**
- `supabase/functions/test-push/index.ts` — push title "PlatePing test 🍽️" → "RibbonCut test 🍽️"; default `VAPID_SUBJECT` mailto fallback `noreply@plateping.app` → `noreply@ribboncut.app`
- `supabase/functions/send-push-notifications/index.ts` — same `VAPID_SUBJECT` mailto fallback

### Out of scope (call out, don't change)

- **Capacitor `appId`** (`app.lovable.157d...`) — opaque, no brand string, leaving as-is to avoid breaking native app identity.
- **Icon images** (`favicon.png`, `pwa-icon-192.png`, `pwa-icon-512.png`) — if these visually contain the old name/logo, they'll need to be regenerated separately. I won't touch the binaries.
- **VAPID_SUBJECT secret** — the live secret value is set in Cloud and overrides the code fallback. If it's currently `mailto:…@plateping.app` you should update it in the secrets panel.
- **Domain / published URL** — the `lovable.app` preview URL is unchanged; a custom domain rename is a separate step.
- **Database identifiers** (table names, project ref) — none contain the brand name.

### After the rename

You'll likely also want new icon art and (optionally) a new VAPID_SUBJECT email — let me know and I can handle those as follow-ups.
