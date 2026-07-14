// Holston Workspace push service worker.
// Receives Web Push events even when no tab is open and shows a notification.
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Holston", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "Holston", {
      body: data.body || "",
      icon: data.icon || "/favicon.ico",
      badge: data.badge || "/favicon.ico",
      tag: data.tag,
      data: data.data || {},
      requireInteraction: data.requireInteraction || false,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
