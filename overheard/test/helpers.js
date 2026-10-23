import { createServer } from 'node:http';
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seedDemoContent, seedPlaces } from '../server/seed.js';

// Bellek içi veritabanıyla gerçek bir HTTP sunucusu ayağa kaldırır.
export async function startTestServer({ demo = false, ai = null, ...overrides } = {}) {
  const config = loadConfig({ dbPath: ':memory:', demoMode: demo, rateLimitScale: 100, antiSpoofing: false, ...overrides });
  const db = openDb(':memory:');
  seedPlaces(db);
  if (demo) await seedDemoContent(db);
  const app = createApp({ db, config, ai });
  const server = createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    db,
    config,
    events: app.events,
    tickVenues: app.tickVenues,
    async close() {
      app.close();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}

// Çerezleri hatırlayan küçük bir istemci; her kullanıcı için bir tane.
export function client(base) {
  let cookie = '';
  async function request(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie();
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
  return {
    get: (p) => request('GET', p),
    post: (p, b = {}) => request('POST', p, b),
    del: (p) => request('DELETE', p),
    async register(handle, password = 'gizli-parola-123') {
      const r = await request('POST', '/api/auth/register', { handle, password, acceptTerms: true });
      if (r.status !== 200) throw new Error(`register failed: ${JSON.stringify(r.data)}`);
      return r;
    },
  };
}

// Testlerde sık kullanılan konumlar.
export const SPOTS = {
  kadikoyIskele: { lat: 40.9925, lng: 29.0236 },
  modaSahil: { lat: 40.981, lng: 29.027 },
  // Kadıköy iskelesinden ~100 m uzak, hâlâ yarıçap içinde.
  kadikoyIskeleEdge: { lat: 40.9934, lng: 29.0236 },
  // Hiçbir mekânın içinde değil ama İstanbul pilot bölgesinde.
  istanbulNowhere: { lat: 41.06, lng: 28.92 },
  // Pilot bölgelerin dışında.
  berlin: { lat: 52.52, lng: 13.405 },
  austin6th: { lat: 30.2672, lng: -97.739 },
};
