import { useEffect, useMemo, useRef } from "react";
import { Bell, Send, Share, Plus, MoreVertical } from "lucide-react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { cn } from "@/lib/utils";

function detectAndroidNonChromium(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isAndroid = /Android/i.test(ua);
  if (!isAndroid) return false;
  // Chromium-based browsers that DO support beforeinstallprompt on Android.
  // Edge, Opera, Brave, Samsung Internet all include their token + "Chrome/..".
  // Firefox and a few others don't fire the event — give those users manual steps.
  const isFirefox = /Firefox|FxiOS/i.test(ua);
  const isOpera = /OPR\//i.test(ua);
  const isEdge = /EdgA\//i.test(ua);
  const isSamsung = /SamsungBrowser/i.test(ua);
  const isChrome = /Chrome\//i.test(ua) && !isEdge && !isOpera && !isSamsung;
  // Hint shows for anything that isn't Chrome/Edge/Opera/Samsung — primarily Firefox.
  return isFirefox || (!isChrome && !isEdge && !isOpera && !isSamsung);
}

const scheduleOptions = [
  { value: "daily", label: "Daily" },
  { value: "3days", label: "Every 3 Days" },
  { value: "weekly", label: "Weekly" },
];

export function NotificationsCard() {
  const [cities] = useLocalStorage<string[]>("selected_cities", []);
  const [frequency, setFrequency] = useLocalStorage<string>("notification_schedule", "");

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
  const lastFrequencyRef = useRef<string>(frequency);

  // Auto-enable push when the user selects a frequency, auto-disable when they clear it.
  useEffect(() => {
    if (!supported || busy) return;
    const prev = lastFrequencyRef.current;
    lastFrequencyRef.current = frequency;

    if (hasFrequency && !subscribed) {
      enable();
    } else if (!hasFrequency && subscribed) {
      disable();
    }
    // Also handle the case where the user changed frequency value while already subscribed —
    // the hook's resync effect handles backend updates, no action needed here.
    void prev;
  }, [frequency, hasFrequency, subscribed, supported, busy, enable, disable]);

  const handleSelect = (value: string) => {
    setFrequency(frequency === value ? "" : value);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
      </div>

      {needsIOSInstall ? (
        <div className="rounded-lg border border-border bg-secondary/50 p-4 space-y-3 text-xs text-muted-foreground">
          <p className="text-foreground font-medium">Install RibbonCut first 📲</p>
          <p>
            On iPhone & iPad, push notifications only work after you add RibbonCut
            to your home screen.
          </p>
          <ol className="space-y-1.5 list-decimal list-inside">
            <li className="flex flex-wrap items-center gap-1.5">
              <span>Tap the Share button</span>
              <Share className="h-3.5 w-3.5 inline text-primary" />
              <span>in your browser</span>
            </li>
            <li className="flex flex-wrap items-center gap-1.5">
              <span>Choose</span>
              <span className="text-foreground font-medium">Add to Home Screen</span>
              <Plus className="h-3.5 w-3.5 inline text-primary" />
            </li>
            <li>
              Tap <span className="text-foreground font-medium">Add</span>, then open
              RibbonCut from your home screen and come back here.
            </li>
          </ol>
        </div>
      ) : !supported ? (
        <p className="text-xs text-muted-foreground">
          Your browser doesn't support push notifications.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Pick a cadence to get pinged when new restaurants open in your saved locations.
            Select again to turn notifications off.
          </p>

          <div className="flex flex-wrap gap-2">
            {scheduleOptions.map((opt) => {
              const isSelected = frequency === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => handleSelect(opt.value)}
                  disabled={busy}
                  className={cn(
                    "rounded-full px-4 py-2 text-xs font-medium transition-all no-select disabled:opacity-50",
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

          {busy && (
            <p className="text-xs text-muted-foreground">
              {hasFrequency ? "Enabling notifications…" : "Turning off notifications…"}
            </p>
          )}

          {hasFrequency && subscribed && cities.length === 0 && (
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

// Backward-compatible alias so existing imports keep working.
export const PushNotificationsCard = NotificationsCard;
