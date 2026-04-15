import { Bell, Sun, Moon, Monitor, Leaf, Calendar } from "lucide-react";
import { CitySearch } from "@/components/CitySearch";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useDeviceId } from "@/hooks/useDeviceId";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const dietaryOptions = [
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarian" },
  { value: "gluten_free", label: "Gluten Free" },
  { value: "halal", label: "Halal" },
  { value: "kosher", label: "Kosher" },
];

const openedWithinUnits = [
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" },
];

const maxValues: Record<string, number> = { days: 90, weeks: 12, months: 12 };

const themeOptions = [
  { value: "system" as const, label: "Device", icon: Monitor },
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "dark" as const, label: "Dark", icon: Moon },
];

const scheduleOptions = [
  { value: "daily", label: "Daily" },
  { value: "3days", label: "Every 3 Days" },
  { value: "weekly", label: "Weekly" },
];

export default function Settings() {
  const [selectedCities, setSelectedCities] = useLocalStorage<string[]>("selected_cities", []);
  const [dietaryFilters, setDietaryFilters] = useLocalStorage<string[]>("dietary_filters", []);
  const [openedWithinValue, setOpenedWithinValue] = useLocalStorage<number>("opened_within_value", 1);
  const [openedWithinUnit, setOpenedWithinUnit] = useLocalStorage<string>("opened_within_unit", "months");
  const [schedule, setSchedule] = useLocalStorage<string>("notification_schedule", "daily");
  const deviceId = useDeviceId();
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-foreground">Settings ⚙️</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Pick your locations and we'll do the rest.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Your Locations</h2>
        <p className="text-xs text-muted-foreground">
          Where do you wanna eat? Add your spots here.
        </p>
        <CitySearch selectedCities={selectedCities} onCitiesChange={setSelectedCities} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Leaf className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Dietary Requirements</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Filter results to match your dietary needs.
        </p>
        <div className="flex flex-wrap gap-2">
          {dietaryOptions.map((opt) => {
            const isSelected = dietaryFilters.includes(opt.value);
            return (
              <button
                key={opt.value}
                onClick={() =>
                  setDietaryFilters((prev) =>
                    isSelected
                      ? prev.filter((v) => v !== opt.value)
                      : [...prev, opt.value]
                  )
                }
                className={cn(
                  "rounded-full px-4 py-2 text-xs font-medium transition-all no-select",
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Opened Within</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Only show places that opened in the last…
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={maxValues[openedWithinUnit] || 12}
            value={openedWithinValue}
            onChange={(e) => {
              const max = maxValues[openedWithinUnit] || 12;
              const v = Math.max(1, Math.min(max, parseInt(e.target.value) || 1));
              setOpenedWithinValue(v);
            }}
            className="w-16 rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-foreground text-center focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="flex gap-2">
            {openedWithinUnits.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setOpenedWithinUnit(opt.value);
                  const max = maxValues[opt.value] || 12;
                  if (openedWithinValue > max) setOpenedWithinValue(max);
                }}
                className={cn(
                  "rounded-full px-4 py-2 text-xs font-medium transition-all no-select",
                  openedWithinUnit === opt.value
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </section>
          <h2 className="text-sm font-semibold text-foreground">Notification Frequency</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          How often should we ping you? (Coming soon!)
        </p>
        <div className="flex gap-2">
          {scheduleOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSchedule(opt.value)}
              className={cn(
                "rounded-full px-4 py-2 text-xs font-medium transition-all no-select",
                schedule === opt.value
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Sun className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Appearance</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Choose your vibe — light, dark, or match your device.
        </p>
        <div className="flex gap-2">
          {themeOptions.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition-all no-select",
                  theme === opt.value
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {opt.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-secondary/50 p-4">
        <p className="text-xs text-muted-foreground">
          Device ID: <span className="font-mono text-foreground/70">{deviceId.slice(0, 8)}...</span>
        </p>
      </section>
    </div>
  );
}
