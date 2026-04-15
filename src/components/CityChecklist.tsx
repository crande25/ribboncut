import { MapPin, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { SE_MICHIGAN_CITIES } from "@/lib/seMichiganCities";

interface CityChecklistProps {
  selectedCities: string[];
  onCitiesChange: (cities: string[]) => void;
}

export function CityChecklist({ selectedCities, onCitiesChange }: CityChecklistProps) {
  const toggleCity = (city: string) => {
    if (selectedCities.includes(city)) {
      onCitiesChange(selectedCities.filter((c) => c !== city));
    } else {
      onCitiesChange([...selectedCities, city]);
    }
  };

  const allSelected = selectedCities.length === SE_MICHIGAN_CITIES.length;

  const toggleAll = () => {
    if (allSelected) {
      onCitiesChange([]);
    } else {
      onCitiesChange([...SE_MICHIGAN_CITIES]);
    }
  };

  return (
    <div className="space-y-3">
      <button
        onClick={toggleAll}
        className={cn(
          "rounded-full px-4 py-2 text-xs font-medium transition-all no-select",
          allSelected
            ? "bg-primary text-primary-foreground shadow-md"
            : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
        )}
      >
        {allSelected ? "Deselect All" : "Select All"}
      </button>

      <div className="grid grid-cols-2 gap-2">
        {SE_MICHIGAN_CITIES.map((city) => {
          const isSelected = selectedCities.includes(city);
          return (
            <button
              key={city}
              onClick={() => toggleCity(city)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition-all no-select text-left",
                isSelected
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-transparent"
              )}
            >
              <div
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                  isSelected
                    ? "bg-primary border-primary"
                    : "border-muted-foreground/40"
                )}
              >
                {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
              </div>
              <MapPin className="h-3 w-3 shrink-0" />
              {city}
            </button>
          );
        })}
      </div>
    </div>
  );
}
