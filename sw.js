// Stay Hard — Service Worker
// Build: 20260331-1400
← changes every deploy so browser detects update
const CACHE_NAME = 'stayhard-20260331-034553';

// ── INSTALL: skip waiting immediately so new SW takes over fast ──
self.addEventListener('install', event => {
  self.skipWaiting();
});

// ── ACTIVATE: claim all clients and delete ALL old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => {
        // Tell all open tabs to reload so they get the new version
        self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => client.postMessage({ type: 'NEW_VERSION' }));
        });
      })
  );
});

// ── FETCH: network-first for everything (always fresh) ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Pass through Supabase & external API calls
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('jsdelivr.net')) {
    return; // let browser handle normally
  }

  // Network-first for all navigation (HTML pages)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .catch(() => caches.match('/') || caches.match('/index.html'))
    );
    return;
  }
});
