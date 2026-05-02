import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface KeyResult {
  key_name: string;
  present: boolean;
  status: number | null;
  verdict: string;
  remaining_uses?: number | null;
  monthly_quota?: number;
  body_snippet?: string;
}

interface DbKeyStatus {
  key_name: string;
  remaining_uses: number | null;
  exhausted_at: string | null;
  reset_at: string | null;
  last_status: number | null;
  updated_at: string;
}

export function ApiKeyHealth() {
  const [results, setResults] = useState<KeyResult[] | null>(null);
  const [dbStatuses, setDbStatuses] = useState<DbKeyStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load persisted status on mount
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("api_key_status")
        .select("key_name, remaining_uses, exhausted_at, reset_at, last_status, updated_at")
        .eq("provider", "yelp")
        .order("key_name");
      setDbStatuses((data as DbKeyStatus[]) ?? []);
    })();
  }, []);

  const run = async () => {
    setLoading(true);
    setError("");
    const { data, error: err } = await supabase.functions.invoke("yelp-key-sanity-check");
    if (err) {
      setError(err.message);
    } else {
      setResults(data?.results ?? []);
      // Refresh DB statuses after check
      const { data: fresh } = await supabase
        .from("api_key_status")
        .select("key_name, remaining_uses, exhausted_at, reset_at, last_status, updated_at")
        .eq("provider", "yelp")
        .order("key_name");
      setDbStatuses((fresh as DbKeyStatus[]) ?? []);
    }
    setLoading(false);
  };

  const displayData = results ?? dbStatuses.map((s) => ({
    key_name: s.key_name,
    present: true,
    status: s.last_status,
    verdict: s.exhausted_at ? "exhausted" : "healthy",
    remaining_uses: s.remaining_uses,
    monthly_quota: 3000,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">API Key Health</h2>
        <button onClick={run} disabled={loading} className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
          {loading ? "Checking…" : "Run Check"}
        </button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {displayData.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4">Key</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Verdict</th>
                <th className="py-2 pr-4">Monthly Remaining</th>
              </tr>
            </thead>
            <tbody>
              {displayData.map((r) => (
                <tr key={r.key_name} className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs">{r.key_name}</td>
                  <td className="py-2 pr-4">{r.status ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <span className={r.verdict === "healthy" ? "text-green-500" : "text-destructive"}>
                      {r.verdict}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    {r.remaining_uses != null ? (
                      <span className={r.remaining_uses <= 100 ? "text-destructive font-semibold" : r.remaining_uses <= 500 ? "text-yellow-500" : ""}>
                        {r.remaining_uses.toLocaleString()} / {(r.monthly_quota ?? 3000).toLocaleString()}
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
