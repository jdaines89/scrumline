// Scrumline's service worker: shows push notifications and opens the right
// screen when one is tapped. It caches nothing, so every visit gets the
// latest app straight from the site.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const scope = self.registration.scope;
  event.waitUntil(self.registration.showNotification(data.title || "Scrumline", {
    body: data.body || "",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    icon: scope + "icons/icon-192.png",
    badge: scope + "icons/badge-96.png",
    data: { url: data.url || scope },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of open) {
      if (client.url.startsWith(self.registration.scope) && "navigate" in client) {
        await client.focus();
        return client.navigate(url);
      }
    }
    return self.clients.openWindow(url);
  })());
});
