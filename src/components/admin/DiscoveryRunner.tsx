import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SE_MICHIGAN_CITIES } from "@/lib/seMichiganCities";

export function DiscoveryRunner() {
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  const toggle = (city: string) => {
    setSelectedCities((prev) =>
      prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city]
    );
  };

  const run = async () => {
    setRunning(true);
    setError("");
    setResult(null);
    const cities = selectedCities.length > 0 ? selectedCities.join("|") : undefined;
    const { data, error: err } = await supabase.functions.invoke("discover-new-restaurants", {
      body: cities ? { cities } : undefined,
    });
    if (err) setError(err.message);
    else setResult(data);
    setRunning(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Fire Discovery</h2>
        <button onClick={run} disabled={running} className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
          {running ? "Running…" : "Run Now"}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {SE_MICHIGAN_CITIES.map((city) => (
          <button
            key={city}
            onClick={() => toggle(city)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              selectedCities.includes(city)
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground"
            }`}
          >
            {city.replace(", MI", "")}
          </button>
        ))}
      </div>
      {!selectedCities.length && <p className="text-xs text-muted-foreground">No cities selected → all cities will be scanned.</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && (
        <pre className="max-h-80 overflow-auto rounded bg-muted p-3 text-xs text-foreground">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
