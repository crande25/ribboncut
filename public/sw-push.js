// Custom push handler — registered separately from the vite-plugin-pwa SW.
// Lives at /sw-push.js so registration is explicit and doesn't conflict with
// the auto-managed precache SW.

self.addEventListener("push", (event) => {
  let data = { title: "PlatePing", body: "Something new is happening." };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {
    // payload wasn't JSON — fall through to defaults
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body,
    icon: "/pwa-icon-192.png",
    badge: "/pwa-icon-192.png",
    tag: data.tag || "plateping",
    data: { url: data.url || "/" },
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    }),
  );
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Minimal pass-through fetch handler.
// Required for Chrome to consider the site installable and fire `beforeinstallprompt`.
// We intentionally do NOT cache anything — always go to network.
self.addEventListener("fetch", (event) => {
  // Let the browser handle the request normally.
  return;
});
