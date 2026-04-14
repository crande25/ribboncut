import { useState, useCallback, useEffect, useRef } from "react";
import { RefreshCw, MapPin } from "lucide-react";
import { RestaurantCard } from "./RestaurantCard";
import { Skeleton } from "@/components/ui/skeleton";
import { mockRestaurants, type Restaurant } from "@/lib/mockData";
import { useLocalStorage } from "@/hooks/useLocalStorage";

const PAGE_SIZE = 5;

export function RestaurantFeed() {
  const [selectedCities] = useLocalStorage<string[]>("selected_cities", []);
  const [lastChecked, setLastChecked] = useLocalStorage<string>("last_checked", "");
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchRestaurants = useCallback(() => {
    setLoading(true);
    // Simulate API call with mock data
    setTimeout(() => {
      let filtered = mockRestaurants;
      if (selectedCities.length > 0) {
        filtered = filtered.filter((r) => selectedCities.includes(r.city));
      }
      if (lastChecked) {
        const since = new Date(lastChecked).getTime();
        filtered = filtered.filter((r) => new Date(r.openedDate).getTime() >= since);
      }
      filtered.sort((a, b) => new Date(b.openedDate).getTime() - new Date(a.openedDate).getTime());
      setRestaurants(filtered);
      setDisplayCount(PAGE_SIZE);
      setLoading(false);
      setLastChecked(new Date().toISOString());
    }, 800);
  }, [selectedCities, lastChecked, setLastChecked]);

  useEffect(() => {
    fetchRestaurants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCities]);

  const handleRefresh = () => {
    setRefreshing(true);
    // Reset lastChecked to show all again on refresh
    setLastChecked("");
    setTimeout(() => {
      let filtered = mockRestaurants;
      if (selectedCities.length > 0) {
        filtered = filtered.filter((r) => selectedCities.includes(r.city));
      }
      filtered.sort((a, b) => new Date(b.openedDate).getTime() - new Date(a.openedDate).getTime());
      setRestaurants(filtered);
      setDisplayCount(PAGE_SIZE);
      setRefreshing(false);
      setLastChecked(new Date().toISOString());
    }, 600);
  };

  // Infinite scroll observer
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && displayCount < restaurants.length) {
          setDisplayCount((c) => Math.min(c + PAGE_SIZE, restaurants.length));
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [displayCount, restaurants.length]);

  const visible = restaurants.slice(0, displayCount);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">New Openings</h1>
          {lastChecked && (
            <p className="text-xs text-muted-foreground">
              Updated {new Date(lastChecked).toLocaleString()}
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
            <p className="text-sm font-medium text-foreground">No cities selected</p>
            <p className="text-xs text-muted-foreground">
              Head to Settings and add cities to discover new restaurants.
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
              <p className="text-sm font-medium text-foreground">No new openings</p>
              <p className="text-xs text-muted-foreground">Check back soon!</p>
            </div>
          )}

          <div className="space-y-4">
            {visible.map((r) => (
              <RestaurantCard key={r.id} restaurant={r} />
            ))}
          </div>

          {displayCount < restaurants.length && (
            <div ref={sentinelRef} className="pull-indicator">
              Loading more...
            </div>
          )}

          {displayCount >= restaurants.length && restaurants.length > 0 && (
            <p className="text-center text-xs text-muted-foreground py-4">
              {restaurants.length} restaurant{restaurants.length !== 1 ? "s" : ""} found
            </p>
          )}
        </>
      )}
    </div>
  );
}
