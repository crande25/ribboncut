import { useState, useCallback, useEffect, useRef } from "react";
import { RefreshCw, MapPin } from "lucide-react";
import { RestaurantCard } from "./RestaurantCard";
import { Skeleton } from "@/components/ui/skeleton";
import { mockRestaurants, type Restaurant } from "@/lib/mockData";
import { discoverRestaurants } from "@/lib/api";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { toast } from "@/hooks/use-toast";

const PAGE_SIZE = 20;

export function RestaurantFeed() {
  const [selectedCities] = useLocalStorage<string[]>("selected_cities", []);
  const [lastChecked, setLastChecked] = useLocalStorage<string>("last_checked", "");
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [usingMockData, setUsingMockData] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchFromApi = useCallback(async (cities: string[], since?: string) => {
    const allResults: Restaurant[] = [];

    for (const city of cities) {
      try {
        const response = await discoverRestaurants(city, 0, 50, since || undefined);
        const mapped: Restaurant[] = response.restaurants.map((r) => ({
          id: r.id,
          name: r.name,
          city: r.city,
          imageUrl: r.imageUrl || r.photos?.[0] || "",
          foodSummary: `${r.cuisine} • ${r.rating ? `${r.rating}★` : ""} ${r.reviewCount ? `(${r.reviewCount} reviews)` : ""}`.trim(),
          atmosphereSummary: r.address || "",
          openedDate: new Date().toISOString(), // Yelp doesn't provide opened date
          cuisine: r.cuisine,
          priceRange: r.priceRange,
          rating: r.rating,
          reviewCount: r.reviewCount,
          address: r.address,
          phone: r.phone,
          url: r.url,
          photos: r.photos,
        }));
        allResults.push(...mapped);
      } catch (err) {
        console.error(`Failed to fetch restaurants for ${city}:`, err);
      }
    }

    return allResults;
  }, []);

  const fetchRestaurants = useCallback(async () => {
    setLoading(true);

    if (selectedCities.length === 0) {
      setRestaurants([]);
      setLoading(false);
      return;
    }

    try {
      const results = await fetchFromApi(selectedCities, lastChecked || undefined);
      if (results.length > 0) {
        results.sort((a, b) => new Date(b.openedDate).getTime() - new Date(a.openedDate).getTime());
        setRestaurants(results);
        setUsingMockData(false);
      } else {
        throw new Error("No results from API");
      }
    } catch {
      // Fallback to mock data
      console.log("Falling back to mock data");
      let filtered = mockRestaurants;
      if (selectedCities.length > 0) {
        filtered = filtered.filter((r) => selectedCities.includes(r.city));
      }
      filtered.sort((a, b) => new Date(b.openedDate).getTime() - new Date(a.openedDate).getTime());
      setRestaurants(filtered);
      setUsingMockData(true);
    }

    setDisplayCount(PAGE_SIZE);
    setLoading(false);
    setLastChecked(new Date().toISOString());
  }, [selectedCities, lastChecked, setLastChecked, fetchFromApi]);

  useEffect(() => {
    fetchRestaurants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCities]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setLastChecked("");

    if (selectedCities.length === 0) {
      setRestaurants([]);
      setRefreshing(false);
      return;
    }

    try {
      const results = await fetchFromApi(selectedCities);
      if (results.length > 0) {
        results.sort((a, b) => new Date(b.openedDate).getTime() - new Date(a.openedDate).getTime());
        setRestaurants(results);
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
      toast({
        title: "Using demo data",
        description: "Could not reach the discovery API. Showing sample restaurants.",
      });
    }

    setDisplayCount(PAGE_SIZE);
    setRefreshing(false);
    setLastChecked(new Date().toISOString());
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
