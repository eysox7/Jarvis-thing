// Çevrimdışı kabuk. Uygulama dosyalarını önbelleğe alır; API çağrılarına dokunmaz.
const CACHE = 'nexus-v1.0.0';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/agent.js',
  './js/providers.js',
  './js/tools.js',
  './js/store.js',
  './js/ui.js',
  './js/util.js',
  './js/speech.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Sadece kendi kaynaklarımızı yönet; API istekleri doğrudan ağa gitsin.
  if (url.origin !== location.origin) return;

  // Ağ öncelikli, başarısızsa önbellek (güncel kalır ama çevrimdışı da açılır).
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./');
    }),
  );
});
