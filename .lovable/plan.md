## Rotating tagline under "RibbonCut"

Replace the static "What just opened" line in `src/components/RestaurantFeed.tsx` with a tagline that rotates through a fixed list on each page load (initial mount, navigation back to `/`, or full refresh). Order is deterministic — always cycles in the same sequence, starting from where it left off last time.

### Phrase list (in rotation order)

1. WHAT JUST OPENED *(current — stays first)*
2. FRESH OUT THE KITCHEN
3. NEW DOORS OPENED
4. CUT THE LINE
5. TASTE IT FIRST
6. BE THE FIRST BITE
7. NEW FLAVORS JUST DROPPED
8. NO OLD NEWS
9. SKIP THE CLASSICS
10. DINE DIFFERENT

### How it works

- Persist an integer index in `localStorage` under `tagline_index` using the existing `useLocalStorage` hook.
- On `RestaurantFeed` mount, read the current index, display `PHRASES[index]`, then write `(index + 1) % PHRASES.length` so the next page load shows the next phrase.
- The advance happens once per mount inside a `useEffect` with an empty dep array (guarded by a ref so React 18 StrictMode double-invoke in dev doesn't skip a phrase).
- First-ever visit defaults to index `0` → "WHAT JUST OPENED", matching today's behavior.

### Files

- `src/components/RestaurantFeed.tsx` — add `PHRASES` constant, small `useRotatingTagline` logic (or inline `useEffect`), swap the hardcoded string in the header `<p>`.

### Non-goals / preserved behavior

- No animation/fade — just a different string per load (matches request: "rotate on page load").
- No changes to data fetching, styling, or layout. Same `text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground` classes.
- No backend changes.