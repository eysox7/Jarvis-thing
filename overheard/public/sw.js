// Uygulama kabuğunu önbelleğe alır; API ve harita karoları her zaman ağdan gelir.
const CACHE = 'overheard-shell-v10';
const SHELL = [
  '/',
  '/css/app.css',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js',
  '/js/main.js',
  '/js/api.js',
  '/js/i18n.js',
  '/js/map.js',
  '/js/maps/common.js',
  '/js/maps/leaflet.js',
  '/js/maps/google.js',
  '/js/ui.js',
  '/js/util.js',
  '/js/share.js',
  '/js/views/admin.js',
  '/js/views/auth.js',
  '/js/views/best.js',
  '/js/views/bubble.js',
  '/js/views/compose.js',
  '/js/views/inbox.js',
  '/js/views/intro.js',
  '/js/views/nudge.js',
  '/js/views/places.js',
  '/js/views/profile.js',
  '/js/views/room.js',
  '/icons/icon.svg',
  '/manifest.webmanifest',
  '/privacy.html',
  '/terms.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Önce ağ, olmazsa önbellek: güncellemeler hemen görünür, çevrimdışıyken kabuk yine açılır.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/'))),
  );
});
