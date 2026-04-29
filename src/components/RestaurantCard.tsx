import { UtensilsCrossed, Sparkles, Clock, Star, ExternalLink } from "lucide-react";
import type { Restaurant } from "@/lib/mockData";

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "First spotted today";
  if (days === 1) return "First spotted yesterday";
  return `First spotted ${days} days ago`;
}

export function RestaurantCard({ restaurant }: { restaurant: Restaurant }) {
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card animate-fade-in">
      <div className="relative h-48 overflow-hidden">
        <img
          src={restaurant.imageUrl}
          alt={restaurant.name}
          className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-card/90 to-transparent" />
        <div className="absolute bottom-3 left-4 right-4">
          <h2 className="text-lg font-bold text-foreground">{restaurant.name}</h2>
          <p className="text-xs text-muted-foreground">{restaurant.city}</p>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground/70">Price</span>
            {restaurant.priceRange}
          </span>
          {restaurant.rating && (
            <span className="flex items-center gap-0.5">
              <Star className="h-3 w-3 text-food" />
              {restaurant.rating}
              {restaurant.reviewCount && (
                <span className="text-muted-foreground">({restaurant.reviewCount})</span>
              )}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {timeAgo(restaurant.openedDate)}
          </span>
        </div>

        <div className="rounded-md bg-food/10 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-food">
            <UtensilsCrossed className="h-3.5 w-3.5" />
            Offers
          </div>
          <p className="text-sm text-secondary-foreground">{restaurant.foodSummary}</p>
        </div>

        <div className="rounded-md bg-atmosphere/10 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-atmosphere">
            <Sparkles className="h-3.5 w-3.5" />
            Vibe
          </div>
          <p className="text-sm text-secondary-foreground">{restaurant.atmosphereSummary}</p>
        </div>

        {restaurant.url && (
          <a
            href={restaurant.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            View on Yelp
          </a>
        )}
      </div>
    </article>
  );
}
