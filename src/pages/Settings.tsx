import { Bell } from "lucide-react";
import { CitySearch } from "@/components/CitySearch";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useDeviceId } from "@/hooks/useDeviceId";
import { cn } from "@/lib/utils";

const scheduleOptions = [
  { value: "daily", label: "Daily" },
  { value: "3days", label: "Every 3 Days" },
  { value: "weekly", label: "Weekly" },
];

export default function Settings() {
  const [selectedCities, setSelectedCities] = useLocalStorage<string[]>("selected_cities", []);
  const [schedule, setSchedule] = useLocalStorage<string>("notification_schedule", "daily");
  const deviceId = useDeviceId();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-foreground">Settings</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Customize your restaurant discovery feed.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Cities & Towns</h2>
        <p className="text-xs text-muted-foreground">
          Add any city or town to track new restaurant openings.
        </p>
        <CitySearch selectedCities={selectedCities} onCitiesChange={setSelectedCities} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Notification Frequency</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          How often should we check for new openings? (Notifications coming soon)
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

      <section className="rounded-lg border border-border bg-secondary/50 p-4">
        <p className="text-xs text-muted-foreground">
          Device ID: <span className="font-mono text-foreground/70">{deviceId.slice(0, 8)}...</span>
        </p>
      </section>
    </div>
  );
}
