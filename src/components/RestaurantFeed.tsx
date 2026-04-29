import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { RefreshCw, MapPin } from "lucide-react";
import { RestaurantCard } from "./RestaurantCard";
import { Skeleton } from "@/components/ui/skeleton";
import { mockRestaurants, type Restaurant } from "@/lib/mockData";
import { getRestaurants } from "@/lib/api";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { toast } from "@/hooks/use-toast";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "./PullToRefreshIndicator";

const PAGE_SIZE = 20;

export function RestaurantFeed() {
  const [selectedCities] = useLocalStorage<string[]>("selected_cities", []);
  const [dietaryFilters] = useLocalStorage<string[]>("dietary_filters", []);
  const [priceFilters] = useLocalStorage<number[]>("price_filters", []);
  const [minRating] = useLocalStorage<number>("min_rating", 0);
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
  const [currentOffset, setCurrentOffset] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const mapToRestaurant = (r: any): Restaurant => ({
    id: r.id,
    name: r.name,
    city: r.city,
    imageUrl: r.imageUrl || r.photos?.[0] || "",
    foodSummary: r.cuisine,
    atmosphereSummary: r.atmosphereSummary || `${r.cuisine} · ${r.priceRange || ""}`.replace(/ · $/, ""),
    openedDate: r.firstSeenAt || new Date().toISOString(),
    cuisine: r.cuisine,
    priceRange: r.priceRange,
    rating: r.rating,
    reviewCount: r.reviewCount,
    address: r.address,
    phone: r.phone,
    url: r.url,
    photos: r.photos,
  });

  const fetchPage = useCallback(async (offset: number) => {
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
    return { results: mapped, total: response.total, hasMore: offset + mapped.length < response.total };
  }, [selectedCities, dietaryFilters, priceFilters, minRating, openedSince]);

  const fetchInitial = useCallback(async () => {
    setLoading(true);
    if (selectedCities.length === 0) {
      setRestaurants([]);
      setLoading(false);
      setHasMore(false);
      return;
    }

    try {
      const { results, hasMore: more } = await fetchPage(0);
      if (results.length > 0) {
        setRestaurants(results);
        setCurrentOffset(results.length);
        setHasMore(more);
        setUsingMockData(false);
      } else {
        setRestaurants([]);
        setHasMore(false);
        setUsingMockData(false);
      }
    } catch {
      console.log("Falling back to mock data");
      const filtered = mockRestaurants.filter((r) =>
        selectedCities.some((c) => r.city.toLowerCase().includes(c.split(",")[0].toLowerCase()))
      );
      filtered.sort((a, b) => new Date(b.openedDate).getTime() - new Date(a.openedDate).getTime());
      setRestaurants(filtered);
      setUsingMockData(true);
      setHasMore(false);
    }

    setLoading(false);
    setLastChecked(new Date().toISOString());
  }, [selectedCities, dietaryFilters, priceFilters, minRating, openedSince, fetchPage]);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || usingMockData) return;
    setLoadingMore(true);

    try {
      const { results, hasMore: more } = await fetchPage(currentOffset);
      if (results.length > 0) {
        setRestaurants((prev) => {
          const existingIds = new Set(prev.map((r) => r.id));
          const unique = results.filter((r) => !existingIds.has(r.id));
          return [...prev, ...unique];
        });
        setCurrentOffset((prev) => prev + results.length);
      }
      setHasMore(more && results.length > 0);
    } catch {
      setHasMore(false);
    }

    setLoadingMore(false);
  }, [loadingMore, hasMore, usingMockData, currentOffset, fetchPage]);

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

    try {
      const { results, hasMore: more } = await fetchPage(0);
      if (results.length > 0) {
        setRestaurants(results);
        setCurrentOffset(results.length);
        setHasMore(more);
        setUsingMockData(false);
      } else {
        setRestaurants([]);
        setHasMore(false);
      }
    } catch {
      const filtered = mockRestaurants.filter((r) =>
        selectedCities.some((c) => r.city.toLowerCase().includes(c.split(",")[0].toLowerCase()))
      );
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
    <div ref={containerRef} className="relative space-y-4 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
      <PullToRefreshIndicator
        pullDistance={pullDistance}
        refreshing={pullRefreshing}
        isPastThreshold={isPastThreshold}
      />

      {(loading || restaurants.length === 0) && (
        <div className="flex flex-col items-center gap-2 py-10 text-center animate-in fade-in duration-500">
          <h1 className="text-4xl font-bold tracking-tight text-primary">RibbonCut</h1>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            What just opened
          </p>
        </div>
      )}

      <button
        onClick={handleRefresh}
        disabled={refreshing}
        className="absolute right-2 top-2 z-10 rounded-full bg-background/80 p-2 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
        aria-label="Refresh feed"
      >
        <RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
      </button>

      {selectedCities.length === 0 && !loading && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-12 text-center">
          <MapPin className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">Select at least one location</p>
            <p className="text-xs text-muted-foreground">
              Go to Settings and pick your SE Michigan areas to see new restaurants ✨
            </p>
          </div>
        </div>
      )}

      {loading && selectedCities.length > 0 ? (
        <div className="space-y-4">
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
