// Rhenium One service worker.
// Its only job is to make the app installable on phones. It caches nothing,
// so every deploy is picked up immediately. (Offline data entry is handled by
// Firestore's own offline cache, not here.)
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
