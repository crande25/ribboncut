## Goal
Upgrade `vite` from `^5.4.21` to `^8.0.10` (skipping v6 and v7 entirely — three majors at once).

## Why this is medium-risk
Vite 5 → 8 crosses three major versions. Breaking changes accumulated across them include:
- **Node.js minimum** raised (v8 requires Node 20.19+ / 22.12+). Lovable's build environment supports this.
- **Rollup 4 → Rollup 5** internals (v7).
- **Default browser target** raised (`baseline-widely-available`) — modern browsers only.
- **Sass legacy API removed**, **CJS Node API removed** (we use neither — config is ESM, no Sass).
- **HMR API changes** and some plugin hook signature tweaks.

Our `vite.config.ts` is simple (server config + 3 plugins + alias/dedupe). No custom Rollup config, no legacy APIs. Risk surface is mostly the plugins keeping up.

## Coordinated peer bumps required
Vite 8 needs newer peers. From `npm-check-updates`:

| Package | Current | Target | Notes |
|---|---|---|---|
| `vite` | ^5.4.21 | ^8.0.10 | main bump |
| `@vitejs/plugin-react-swc` | ^3.11.0 | ^4.3.0 | v4 required for Vite 7+ peer range |
| `vite-plugin-pwa` | ^1.2.0 | ^1.2.0 | already supports Vite 7/8 in peerDeps |
| `vitest` | ^3.2.4 | ^3.2.4 | keep on v3 (v4 is its own major; defer) |
| `lovable-tagger` | (managed) | (managed) | Lovable-controlled, should track Vite |

## Steps

1. Update `package.json`:
   - `vite`: `^8.0.10`
   - `@vitejs/plugin-react-swc`: `^4.3.0`
   - Leave `vite-plugin-pwa`, `vitest`, `lovable-tagger` as-is.

2. Regenerate lockfiles:
   - `npm install --package-lock-only` (refresh `package-lock.json`)
   - `bun install` (refresh `bun.lock`)

3. Verify `vite.config.ts` still loads — no API changes needed for what we use (`defineConfig`, `server`, `plugins`, `resolve.alias`, `resolve.dedupe`). The PWA plugin config (`registerType`, `workbox.globPatterns`, `manifest: false`) is unchanged across PWA plugin v1.x.

4. Verify `vitest.config.ts` — vitest v3 stays on Vite 5/6/7/8 compat range; should work without edits.

5. Run regression pass:
   - Vitest suite (`vitest run`)
   - Dev server boot (auto via Lovable preview) — watch for plugin peer warnings or HMR errors
   - Manually verify `/` (Feed) and `/settings` render
   - Check console for new errors

6. Update `CHANGELOG.md` with dated entry covering the Vite 5→8 jump and `@vitejs/plugin-react-swc` 3→4 bump.

## Rollback plan
If anything breaks (PWA build, SWC plugin, HMR), revert `package.json` + lockfiles to the prior pin and report back. No source code changes are part of this plan, so rollback is a clean lockfile revert.

## Out of scope (deferring)
- `vitest` v3 → v4 (separate major, its own breaking changes around config/reporters)
- `eslint` v9 → v10, `typescript` 5.9 → 6.0 (previously deferred medium-risk batch)
- React 19, Tailwind 4, React Router 7, Zod 4 (previously deferred high-risk)
