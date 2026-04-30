// Owns all data-fetching state for the restaurant feed:
//   restaurants, loading, loadingMore, refreshing, hasMore, currentOffset,
//   usingMockData. Plus loadFromStart (initial + refresh) and loadMore
//   (pagination). The component is left as pure presentation.
//
// Critical behavior preserved from the previous inline implementation:
//   - The cursor advances by PAGE_SIZE (the unfiltered page width), NOT by
//     the number of post-filter results returned. Otherwise we'd loop
//     forever fetching ~1 result at a time when filters are tight.
//   - Initial / refresh / loadMore all share one fetch path so the cursor
//     logic can never drift between them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRestaurants, PAGE_SIZE } from "@/lib/api";
import { mapToRestaurant, buildMockFallback } from "@/lib/restaurantMapper";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { toast } from "@/hooks/use-toast";
import type { Restaurant } from "@/lib/mockData";

interface FetchPageResult {
  results: Restaurant[];
  total: number;
  hasMore: boolean;
  nextOffset: number;
}

export function useRestaurantFeed() {
  const [selectedCities] = useLocalStorage<string[]>("selected_cities", []);
  const [dietaryFilters] = useLocalStorage<string[]>("dietary_filters", []);
  const [priceFilters] = useLocalStorage<number[]>("price_filters", []);
  const [minRating] = useLocalStorage<number>("min_rating", 0);
  const [openedWithinValue] = useLocalStorage<number>("opened_within_value", 1);
  const [openedWithinUnit] = useLocalStorage<string>("opened_within_unit", "months");
  const [, setLastChecked] = useLocalStorage<string>("last_checked", "");

  const openedSince = useMemo(() => {
    const now = new Date();
    if (openedWithinUnit === "days") now.setDate(now.getDate() - openedWithinValue);
    else if (openedWithinUnit === "weeks") now.setDate(now.getDate() - openedWithinValue * 7);
    else now.setMonth(now.getMonth() - openedWithinValue);
    return now.toISOString();
  }, [openedWithinValue, openedWithinUnit]);

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [usingMockData, setUsingMockData] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [currentOffset, setCurrentOffset] = useState(0);

  const fetchPage = useCallback(
    async (offset: number): Promise<FetchPageResult> => {
      const response = await getRestaurants(
        selectedCities,
        offset,
        PAGE_SIZE,
        openedSince,
        dietaryFilters.length > 0 ? dietaryFilters : undefined,
        priceFilters.length > 0 ? priceFilters : undefined,
        minRating > 0 ? minRating : undefined,
      );
      const mapped = response.restaurants.map(mapToRestaurant);
      // Advance the cursor by the page size we requested (against the
      // unfiltered `total`), not by the filtered result count — see top-of-
      // file note for why.
      const nextOffset = offset + PAGE_SIZE;
      return {
        results: mapped,
        total: response.total,
        hasMore: nextOffset < response.total,
        nextOffset,
      };
    },
    [selectedCities, dietaryFilters, priceFilters, minRating, openedSince],
  );

  /** Used by both initial load and pull-to-refresh. */
  const loadFromStart = useCallback(
    async (opts: { showSkeleton: boolean; toastOnFallback: boolean }) => {
      if (opts.showSkeleton) setLoading(true);
      else setRefreshing(true);

      setLastChecked("");

      if (selectedCities.length === 0) {
        setRestaurants([]);
        setHasMore(false);
        if (opts.showSkeleton) setLoading(false);
        else setRefreshing(false);
        return;
      }

      try {
        const { results, hasMore: more, nextOffset } = await fetchPage(0);
        if (results.length > 0) {
          setRestaurants(results);
          setCurrentOffset(nextOffset);
          setHasMore(more);
          setUsingMockData(false);
        } else if (more) {
          // Page returned no results after server-side filtering, but more
          // sightings exist — keep paginating from the next offset.
          setRestaurants([]);
          setCurrentOffset(nextOffset);
          setHasMore(true);
          setUsingMockData(false);
        } else {
          setRestaurants([]);
          setHasMore(false);
          setUsingMockData(false);
        }
      } catch {
        const fallback = buildMockFallback(selectedCities);
        setRestaurants(fallback);
        setUsingMockData(true);
        setHasMore(false);
        if (opts.toastOnFallback) {
          toast({
            title: "Showing sample spots",
            description: "Couldn't reach the live feed — here's some demo data for now.",
          });
        } else {
          console.log("Falling back to mock data");
        }
      }

      if (opts.showSkeleton) setLoading(false);
      else setRefreshing(false);
      setLastChecked(new Date().toISOString());
    },
    [selectedCities, fetchPage, setLastChecked],
  );

  useEffect(() => {
    loadFromStart({ showSkeleton: true, toastOnFallback: false });
  }, [loadFromStart]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || usingMockData) return;
    setLoadingMore(true);

    try {
      const { results, hasMore: more, nextOffset } = await fetchPage(currentOffset);
      if (results.length > 0) {
        setRestaurants((prev) => {
          const existingIds = new Set(prev.map((r) => r.id));
          const unique = results.filter((r) => !existingIds.has(r.id));
          return [...prev, ...unique];
        });
      }
      // Always advance the cursor by the requested page size — even when this
      // page returned 0 results after server-side filtering — so we keep
      // walking until we've covered the unfiltered `total`.
      setCurrentOffset(nextOffset);
      setHasMore(more);
    } catch {
      setHasMore(false);
    }

    setLoadingMore(false);
  }, [loadingMore, hasMore, usingMockData, currentOffset, fetchPage]);

  const refresh = useCallback(
    () => loadFromStart({ showSkeleton: false, toastOnFallback: true }),
    [loadFromStart],
  );

  return {
    selectedCities,
    restaurants,
    loading,
    loadingMore,
    refreshing,
    usingMockData,
    hasMore,
    loadMore,
    refresh,
  };
}

/** Wire IntersectionObserver to a sentinel ref so loadMore fires on scroll. */
export function useInfiniteScrollSentinel(loadMore: () => void) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);
  return sentinelRef;
}
