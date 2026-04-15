import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { RefreshCw, MapPin } from "lucide-react";
import { RestaurantCard } from "./RestaurantCard";
import { Skeleton } from "@/components/ui/skeleton";
import { mockRestaurants, type Restaurant } from "@/lib/mockData";
import { discoverRestaurants } from "@/lib/api";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { toast } from "@/hooks/use-toast";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "./PullToRefreshIndicator";

const PAGE_SIZE = 20;

export function RestaurantFeed() {
  const [selectedCities] = useLocalStorage<string[]>("selected_cities", []);
  const [dietaryFilters] = useLocalStorage<string[]>("dietary_filters", []);
  const [openedWithinValue] = useLocalStorage<number>("opened_within_value", 1);
  const [openedWithinUnit] = useLocalStorage<string>("opened_within_unit", "months");
  const [lastChecked, setLastChecked] = useLocalStorage<string>("last_checked", "");

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
  const [cityOffsets, setCityOffsets] = useState<Record<string, number>>({});
  const sentinelRef = useRef<HTMLDivElement>(null);

  const mapYelpToRestaurant = (r: any): Restaurant => ({
    id: r.id,
    name: r.name,
    city: r.city,
    imageUrl: r.imageUrl || r.photos?.[0] || "",
    foodSummary: `${r.cuisine} • ${r.rating ? `${r.rating}★` : ""} ${r.reviewCount ? `(${r.reviewCount} reviews)` : ""}`.trim(),
    atmosphereSummary: r.address || "",
    openedDate: new Date().toISOString(),
    cuisine: r.cuisine,
    priceRange: r.priceRange,
    rating: r.rating,
    reviewCount: r.reviewCount,
    address: r.address,
    phone: r.phone,
    url: r.url,
    photos: r.photos,
  });

  const fetchPage = useCallback(async (cities: string[], offsets: Record<string, number>, since?: string, dietary?: string[]) => {
    const allResults: Restaurant[] = [];
    const newOffsets = { ...offsets };
    let anyHasMore = false;

    for (const city of cities) {
      const offset = offsets[city] ?? 0;
      try {
        const response = await discoverRestaurants(city, offset, PAGE_SIZE, since || undefined, dietary);
        const mapped = response.restaurants.map(mapYelpToRestaurant);
        allResults.push(...mapped);
        newOffsets[city] = offset + response.restaurants.length;
        if (offset + response.restaurants.length < response.total) {
          anyHasMore = true;
        }
      } catch (err) {
        console.error(`Failed to fetch restaurants for ${city}:`, err);
      }
    }

    return { results: allResults, newOffsets, anyHasMore };
  }, []);

  const fetchInitial = useCallback(async () => {
    setLoading(true);
    if (selectedCities.length === 0) {
      setRestaurants([]);
      setLoading(false);
      setHasMore(false);
      return;
    }

    const initialOffsets: Record<string, number> = {};
    selectedCities.forEach(c => { initialOffsets[c] = 0; });

    try {
      const { results, newOffsets, anyHasMore } = await fetchPage(selectedCities, initialOffsets, openedSince, dietaryFilters);
      if (results.length > 0) {
        setRestaurants(results);
        setCityOffsets(newOffsets);
        setHasMore(anyHasMore);
        setUsingMockData(false);
      } else {
        throw new Error("No results from API");
      }
    } catch {
      console.log("Falling back to mock data");
      let filtered = mockRestaurants;
      if (selectedCities.length > 0) {
        filtered = filtered.filter((r) => selectedCities.includes(r.city));
      }
      filtered.sort((a, b) => new Date(b.openedDate).getTime() - new Date(a.openedDate).getTime());
      setRestaurants(filtered);
      setUsingMockData(true);
      setHasMore(false);
    }

    setLoading(false);
    setLastChecked(new Date().toISOString());
  }, [selectedCities, dietaryFilters, openedSince, setLastChecked, fetchPage]);

  useEffect(() => {
    fetchInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCities, dietaryFilters, openedSince]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || usingMockData) return;
    setLoadingMore(true);

    try {
      const { results, newOffsets, anyHasMore } = await fetchPage(selectedCities, cityOffsets, undefined, dietaryFilters);
      if (results.length > 0) {
        setRestaurants(prev => {
          const existingIds = new Set(prev.map(r => r.id));
          const unique = results.filter(r => !existingIds.has(r.id));
          return [...prev, ...unique];
        });
        setCityOffsets(newOffsets);
      }
      setHasMore(anyHasMore && results.length > 0);
    } catch {
      setHasMore(false);
    }

    setLoadingMore(false);
  }, [loadingMore, hasMore, usingMockData, selectedCities, dietaryFilters, cityOffsets, fetchPage]);

  // Infinite scroll observer
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setLastChecked("");

    if (selectedCities.length === 0) {
      setRestaurants([]);
      setRefreshing(false);
      return;
    }

    const initialOffsets: Record<string, number> = {};
    selectedCities.forEach(c => { initialOffsets[c] = 0; });

    try {
      const { results, newOffsets, anyHasMore } = await fetchPage(selectedCities, initialOffsets, undefined, dietaryFilters);
      if (results.length > 0) {
        setRestaurants(results);
        setCityOffsets(newOffsets);
        setHasMore(anyHasMore);
        setUsingMockData(false);
      } else {
        throw new Error("No results");
      }
    } catch {
      let filtered = mockRestaurants;
      if (selectedCities.length > 0) {
        filtered = filtered.filter((r) => selectedCities.includes(r.city));
      }
      filtered.sort((a, b) => new Date(b.openedDate).getTime() - new Date(a.openedDate).getTime());
      setRestaurants(filtered);
      setUsingMockData(true);
      setHasMore(false);
      toast({
        title: "Showing sample spots",
        description: "Couldn't reach the live feed — here's some demo data for now.",
      });
    }

    setRefreshing(false);
    setLastChecked(new Date().toISOString());
  };

  const { containerRef, pullDistance, refreshing: pullRefreshing, isPastThreshold } = usePullToRefresh({
    onRefresh: handleRefresh,
  });

  return (
    <div ref={containerRef} className="space-y-4 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
      <PullToRefreshIndicator
        pullDistance={pullDistance}
        refreshing={pullRefreshing}
        isPastThreshold={isPastThreshold}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">What Just Opened 🍽️</h1>
          {lastChecked && (
            <p className="text-xs text-muted-foreground">
              Updated {new Date(lastChecked).toLocaleString()}
              {usingMockData && " • Demo data"}
            </p>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {selectedCities.length === 0 && !loading && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-12 text-center">
          <MapPin className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">No cities yet!</p>
            <p className="text-xs text-muted-foreground">
              Tap Settings and pick some cities to see what's new 🗺️
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-3">
              <Skeleton className="h-48 w-full rounded-md" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-20 w-full rounded-md" />
              <Skeleton className="h-20 w-full rounded-md" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {selectedCities.length > 0 && restaurants.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-12 text-center">
              <p className="text-sm font-medium text-foreground">Nothing new yet!</p>
              <p className="text-xs text-muted-foreground">Check back soon — new spots pop up all the time 🤞</p>
            </div>
          )}

          <div className="space-y-4">
            {restaurants.map((r) => (
              <RestaurantCard key={r.id} restaurant={r} />
            ))}
          </div>

          {hasMore && (
            <div ref={sentinelRef} className="flex justify-center py-4">
              {loadingMore ? (
                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <span className="text-xs text-muted-foreground">Scroll for more</span>
              )}
            </div>
          )}

          {!hasMore && restaurants.length > 0 && (
            <p className="text-center text-xs text-muted-foreground py-4">
              {restaurants.length} restaurant{restaurants.length !== 1 ? "s" : ""} found
            </p>
          )}
        </>
      )}
    </div>
  );
}
