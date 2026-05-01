import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface DayStat {
  day: string;
  count: number;
}

export function RestaurantStats() {
  const [stats, setStats] = useState<DayStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Get counts grouped by day for the last 30 days
      const since = new Date();
      since.setDate(since.getDate() - 30);

      const { data, error } = await supabase
        .from("restaurant_sightings")
        .select("first_seen_at")
        .gte("first_seen_at", since.toISOString())
        .order("first_seen_at", { ascending: false });

      if (!error && data) {
        const byDay: Record<string, number> = {};
        data.forEach((r) => {
          const day = r.first_seen_at.slice(0, 10);
          byDay[day] = (byDay[day] || 0) + 1;
        });
        setStats(
          Object.entries(byDay)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([day, count]) => ({ day, count }))
        );
      }
      setLoading(false);
    })();
  }, []);

  const total = stats.reduce((s, d) => s + d.count, 0);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Restaurant Stats (Last 30 Days)</h2>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Total new sightings: <span className="font-semibold text-foreground">{total}</span></p>
          <div className="space-y-1">
            {stats.map((s) => (
              <div key={s.day} className="flex items-center gap-3 text-sm">
                <span className="w-24 font-mono text-muted-foreground">{s.day}</span>
                <div className="h-4 rounded bg-primary/20" style={{ width: `${Math.max(4, (s.count / Math.max(...stats.map(x => x.count))) * 200)}px` }}>
                  <div className="h-full rounded bg-primary" style={{ width: "100%" }} />
                </div>
                <span className="text-foreground font-semibold">{s.count}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
