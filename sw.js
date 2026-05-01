// QROK Service Worker
// Build: 20260502-trainer-push
const CACHE_NAME = 'qrok-v4-trainer-push';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c => c.postMessage({ type: 'NEW_VERSION', cache: CACHE_NAME })))
  );
});

// Notification click — 앱 열린 탭 포커스, 없으면 새 창
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of allClients) {
      if (c.url.includes(self.location.host)) {
        try { await c.focus(); return; } catch (_) {}
      }
    }
    if (self.clients.openWindow) {
      try { await self.clients.openWindow('/'); } catch (_) {}
    }
  })());
});
// fetch 핸들러 없음 — no-op 핸들러는 navigation 블로킹 유발
