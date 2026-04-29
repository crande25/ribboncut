import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Guard: never register service workers in iframes or Lovable preview
const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com");

if (isPreviewHost || isInIframe) {
  navigator.serviceWorker?.getRegistrations().then((registrations) => {
    registrations.forEach((r) => r.unregister());
  });
} else if ("serviceWorker" in navigator) {
  // Production only: register the SW so Chrome treats the app as installable
  // and fires `beforeinstallprompt`. The SW has a no-op fetch handler — no caching.
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw-push.js")
      .catch((err) => console.warn("SW registration failed:", err));
  });
}

createRoot(document.getElementById("root")!).render(<App />);
