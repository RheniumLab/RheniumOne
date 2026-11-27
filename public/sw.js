// Rhenium One service worker.
// 1. Makes the app installable on phones (caches nothing, so every deploy shows immediately;
//    offline data entry is handled by Firestore's own offline cache).
// 2. Shows push notifications (Firebase Cloud Messaging, data messages) and opens
//    the right page when one is tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;background:#18212b;color:#e9edf0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center"><div><h2 style="color:#ff6a00">You are offline</h2><p>Reconnect and try again. Entries you already made will sync.</p></div>',
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
    ),
  );
});

self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { data: { title: "Rhenium One", body: event.data ? event.data.text() : "" } };
  }
  const d = msg.data || msg.notification || {};
  const title = d.title || "Rhenium One";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || "",
      icon: "/brand/icon-192.png",
      badge: "/brand/icon-192.png",
      tag: d.type ? `${d.type}-${d.link || ""}` : undefined,
      data: { link: d.link || "/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/notifications";
  const url = new URL(link, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin) && "focus" in w) {
          w.navigate(url).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
