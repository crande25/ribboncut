import { RefreshCw } from "lucide-react";

interface Props {
  pullDistance: number;
  refreshing: boolean;
  isPastThreshold: boolean;
}

export function PullToRefreshIndicator({ pullDistance, refreshing, isPastThreshold }: Props) {
  if (pullDistance === 0 && !refreshing) return null;

  const rotation = Math.min(pullDistance * 3, 360);
  const opacity = Math.min(pullDistance / 60, 1);
  const scale = Math.min(0.5 + pullDistance / 120, 1);

  return (
    <div
      className="flex items-center justify-center overflow-hidden transition-[height] duration-200 ease-out"
      style={{ height: pullDistance }}
    >
      <div
        className="flex items-center justify-center rounded-full bg-secondary p-2"
        style={{
          opacity,
          transform: `scale(${scale}) rotate(${refreshing ? 0 : rotation}deg)`,
        }}
      >
        <RefreshCw
          className={`h-5 w-5 text-muted-foreground ${refreshing ? "animate-spin" : ""}`}
        />
      </div>
      {isPastThreshold && !refreshing && (
        <span className="ml-2 text-xs text-muted-foreground">Release to refresh</span>
      )}
    </div>
  );
}
