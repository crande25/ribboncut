# Sync Lockfiles + Apply Minor/Patch Updates

## Goal

1. Resolve Dependabot drift by getting `package-lock.json` back in sync with `package.json` (currently pins `flatted@3.3.1` instead of `^3.4.2`).
2. Apply all available **minor and patch** updates to dependencies. **No major version bumps.**
3. Regenerate `bun.lockb` in the same commit so both lockfiles stay aligned (Option B from the previous discussion).

## Steps

### 1. Refresh `package-lock.json` with current `package.json` ranges
Run npm in lockfile-only mode so it re-resolves every dependency to the highest version allowed by the existing `^` ranges, without touching `node_modules` or running install scripts:

```
npm install --package-lock-only --ignore-scripts
```

This alone will pull in `flatted@3.4.2+` and any other in-range patches that have been published since the lockfile was last generated, closing Dependabot PR #7 automatically.

### 2. Apply minor/patch updates to `package.json`
Use `npm-check-updates` (via `npx`, no install) restricted to minor/patch only:

```
npx --yes npm-check-updates -u --target minor
```

`--target minor` upgrades both minor and patch versions but never crosses a major boundary. Then re-run step 1 to lock the new ranges:

```
npm install --package-lock-only --ignore-scripts
```

### 3. Regenerate `bun.lockb`
```
bun install
```

This rewrites the bun lockfile to match the updated `package.json`. Both lockfiles will then resolve identical versions.

### 4. Verify
- `grep '"flatted"' package-lock.json` → should show `3.4.x` (no `3.3.1` remnants).
- Confirm no major version bumps occurred by diffing `package.json` major numbers before/after.
- The harness will run the build automatically; if anything breaks, roll back the offending package individually.

### 5. Commit
Both `package.json`, `package-lock.json`, and `bun.lockb` go in the same commit. Append a CHANGELOG entry under today's date describing the dependency refresh and that it closes Dependabot PR #7.

## What is explicitly out of scope

- **No major version bumps.** Examples that will be skipped: `lucide-react` (0.462 → 0.x latest is fine since pre-1.0 minors are still treated as minors by ncu's `--target minor`), `date-fns` 3 → 4, `react-day-picker` 8 → 9, `tailwind-merge` 2 → 3, `vaul` 0.9 → 1.x, `react-resizable-panels` 2 → 3 if available, `embla-carousel-react` 8 → newer major, `vite` 5 → 7, `tailwindcss` 3 → 4, `jsdom` 20 → newer, `@types/node` 22 → 24, `globals` 15 → 16, etc. Any of these that have a newer major will be left alone.
- No code refactors. Pure dependency hygiene.

## Expected outcome

- Dependabot PR #7 (`flatted`) auto-closes within minutes of the push to `main`.
- All other in-range patches/minors picked up in the same sweep, so we don't immediately get new Dependabot PRs for the same class of drift.
- `bun.lockb` and `package-lock.json` both resolve identical versions going forward — until the next manual sweep, which we should run anytime Dependabot opens a new PR.
