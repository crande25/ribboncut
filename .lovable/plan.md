## Goal

Surface the RibbonCut name in two specific places without adding permanent chrome to the Feed.

---

## 1. Settings page header

**File:** `src/pages/Settings.tsx` (line 90)

Replace the current `<h1>Settings ⚙️</h1>` with a two-line header:
- Top line: `<h1>RibbonCut</h1>` — large, bold, primary-colored wordmark (the brand).
- Bottom line: small muted "Settings" subtitle so users still know where they are.

The "Clear Filters" button stays in its current right-aligned position, vertically centered against the new stacked header.

Approx markup:
```tsx
<div className="flex items-end justify-between gap-3">
  <div className="space-y-0.5">
    <h1 className="text-2xl font-bold tracking-tight text-primary">RibbonCut</h1>
    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Settings</p>
  </div>
  {hasAnyFilter && (/* existing Clear Filters button */)}
</div>
```

No other Settings sections change.

---

## 2. Feed loading & empty states — brand splash

**File:** `src/components/RestaurantFeed.tsx`

Add a centered brand splash that appears in three scenarios:
- Initial loading (`loading && selectedCities.length > 0`)
- No locations selected (`selectedCities.length === 0 && !loading`)
- Empty results (`selectedCities.length > 0 && restaurants.length === 0` after load)

It replaces (loading) or sits above (empty states) the existing skeleton/empty UI. Once `restaurants.length > 0`, the splash is not rendered — restaurant cards take over. This keeps the Feed clean during normal use (no permanent header) while still name-dropping when the screen is otherwise empty.

### Splash component (inline, top of the feed body)

```tsx
<div className="flex flex-col items-center gap-2 py-10 text-center animate-in fade-in duration-500">
  <h1 className="text-4xl font-bold tracking-tight text-primary">RibbonCut</h1>
  <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
    What just opened
  </p>
</div>
```

### Integration

- Remove the current small `<h1>What Just Opened 🍽️</h1>` heading from line 203 — it duplicates branding and creates the "permanent chrome" we want to avoid.
- Keep the refresh button, but move it to a top-right floating position (absolute, top-right of the feed container) so it remains accessible without anchoring a header bar.
- Render the splash above the loading skeletons, the "Select at least one location" card, and the "Nothing new yet!" card.
- When `restaurants.length > 0`, only the cards render — no splash, no header. Pure content.

### Behavior summary

| State | What user sees |
|---|---|
| First load (with cities) | RibbonCut splash + skeletons |
| No cities selected | RibbonCut splash + "Select at least one location" prompt |
| Loaded, empty results | RibbonCut splash + "Nothing new yet!" |
| Loaded, has results | Just the restaurant cards (refresh button floats top-right) |

The splash naturally fades in via Tailwind's `animate-in fade-in` utility. It is not separately animated out — it simply unmounts when results arrive, which is visually clean given the skeleton-to-card transition.

---

## Out of scope

- No logo image — text wordmark only (matches existing minimal aesthetic).
- No changes to BottomNav, RestaurantCard, or any other component.
- No new design tokens; uses existing `text-primary` and `text-muted-foreground`.
