// Push-only service worker. No asset caching / offline shell.
// Live registration uses /push-sw.js with scope "/"; local uses /app/push-sw.js.

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "Island Training Club", body: "", url: "/#/notifications" };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    }
  } catch (_err) {
    try {
      const text = event.data?.text?.() || "";
      if (text) payload.body = text;
    } catch (_err2) {
      /* ignore */
    }
  }
  const title = String(payload.title || "Island Training Club");
  const rawUrl = String(payload.url || "/#/notifications");
  // Canonical live site redirects /app/ → /; keep hash routes on root.
  const url = rawUrl.startsWith("/app/")
    ? `/${rawUrl.slice("/app/".length)}`
    : rawUrl;
  const options = {
    body: String(payload.body || "New update from Island Training Club"),
    data: { url },
    tag: "itc-ops",
    renotify: true,
    icon: "/assets/itc/logo-favicon.png",
    badge: "/assets/itc/logo-favicon.png",
  };
  event.waitUntil(
    self.registration.showNotification(title, options).catch((err) => {
      console.error("[itc push-sw] showNotification failed", err);
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = String(event.notification?.data?.url || "/#/notifications");
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) {
          try { await client.navigate(target); } catch (_err) { /* ignore */ }
        }
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(target);
  })());
});
