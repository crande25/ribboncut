import { useState, useCallback, useRef, useEffect } from "react";

// Custom event fired whenever any instance of useLocalStorage updates a key.
// The native `storage` event only fires across tabs, not within the same document,
// so we need this to keep multiple hook instances in the same tab in sync.
const LOCAL_STORAGE_EVENT = "local-storage-sync";

type SyncDetail = { key: string; value: unknown };

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const valueRef = useRef(storedValue);
  valueRef.current = storedValue;

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      const valueToStore = value instanceof Function ? value(valueRef.current) : value;
      setStoredValue(valueToStore);
      try {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      } catch {
        // ignore quota / serialization errors
      }
      // Notify other hook instances in the same document.
      window.dispatchEvent(
        new CustomEvent<SyncDetail>(LOCAL_STORAGE_EVENT, {
          detail: { key, value: valueToStore },
        })
      );
    },
    [key]
  );

  // Listen for updates from other instances (same tab) and from other tabs.
  useEffect(() => {
    const handleCustom = (e: Event) => {
      const detail = (e as CustomEvent<SyncDetail>).detail;
      if (!detail || detail.key !== key) return;
      setStoredValue(detail.value as T);
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      try {
        setStoredValue(e.newValue ? (JSON.parse(e.newValue) as T) : initialValue);
      } catch {
        // ignore parse errors
      }
    };
    window.addEventListener(LOCAL_STORAGE_EVENT, handleCustom);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(LOCAL_STORAGE_EVENT, handleCustom);
      window.removeEventListener("storage", handleStorage);
    };
    // initialValue intentionally omitted — only key identity matters for subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [storedValue, setValue] as const;
}
