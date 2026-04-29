# Add "Install App" button to Settings

Make installing PlatePing to the home screen a one-tap action instead of hunting through browser menus.

## What the user will see

A new **"Install App"** section near the top of the Settings page (just under the heading), with a single prominent button:

- **Android / Chrome / Edge (desktop or mobile):** Tapping the button opens the browser's native install prompt. After install, the button hides itself.
- **iOS Safari:** No native prompt exists, so the button expands an inline instruction card: *"Tap the Share icon, then 'Add to Home Screen.'"* with a small illustration of the Share icon.
- **Already installed / unsupported browser:** Section is hidden entirely so it doesn't clutter Settings.

## How it works (technical)

1. **Capture the install prompt** — Add a small hook `useInstallPrompt` that:
   - Listens for the `beforeinstallprompt` window event, calls `preventDefault()`, and stashes the event.
   - Listens for `appinstalled` to clear the stashed event and mark installed.
   - Detects iOS Safari (`/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream`).
   - Detects standalone mode (`window.matchMedia('(display-mode: standalone)').matches` or `navigator.standalone`) to know if it's already installed.
   - Returns `{ canInstall, isIOS, isStandalone, promptInstall }`.

2. **New component `InstallAppCard`** in `src/components/InstallAppCard.tsx`:
   - Returns `null` if `isStandalone` or (no `canInstall` and not `isIOS`).
   - Otherwise renders the section with the button and (on iOS) the collapsible instructions.
   - Uses existing styling tokens (`bg-secondary`, `text-primary`, rounded-full button) to match the rest of Settings.

3. **Wire into `src/pages/Settings.tsx`** — Render `<InstallAppCard />` right after the page header, before the "Your Locations" section.

## Files touched

- `src/hooks/useInstallPrompt.ts` (new)
- `src/components/InstallAppCard.tsx` (new)
- `src/pages/Settings.tsx` (one import + one line)

## Caveats to flag

- The native install prompt only fires on the **published URL** (`https://...lovable.app` after publishing or your custom domain), not inside the Lovable editor preview. In the editor, iOS-style instructions will show as a fallback for testing the layout.
- Chrome only fires `beforeinstallprompt` once per page load and only when its install criteria are met (HTTPS, valid manifest, icons — all already in place).
- Firefox on Android does not fire `beforeinstallprompt`; users there will see no button (acceptable — small audience, and they can still use the browser menu).
