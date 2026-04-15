import { useState, useRef } from "react";
import { Search, X, MapPin, LocateFixed } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Common US cities for autocomplete suggestions — user can type anything
const citySuggestions = [
  "New York, NY", "Los Angeles, CA", "Chicago, IL", "Houston, TX",
  "Phoenix, AZ", "Philadelphia, PA", "San Antonio, TX", "San Diego, CA",
  "Dallas, TX", "San Francisco, CA", "Austin, TX", "Seattle, WA",
  "Denver, CO", "Boston, MA", "Miami, FL", "Portland, OR",
  "Atlanta, GA", "Nashville, TN", "Minneapolis, MN", "Detroit, MI",
  "New Orleans, LA", "Charlotte, NC", "San Jose, CA", "Columbus, OH",
  "Indianapolis, IN", "Jacksonville, FL", "Memphis, TN", "Baltimore, MD",
  "Milwaukee, WI", "Albuquerque, NM", "Tucson, AZ", "Sacramento, CA",
  "Kansas City, MO", "Las Vegas, NV", "Oklahoma City, OK", "Raleigh, NC",
  "Louisville, KY", "Richmond, VA", "Salt Lake City, UT", "Pittsburgh, PA",
];

interface CitySearchProps {
  selectedCities: string[];
  onCitiesChange: (locations: string[]) => void;
}

export function CitySearch({ selectedCities, onCitiesChange }: CitySearchProps) {
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [locating, setLocating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleLocate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`,
            { headers: { "Accept-Language": "en" } }
          );
          const data = await res.json();
          const addr = data.address || {};
          const place = addr.city || addr.town || addr.village || addr.hamlet || "";
          const state = addr.state || "";
          const label = [place, state].filter(Boolean).join(", ");
          if (label) {
            setQuery(label);
            setShowSuggestions(false);
            inputRef.current?.focus();
          }
        } catch {
          // silently fail
        }
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const filtered = query.trim()
    ? citySuggestions.filter(
        (c) =>
          c.toLowerCase().includes(query.toLowerCase()) &&
          !selectedCities.includes(c)
      )
    : [];

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
