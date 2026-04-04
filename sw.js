// Stay Hard Service Worker
const CACHE_NAME = 'stayhard-v4';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
// fetch 핸들러 없음 — no-op 핸들러는 navigation 블로킹 유발
