## Goal
Make the Feed loading state visibly active so users know something's happening.

## Approach
Today the feed shows shadcn `<Skeleton>` placeholders, which use a subtle `animate-pulse`. Make it more obvious by adding a slower, deeper **card-level strobe** with staggered delays so the 3 placeholder cards pulse in a wave.

## Changes

### 1. `tailwind.config.ts` — add `card-strobe` keyframe
```ts
keyframes: {
  // ...existing...
  "card-strobe": {
    "0%, 100%": { opacity: "1", transform: "scale(1)" },
    "50%":      { opacity: "0.55", transform: "scale(0.995)" },
  },
},
animation: {
  // ...existing...
  "card-strobe": "card-strobe 1.8s ease-in-out infinite",
},
```

### 2. `src/components/RestaurantFeed.tsx` (lines 233–241) — apply strobe + stagger
Wrap each placeholder in `animate-card-strobe` with staggered `animationDelay` (0ms, 300ms, 600ms) so they pulse in sequence rather than in unison. Keep the existing inner `<Skeleton>` shimmer for added texture.

```tsx
{Array.from({ length: 3 }).map((_, i) => (
  <div
    key={i}
    className="rounded-lg border border-border bg-card p-4 space-y-3 animate-card-strobe"
    style={{ animationDelay: `${i * 300}ms` }}
  >
    <Skeleton className="h-48 w-full rounded-md" />
    <Skeleton className="h-4 w-2/3" />
    <Skeleton className="h-3 w-1/3" />
    <Skeleton className="h-20 w-full rounded-md" />
    <Skeleton className="h-20 w-full rounded-md" />
  </div>
))}
```

## Result
Each placeholder card slowly fades to ~55% opacity and back over 1.8s, with a 300ms offset between cards — clearly conveying "loading in progress" without being distracting. Inner skeleton shimmer remains for additional motion.

## Files changed
- `tailwind.config.ts`
- `src/components/RestaurantFeed.tsx`
