import { useState, useRef, useEffect } from "react";
import { Search, X, MapPin, LocateFixed } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface CitySearchProps {
  selectedCities: string[];
  onCitiesChange: (locations: string[]) => void;
}

export function CitySearch({ selectedCities, onCitiesChange }: CitySearchProps) {
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [locating, setLocating] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [deviceCoords, setDeviceCoords] = useState<{ lat: number; lon: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Get device coords once for biasing results
  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => setDeviceCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 5000 }
    );
  }, []);

  // Fetch suggestions from Nominatim as user types
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: trimmed,
          format: "json",
          addressdetails: "1",
          limit: "6",
          featuretype: "city",
        });
        if (deviceCoords) {
          params.set("viewbox", `${deviceCoords.lon - 2},${deviceCoords.lat + 2},${deviceCoords.lon + 2},${deviceCoords.lat - 2}`);
          params.set("bounded", "0");
        }
        const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
          headers: { "Accept-Language": "en" },
        });
        const data = await res.json();
        const labels: string[] = [];
        for (const item of data) {
          const addr = item.address || {};
          const place = addr.city || addr.town || addr.village || addr.hamlet || "";
          const state = addr.state || "";
          const label = [place, state].filter(Boolean).join(", ");
          if (label && !labels.includes(label) && !selectedCities.includes(label)) {
            labels.push(label);
          }
        }
        setSuggestions(labels);
      } catch {
        setSuggestions([]);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, deviceCoords, selectedCities]);

  const addCity = (city: string) => {
    const trimmed = city.trim();
    if (trimmed && !selectedCities.includes(trimmed)) {
      onCitiesChange([...selectedCities, trimmed]);
    }
    setQuery("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const removeCity = (city: string) => {
    onCitiesChange(selectedCities.filter((c) => c !== city));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && query.trim()) {
      e.preventDefault();
      addCity(query);
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          onKeyDown={handleKeyDown}
          placeholder="Search any location..."
          className="pl-9 pr-10 bg-secondary border-border"
        />
        <button
          type="button"
          onClick={handleLocate}
          disabled={locating}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
          aria-label="Use current location"
        >
          <LocateFixed className={cn("h-4 w-4", locating && "animate-pulse")} />
        </button>
        {showSuggestions && filtered.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
            {filtered.map((city) => (
              <button
                key={city}
                onMouseDown={() => addCity(city)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
              >
                <MapPin className="h-3.5 w-3.5 text-primary" />
                {city}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Search and tap to add a location.
      </p>

      {selectedCities.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedCities.map((city) => (
            <span
              key={city}
              className={cn(
                "inline-flex items-center gap-1 rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary no-select"
              )}
            >
              <MapPin className="h-3 w-3" />
              {city}
              <button
                onClick={() => removeCity(city)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-primary/20 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
