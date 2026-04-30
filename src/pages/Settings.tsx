import { useState } from "react";
import { Leaf, MapPin, DollarSign, Star } from "lucide-react";
import { CityChecklist } from "@/components/CityChecklist";
import { InstallAppCard } from "@/components/InstallAppCard";
import { PushNotificationsCard } from "@/components/PushNotificationsCard";
import { ContactUsDialog } from "@/components/ContactUsDialog";
import {
  SettingsSection,
  ChipMultiSelect,
  ChipSingleSelect,
} from "@/components/settings/SettingsPrimitives";
import { ThemeSelector } from "@/components/settings/ThemeSelector";
import { OpenedWithinControl } from "@/components/settings/OpenedWithinControl";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useDeviceId } from "@/hooks/useDeviceId";

const dietaryOptions = [
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarian" },
  { value: "gluten_free", label: "Gluten Free" },
  { value: "halal", label: "Halal" },
  { value: "kosher", label: "Kosher" },
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

export default function Settings() {
  const [selectedCities, setSelectedCities] = useLocalStorage<string[]>("selected_cities", []);
  const [dietaryFilters, setDietaryFilters] = useLocalStorage<string[]>("dietary_filters", []);
  const [priceFilters, setPriceFilters] = useLocalStorage<number[]>("price_filters", []);
  const [ratingThresholds, setRatingThresholds] = useLocalStorage<number[]>("rating_thresholds", []);
  const [, setMinRating] = useLocalStorage<number>("min_rating", 0);
  const [openedWithinValue, setOpenedWithinValue] = useLocalStorage<number>("opened_within_value", 1);
  const [openedWithinUnit, setOpenedWithinUnit] = useLocalStorage<string>("opened_within_unit", "months");

  const [contactOpen, setContactOpen] = useState(false);
  const deviceId = useDeviceId();

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

  const togglePrice = (v: number) =>
    setPriceFilters((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  const toggleDietary = (v: string) =>
    setDietaryFilters((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  const setRating = (v: number | null) => {
    const next = v === null ? [] : [v];
    setRatingThresholds(next);
    setMinRating(next.length > 0 ? next[0] : 0);
  };

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

      <SettingsSection
        icon={MapPin}
        title="Your Locations"
        description="Select the SE Michigan areas you want to track."
      >
        <CityChecklist selectedCities={selectedCities} onCitiesChange={setSelectedCities} />
      </SettingsSection>

      <SettingsSection
        icon={DollarSign}
        title="Price Range"
        description="Pick the price tiers you're into. No selection = all prices."
      >
        <ChipMultiSelect options={priceOptions} selected={priceFilters} onToggle={togglePrice} />
      </SettingsSection>

      <SettingsSection
        icon={Star}
        title="Minimum Rating"
        description="Pick one threshold, or none for no rating filter."
      >
        <ChipSingleSelect
          options={ratingOptions}
          selected={ratingThresholds[0] ?? null}
          onChange={setRating}
        />
      </SettingsSection>

      <SettingsSection
        icon={Leaf}
        title="Dietary Requirements"
        description="Filter results to match your dietary needs."
      >
        <ChipMultiSelect options={dietaryOptions} selected={dietaryFilters} onToggle={toggleDietary} />
      </SettingsSection>

      <OpenedWithinControl
        value={openedWithinValue}
        unit={openedWithinUnit}
        onValueChange={setOpenedWithinValue}
        onUnitChange={setOpenedWithinUnit}
      />

      <PushNotificationsCard />

      <ThemeSelector />

      <div className="pt-2 text-center">
        <button
          onClick={() => setContactOpen(true)}
          className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Contact us
        </button>
      </div>

      <section className="rounded-lg border border-border bg-secondary/50 p-4">
        <p className="text-xs text-muted-foreground">
          Device ID: <span className="font-mono text-foreground/70">{deviceId.slice(0, 8)}...</span>
        </p>
      </section>

      <ContactUsDialog open={contactOpen} onOpenChange={setContactOpen} />
    </div>
  );
}
