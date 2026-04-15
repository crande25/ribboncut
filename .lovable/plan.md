

# Fix: Infinite API Request Loop on Feed Screen

## Problem
The feed is firing 30+ identical API requests per second in an infinite loop. No "no results" message ever appears because the component never settles.

## Root Cause
`useLocalStorage` hook creates a new `setValue` function reference every time the stored value changes (because `storedValue` is in `useCallback`'s dependency array). In `RestaurantFeed`:

1. `fetchInitial` runs and calls `setLastChecked(new Date().toISOString())` at line 101
2. This updates `lastChecked`, which creates a new `setLastChecked` function reference
3. `fetchInitial` has `setLastChecked` in its dependency array, so `useCallback` recreates it
4. The `useEffect` at line 104 sees a new `fetchInitial` and re-runs it
5. Go to step 1 -- infinite loop

## Fix (two changes)

### 1. Fix `useLocalStorage` hook (`src/hooks/useLocalStorage.ts`)
Use a ref to hold `storedValue` so `setValue` has a stable identity:

```typescript
const valueRef = useRef(storedValue);
valueRef.current = storedValue;

const setValue = useCallback(
  (value: T | ((val: T) => T)) => {
    const valueToStore = value instanceof Function ? value(valueRef.current) : value;
    setStoredValue(valueToStore);
    window.localStorage.setItem(key, JSON.stringify(valueToStore));
  },
  [key]  // no longer depends on storedValue
);
```

This makes `setValue` stable across renders (only changes if `key` changes), matching `useState`'s `setState` behavior.

### 2. Remove `setLastChecked` from `fetchInitial` deps (belt-and-suspenders)
In `RestaurantFeed.tsx`, remove `setLastChecked` from the `fetchInitial` `useCallback` dependency array since it's only called for a side effect and shouldn't trigger re-fetching.

### Files changed
- `src/hooks/useLocalStorage.ts` -- stabilize `setValue` reference
- `src/components/RestaurantFeed.tsx` -- clean up dependency array

