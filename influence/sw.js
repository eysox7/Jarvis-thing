// Çevrimdışı kabuk. Model dosyalarını WebLLM kendisi önbelleğe alır; onlara dokunmayız.
const CACHE = 'influence-v0.1.0';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './icons/icon.svg',
  './js/app.js', './js/arena.js', './js/clone.js', './js/consent.js', './js/decide.js', './js/dilemmas.js',
  './js/ingest.js', './js/llm.js', './js/llm-worker.js', './js/share.js', './js/store.js', './js/ui.js', './js/util.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('influence-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req)
    .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); return res; })
    .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))));
});
