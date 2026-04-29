import { useEffect } from "react";
import { Bell, BellOff, Send } from "lucide-react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { cn } from "@/lib/utils";

export function PushNotificationsCard() {
  const [cities] = useLocalStorage<string[]>("selected_cities", []);
  const [frequency] = useLocalStorage<string>("notification_schedule", "");

  const {
    supported,
    needsIOSInstall,
    permission,
    subscribed,
    enable,
    disable,
    sendTest,
    message,
    busy,
  } = usePushNotifications(cities, frequency);

  const hasFrequency = frequency.length > 0;

  // Auto-disable when the user clears their frequency.
  useEffect(() => {
    if (subscribed && !hasFrequency && !busy) {
      disable();
    }
  }, [subscribed, hasFrequency, busy, disable]);

  const handleToggle = async () => {
    if (subscribed) await disable();
    else await enable();
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {subscribed ? (
          <Bell className="h-4 w-4 text-primary" />
        ) : (
          <BellOff className="h-4 w-4 text-primary" />
        )}
        <h2 className="text-sm font-semibold text-foreground">Push Notifications</h2>
      </div>

      {needsIOSInstall ? (
        <div className="rounded-lg border border-border bg-secondary/50 p-4 space-y-2 text-xs text-muted-foreground">
          <p className="text-foreground font-medium">Install PlatePing first 📲</p>
          <p>
            On iPhone & iPad, push notifications only work after you add PlatePing
            to your home screen. Use the <span className="text-foreground font-medium">Install App</span>{" "}
            section above, then come back here.
          </p>
        </div>
      ) : !supported ? (
        <p className="text-xs text-muted-foreground">
          Your browser doesn't support push notifications.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Get pinged when new restaurants open in your saved cities — on the cadence
            you set in <span className="text-foreground font-medium">Notification Frequency</span> below.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleToggle}
              disabled={busy || (!subscribed && !hasFrequency)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition-all no-select disabled:opacity-50",
                subscribed
                  ? "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  : "bg-primary text-primary-foreground shadow-md hover:bg-primary/90",
              )}
            >
              {subscribed ? (
                <>
                  <BellOff className="h-3.5 w-3.5" />
                  {busy ? "Turning off…" : "Turn off notifications"}
                </>
              ) : (
                <>
                  <Bell className="h-3.5 w-3.5" />
                  {busy ? "Enabling…" : "Enable notifications"}
                </>
              )}
            </button>

            {subscribed && (
              <button
                onClick={sendTest}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-all no-select disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                Send test
              </button>
            )}
          </div>

          {!subscribed && !hasFrequency && (
            <p className="text-xs text-muted-foreground">
              Pick a Notification Frequency below to enable push.
            </p>
          )}

          {subscribed && cities.length === 0 && (
            <p className="text-xs text-destructive">
              You haven't selected any cities yet — pick at least one below to get notified.
            </p>
          )}

          {permission === "denied" && (
            <p className="text-xs text-muted-foreground">
              Notifications are blocked in your browser settings. Unblock them and try again.
            </p>
          )}

          {message && (
            <p className="text-xs text-muted-foreground">{message}</p>
          )}
        </>
      )}
    </section>
  );
}
