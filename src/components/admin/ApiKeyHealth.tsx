import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface KeyResult {
  key_name: string;
  present: boolean;
  status: number | null;
  verdict: string;
  ratelimit_remaining?: string;
  ratelimit_daily_limit?: string;
  body_snippet?: string;
}

export function ApiKeyHealth() {
  const [results, setResults] = useState<KeyResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    setLoading(true);
    setError("");
    const { data, error: err } = await supabase.functions.invoke("yelp-key-sanity-check");
    if (err) setError(err.message);
    else setResults(data?.results ?? []);
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">API Key Health</h2>
        <button onClick={run} disabled={loading} className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
          {loading ? "Checking…" : "Run Check"}
        </button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {results && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4">Key</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Verdict</th>
                <th className="py-2 pr-4">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.key_name} className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs">{r.key_name}</td>
                  <td className="py-2 pr-4">{r.status ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <span className={r.verdict === "healthy" ? "text-green-500" : "text-destructive"}>
                      {r.verdict}
                    </span>
                  </td>
                  <td className="py-2 pr-4">{r.ratelimit_remaining ?? "—"} / {r.ratelimit_daily_limit ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
