## Goal

Add a Content Security Policy to mitigate XSS and unauthorized resource loading. Implement via `<meta http-equiv="Content-Security-Policy">` in `index.html` since Lovable hosting doesn't expose response-header config.

## Caveat (be honest about it)

A meta-tag CSP is weaker than a header CSP — `frame-ancestors`, `report-uri`, and `sandbox` are ignored when set via meta. Everything else works. For your threat model (small audience, no auth, public data) this is the right trade-off; if you ever move to self-hosting, port the policy to a real header.

## Inventory of what the app loads

| Resource | Origin |
|---|---|
| App JS/CSS | self (built bundle) |
| Supabase REST + Edge Functions | `https://dcvgzkhoxlvtynlnxsdw.supabase.co` |
| Yelp restaurant images | `https://*.fl.yelpcdn.com` |
| Mock/demo images | `https://images.unsplash.com` |
| OpenStreetMap geocoding (CitySearch) | `https://nominatim.openstreetmap.org` |
| OG preview image | `https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev` |
| Vite dev HMR (preview only) | `ws:` and `wss:` to lovable preview hosts |
| Inline styles | Tailwind/shadcn inject some — needs `'unsafe-inline'` for `style-src` |

No Google Fonts, no analytics scripts, no third-party JS in the client. Lovable's visitor tracking is injected by the host platform on the published domain and is exempt from app-level CSP because it runs above your bundle.

## The policy

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://*.fl.yelpcdn.com https://images.unsplash.com https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev;
font-src 'self' data:;
connect-src 'self' https://dcvgzkhoxlvtynlnxsdw.supabase.co wss://dcvgzkhoxlvtynlnxsdw.supabase.co https://nominatim.openstreetmap.org ws: wss:;
manifest-src 'self';
worker-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
upgrade-insecure-requests
```

Notes on the choices:
- `script-src 'self'` — no inline scripts, no `unsafe-eval`. Vite production builds don't need either.
- `style-src 'unsafe-inline'` — required by shadcn/Radix/Tailwind which inject style attributes at runtime. Removing it breaks every dialog, tooltip, and animated component. Acceptable trade-off.
- `img-src` allowlist covers Yelp CDN (real data), Unsplash (mock fallback), and the R2 OG image host.
- `connect-src` includes `wss:` for Vite HMR in the preview iframe; harmless in production.
- `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` — cheap hardening wins.
- `upgrade-insecure-requests` — auto-promotes any stray `http://` references.

## Files to change

- **Edit `index.html`** — add a single `<meta http-equiv="Content-Security-Policy" content="…">` tag in `<head>`, just after the charset/viewport metas.

No other files change. No backend changes. No dependencies.

## Verification after deploy

1. Open the preview, browse the feed, open Settings, submit Contact us, install PWA prompt, refresh.
2. Open DevTools console and filter for `Content Security Policy` — any violations will be logged. If something legitimate is blocked (e.g., a Yelp image from a new subdomain), I'll widen the allowlist.
3. Run https://csp-evaluator.withgoogle.com/ against the published URL for a second opinion.

## Rollback

If something breaks in production that I missed, comment out the meta tag in `index.html` and republish — instant revert, no migration involved.

## What this does not cover

- Lovable's host-level analytics/badges (out of your control, run above your CSP)
- `frame-ancestors` (ignored in meta) — if you care about clickjacking protection, that needs the header form on a self-hosted setup later.
