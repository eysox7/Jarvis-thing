// Cihazda kalıcı küçük depo (IndexedDB). Çevrimdışı yazılan sözler (outbox), kulaktan kulağa gelenler
// (received) ve cihaz imza anahtarı (keys) burada durur. IndexedDB yoksa (bazı gizli pencereler)
// sayfa açık kaldıkça bellekte tutulur. Hizmet çalışanı (sw.js) aynı veritabanını okur.
const DB_NAME = 'overheard';
const VERSION = 1;
export const STORES = ['outbox', 'received', 'keys'];

let opening = null;
const memory = new Map(STORES.map((name) => [name, new Map()]));

function open() {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        for (const name of STORES) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

async function run(name, mode, action) {
  const db = await open();
  if (!db) return action(null);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const req = action(tx.objectStore(name));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const store = {
  async all(name) {
    const result = await run(name, 'readonly', (s) => (s ? s.getAll() : null));
    return result ?? [...memory.get(name).values()];
  },
  async get(name, id) {
    const result = await run(name, 'readonly', (s) => (s ? s.get(id) : null));
    return result ?? memory.get(name).get(id) ?? null;
  },
  async put(name, value) {
    memory.get(name).set(value.id, value);
    await run(name, 'readwrite', (s) => s?.put(value));
  },
  async del(name, id) {
    memory.get(name).delete(id);
    await run(name, 'readwrite', (s) => s?.delete(id));
  },
  async clear(name) {
    memory.get(name).clear();
    await run(name, 'readwrite', (s) => s?.clear());
  },
};
