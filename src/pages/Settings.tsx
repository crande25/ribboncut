import { useState } from "react";
import { Bell, Sun, Moon, Smartphone, Leaf, Calendar, MapPin, DollarSign, Star } from "lucide-react";
import { CityChecklist } from "@/components/CityChecklist";
import { InstallAppCard } from "@/components/InstallAppCard";
import { PushNotificationsCard } from "@/components/PushNotificationsCard";
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

const maxValues: Record<string, number> = { days: 365, weeks: 52, months: 12 };

const themeOptions = [
  { value: "system" as const, label: "Device Default", icon: Smartphone },
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "dark" as const, label: "Dark", icon: Moon },
];

const priceOptions = [
  { value: 1, label: "$" },
  { value: 2, label: "$$" },
  { value: 3, label: "$$$" },
  { value: 4, label: "$$$$" },
];

const ratingOptions = [
  { value: 2.0, label: "2.0+ ★" },
  { value: 2.5, label: "2.5+ ★" },
  { value: 3.5, label: "3.5+ ★" },
  { value: 4.0, label: "4.0+ ★" },
  { value: 4.5, label: "4.5+ ★" },
];

const scheduleOptions = [
  { value: "daily", label: "Daily" },
  { value: "3days", label: "Every 3 Days" },
  { value: "weekly", label: "Weekly" },
];

export default function Settings() {
  const [selectedCities, setSelectedCities] = useLocalStorage<string[]>("selected_cities", []);
  const [dietaryFilters, setDietaryFilters] = useLocalStorage<string[]>("dietary_filters", []);
  const [priceFilters, setPriceFilters] = useLocalStorage<number[]>("price_filters", []);
  const [ratingThresholds, setRatingThresholds] = useLocalStorage<number[]>("rating_thresholds", []);
  const [, setMinRating] = useLocalStorage<number>("min_rating", 0);
  const [openedWithinValue, setOpenedWithinValue] = useLocalStorage<number>("opened_within_value", 1);
  const [openedWithinUnit, setOpenedWithinUnit] = useLocalStorage<string>("opened_within_unit", "months");
  const [schedule, setSchedule] = useLocalStorage<string>("notification_schedule", "");
  const [rawInput, setRawInput] = useState<string>(String(openedWithinValue));
  const deviceId = useDeviceId();
  const { theme, setTheme } = useTheme();

  const hasAnyFilter =
    selectedCities.length > 0 ||
    priceFilters.length > 0 ||
    ratingThresholds.length > 0 ||
    dietaryFilters.length > 0;

  const clearAllFilters = () => {
    setSelectedCities([]);
    setPriceFilters([]);
    setRatingThresholds([]);
    setMinRating(0);
    setDietaryFilters([]);
  };

  const currentMax = maxValues[openedWithinUnit] || 12;
  const parsedRaw = parseInt(rawInput);
  const validationError = isNaN(parsedRaw) || parsedRaw > currentMax
    ? `Max is ${currentMax} ${openedWithinUnit}`
    : null;

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-bold tracking-tight text-primary">RibbonCut</h1>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Settings</p>
        </div>
        {hasAnyFilter && (
          <button
            onClick={clearAllFilters}
            className="rounded-full px-4 py-2 text-xs font-medium transition-all no-select bg-destructive/15 text-destructive hover:bg-destructive/25"
          >
            Clear Filters
          </button>
        )}
      </div>

      <InstallAppCard />

      <PushNotificationsCard />

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Your Locations</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Select the SE Michigan areas you want to track.
        </p>
        <CityChecklist selectedCities={selectedCities} onCitiesChange={setSelectedCities} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Price Range</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Pick the price tiers you're into. No selection = all prices.
        </p>
        <div className="flex flex-wrap gap-2">
          {priceOptions.map((opt) => {
            const isSelected = priceFilters.includes(opt.value);
            return (
              <button
                key={opt.value}
                onClick={() =>
                  setPriceFilters((prev) =>
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
          <Star className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Minimum Rating</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Pick one threshold, or none for no rating filter.
        </p>
        <div className="flex flex-wrap gap-2">
          {ratingOptions.map((opt) => {
            const isSelected = ratingThresholds.includes(opt.value);
            return (
              <button
                key={opt.value}
                onClick={() => {
                  const next = isSelected ? [] : [opt.value];
                  setRatingThresholds(next);
                  setMinRating(next.length > 0 ? next[0] : 0);
                }}
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
          Only show places first spotted in the last…
        </p>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={currentMax}
              value={rawInput}
              onChange={(e) => {
                setRawInput(e.target.value);
                const v = parseInt(e.target.value);
                if (!isNaN(v) && v >= 1 && v <= currentMax) {
                  setOpenedWithinValue(v);
                }
              }}
              onBlur={() => {
                const v = Math.max(1, Math.min(currentMax, parsedRaw || 1));
                setOpenedWithinValue(v);
                setRawInput(String(v));
              }}
              className={cn(
                "w-16 rounded-lg border bg-secondary px-3 py-2 text-xs text-foreground text-center focus:outline-none focus:ring-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                validationError ? "border-destructive focus:ring-destructive" : "border-border focus:ring-primary"
              )}
            />
            <div className="flex gap-2">
              {openedWithinUnits.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setOpenedWithinUnit(opt.value);
                    const max = maxValues[opt.value] || 12;
                    if (openedWithinValue > max) {
                      setOpenedWithinValue(max);
                      setRawInput(String(max));
                    }
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
          {validationError && (
            <p className="text-xs text-destructive">{validationError}</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Notification Frequency</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Pick a cadence, or none to turn notifications off.
        </p>
        <div className="flex gap-2">
          {scheduleOptions.map((opt) => {
            const isSelected = schedule === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setSchedule(isSelected ? "" : opt.value)}
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
