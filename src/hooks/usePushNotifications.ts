import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDeviceId } from "./useDeviceId";
import { useLocalStorage } from "./useLocalStorage";

// VAPID public key — safe to expose in frontend code (it's the public half).
const VAPID_PUBLIC_KEY =
  "BO0icws-msoHbjoicnegKbLsebOAgW_D4pLrfb6ZbpxDqSS7E9fH907F79-uMZ2rWx6Zq7KCRyhxaz-OGUXq_VM";

const PUSH_SW_URL = "/sw-push.js";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

function detectIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

interface UsePushReturn {
  /** Browser supports push at all (and on iOS, app is installed to home screen). */
  supported: boolean;
  /** True if iOS Safari without home-screen install — explain how to install. */
  needsIOSInstall: boolean;
  /** Current Notification permission state. */
  permission: NotificationPermission | "unsupported";
  /** True if currently subscribed to push. */
  subscribed: boolean;
  /** Toggle on. Returns true on success. */
  enable: () => Promise<boolean>;
  /** Toggle off. */
  disable: () => Promise<void>;
  /** Send a test notification to this device. */
  sendTest: () => Promise<{ ok: boolean; error?: string }>;
  /** Status / error message for UI. */
  message: string | null;
  /** Loading flag for any in-progress action. */
  busy: boolean;
}

export function usePushNotifications(cities: string[], frequency: string): UsePushReturn {
  const deviceId = useDeviceId();
  const [persistedEnabled, setPersistedEnabled] = useLocalStorage<boolean>("push_enabled", false);
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ios = typeof navigator !== "undefined" && detectIOS();
  const standalone = typeof window !== "undefined" && isStandalone();
  const hasPushApi =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined";
  // iOS only allows push from installed PWAs.
  const supported = hasPushApi && (!ios || standalone);
  const needsIOSInstall = ios && !standalone;

  const lastSyncRef = useRef<string>("");

  // Check current subscription state on mount and whenever supported flips.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration(PUSH_SW_URL);
        if (!reg) {
          if (!cancelled) setSubscribed(false);
          return;
        }
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setSubscribed(!!sub && persistedEnabled);
      } catch (e) {
        console.warn("[push] subscription check failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [supported, persistedEnabled]);

  // When cities/frequency change while subscribed, push the update server-side.
  useEffect(() => {
    if (!subscribed || !deviceId) return;
    const sig = JSON.stringify({ cities, frequency });
    if (sig === lastSyncRef.current) return;
    lastSyncRef.current = sig;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration(PUSH_SW_URL);
        const sub = await reg?.pushManager.getSubscription();
        if (!sub) return;
        const json = sub.toJSON();
        await supabase.functions.invoke("subscribe-push", {
          body: {
            device_id: deviceId,
            subscription: { endpoint: json.endpoint, keys: json.keys },
            cities,
            frequency,
          },
        });
      } catch (e) {
        console.warn("[push] resync failed:", e);
      }
    })();
  }, [cities, frequency, subscribed, deviceId]);

  const enable = useCallback(async (): Promise<boolean> => {
    if (!supported || !deviceId) return false;
    setBusy(true);
    setMessage(null);
    try {
      // 1. Register the push SW (separate from vite-plugin-pwa's auto SW)
      const reg = await navigator.serviceWorker.register(PUSH_SW_URL);
      await navigator.serviceWorker.ready;

      // 2. Request permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setMessage(
          perm === "denied"
            ? "Notifications were blocked. Enable them in your browser settings to turn this on."
            : "Permission was not granted.",
        );
        return false;
      }

      // 3. Subscribe to push
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      const json = sub.toJSON();

      // 4. Save to backend
      const { error } = await supabase.functions.invoke("subscribe-push", {
        body: {
          device_id: deviceId,
          subscription: { endpoint: json.endpoint, keys: json.keys },
          cities,
          frequency,
        },
      });
      if (error) throw error;

      setSubscribed(true);
      setPersistedEnabled(true);
      setMessage(null);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[push] enable failed:", msg);
      setMessage(`Couldn't enable notifications: ${msg}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported, deviceId, cities, frequency, setPersistedEnabled]);

  const disable = useCallback(async () => {
    if (!deviceId) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration(PUSH_SW_URL);
      const sub = await reg?.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      await supabase.functions.invoke("unsubscribe-push", { body: { device_id: deviceId } });
      setSubscribed(false);
      setPersistedEnabled(false);
      setMessage(null);
    } catch (e) {
      console.error("[push] disable failed:", e);
    } finally {
      setBusy(false);
    }
  }, [deviceId, setPersistedEnabled]);

  const sendTest = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!deviceId) return { ok: false, error: "No device id" };
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("test-push", {
        body: { device_id: deviceId },
      });
      if (error) {
        const msg = error.message || "Test failed";
        setMessage(msg);
        return { ok: false, error: msg };
      }
      if (data && (data as any).error) {
        setMessage((data as any).error);
        return { ok: false, error: (data as any).error };
      }
      setMessage("Test notification sent! Check your device.");
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessage(msg);
      return { ok: false, error: msg };
    } finally {
      setBusy(false);
    }
  }, [deviceId]);

  return {
    supported,
    needsIOSInstall,
    permission,
    subscribed,
    enable,
    disable,
    sendTest,
    message,
    busy,
  };
}
