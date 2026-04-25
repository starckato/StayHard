// QROK Service Worker
// Build: 20260426-tab-cache-bust
const CACHE_NAME = 'qrok-v2';
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
// fetch 핸들러 없음 — no-op 핸들러는 navigation 블로킹 유발
