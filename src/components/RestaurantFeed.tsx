import { RefreshCw, MapPin } from "lucide-react";
import { RestaurantCard } from "./RestaurantCard";
import { Skeleton } from "@/components/ui/skeleton";
import { PullToRefreshIndicator } from "./PullToRefreshIndicator";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useRestaurantFeed, useInfiniteScrollSentinel } from "@/hooks/useRestaurantFeed";

export function RestaurantFeed() {
  const {
    selectedCities,
    restaurants,
    loading,
    loadingMore,
    refreshing,
    hasMore,
    loadMore,
    refresh,
  } = useRestaurantFeed();

  const sentinelRef = useInfiniteScrollSentinel(loadMore);

  const { containerRef, pullDistance, refreshing: pullRefreshing, isPastThreshold } =
    usePullToRefresh({ onRefresh: refresh });

  return (
    <div
      ref={containerRef}
      className="relative space-y-4 overflow-y-auto"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <PullToRefreshIndicator
        pullDistance={pullDistance}
        refreshing={pullRefreshing}
        isPastThreshold={isPastThreshold}
      />

      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-primary">RibbonCut</h1>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          What just opened
        </p>
      </div>

      <button
        onClick={refresh}
        disabled={refreshing}
        className="absolute right-2 top-2 z-10 rounded-full bg-background/80 p-2 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
        aria-label="Refresh feed"
      >
        <RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
      </button>

      {selectedCities.length === 0 && !loading && <EmptyCitiesPrompt />}

      {loading && selectedCities.length > 0 ? (
        <FeedSkeleton />
      ) : (
        <>
          {selectedCities.length > 0 && restaurants.length === 0 && <NothingNewYet />}

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

function EmptyCitiesPrompt() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-12 text-center">
      <MapPin className="h-10 w-10 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium text-foreground">Select at least one location</p>
        <p className="text-xs text-muted-foreground">
          Go to Settings and pick your SE Michigan areas to see new restaurants ✨
        </p>
      </div>
    </div>
  );
}

function NothingNewYet() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-12 text-center">
      <p className="text-sm font-medium text-foreground">Nothing new yet!</p>
      <p className="text-xs text-muted-foreground">
        Check back soon — new spots pop up all the time 🤞
      </p>
    </div>
  );
}

function FeedSkeleton() {
  return (
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
  );
}
