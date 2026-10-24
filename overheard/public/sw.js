// Uygulama kabuğunu önbelleğe alır; API ve harita karoları her zaman ağdan gelir.
const CACHE = 'overheard-shell-v18';
const SHELL = [
  '/',
  '/css/app.css',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js',
  '/js/main.js',
  '/js/api.js',
  '/js/google.js',
  '/js/i18n.js',
  '/js/map.js',
  '/js/maps/common.js',
  '/js/maps/leaflet.js',
  '/js/maps/google.js',
  '/js/ui.js',
  '/js/util.js',
  '/js/share.js',
  '/js/store.js',
  '/js/offline.js',
  '/js/p2p.js',
  '/js/qr.js',
  '/vendor/jsqr/jsQR.js',
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
  '/js/views/venue.js',
  '/js/views/outbox.js',
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

// Arka planda eşitleme: sayfa kapalıyken de bağlantı gelince bekleyen çevrimdışı sözler gönderilir
// (destekleyen tarayıcılarda). Sözler sayfanın kullandığı IndexedDB kuyruğundan (store.js) okunur.
function openStore() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('overheard', 1);
    req.onupgradeneeded = () => {
      for (const name of ['outbox', 'received', 'keys']) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request(db, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', mode);
    const req = action(tx.objectStore('outbox'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

async function flushOutbox() {
  const db = await openStore();
  const items = await request(db, 'readonly', (s) => s.getAll());
  for (const item of items) {
    const relay = item.kind === 'relay';
    const body = relay ? item.payload : {
      clientId: item.clientId, author: item.author, text: item.text, placeId: item.placeId, visibility: item.visibility,
      anonymous: item.anonymous, ephemeral: item.ephemeral, heardAt: item.heardAt, fix: item.fix,
    };
    const res = await fetch(relay ? '/api/overheards/relay' : '/api/overheards/offline', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    // Yalnızca kabul edilenler silinir; reddedilenleri sayfa açılınca kullanıcıya nedeniyle gösterir.
    if (res.ok) await request(db, 'readwrite', (s) => s.delete(item.id));
    else if (res.status >= 500 || res.status === 429) throw new Error('retry');
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'outbox') event.waitUntil(flushOutbox());
});
