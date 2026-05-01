import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface KeyStatus {
  key_name: string;
  last_status: number | null;
  last_error: string | null;
  exhausted_at: string | null;
  reset_at: string | null;
  updated_at: string;
}

export function ErrorLog() {
  const [statuses, setStatuses] = useState<KeyStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("api_key_status")
        .select("key_name, last_status, last_error, exhausted_at, reset_at, updated_at")
        .order("updated_at", { ascending: false });
      setStatuses(data ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">API Key Errors</h2>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : statuses.length === 0 ? (
        <p className="text-sm text-muted-foreground">No key status records found.</p>
      ) : (
        <div className="space-y-3">
          {statuses.map((s) => (
            <div key={s.key_name} className="rounded border border-border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-foreground">{s.key_name}</span>
                <span className={s.exhausted_at ? "text-destructive" : "text-green-500"}>
                  {s.exhausted_at ? "Exhausted" : "OK"}
                </span>
              </div>
              {s.last_error && (
                <p className="mt-1 text-xs text-muted-foreground break-all">{s.last_error.slice(0, 300)}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Status: {s.last_status ?? "—"} · Updated: {new Date(s.updated_at).toLocaleString()}
                {s.reset_at && ` · Resets: ${new Date(s.reset_at).toLocaleString()}`}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
