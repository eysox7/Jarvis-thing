import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startTestServer, client } from './helpers.js';
import { MIGRATIONS, openDb } from '../server/db.js';

// Galata Kulesi (yarıçap 140 m) ve kuzeyindeki noktalar.
const GALATA = { lat: 41.0256, lng: 28.9741 };
const north = (m) => ({ lat: GALATA.lat + m / 111195, lng: GALATA.lng });

describe('Mekânda tutunma (kapalı alanda zayıf GPS)', () => {
  let srv;
  let overheardId;
  before(async () => {
    srv = await startTestServer({ antiSpoofing: true });
    const author = client(srv.base);
    await author.register('tutunma_yazar');
    await author.post('/api/checkins', { ...GALATA, accuracy: 10 });
    overheardId = (await author.post('/api/overheards', { text: 'Rehber "kuleye merdivenle çıkan kalmadı" dedi', ...GALATA, accuracy: 10, placeId: 'ist-galata' })).data.overheard.id;
  });
  after(async () => { await srv.close(); });

  const newUser = async (prefix) => {
    const c = client(srv.base);
    const handle = `${prefix}_${Math.random().toString(36).slice(2, 7)}`;
    await c.register(handle);
    return { c, id: srv.db.prepare('SELECT id FROM users WHERE handle = ?').get(handle).id };
  };
  const locked = async (c) => (await c.get(`/api/overheards/${overheardId}`)).data.overheard.locked;

  test('iyi bir konumla giren, içeride konum oynayıp belirsizleşse de orada kalır', async () => {
    const { c } = await newUser('kafe');
    const enter = await c.post('/api/checkins', { ...GALATA, accuracy: 15 });
    assert.equal(enter.data.places[0].id, 'ist-galata');
    assert.equal(await locked(c), false);

    // İçeride: konum 250 m kaydı (doğruluk 120 m) ve sonra iyice belirsizleşti (800 m).
    const drift = await c.post('/api/checkins', { ...north(250), accuracy: 120 });
    assert.deepEqual(drift.data.left, []);
    assert.equal(drift.data.places.find((p) => p.id === 'ist-galata')?.held, true);
    const coarse = await c.post('/api/checkins', { ...north(500), accuracy: 800 });
    assert.equal(coarse.data.blocked, undefined);
    assert.deepEqual(coarse.data.left, []);
    assert.equal(await locked(c), false);
    // Oradakiler arasında sayılır ve mekân odasına girer.
    const map = await c.get('/api/cities/istanbul/map');
    assert.ok(map.data.places.find((p) => p.id === 'ist-galata').peopleHere >= 1);
    assert.equal((await c.get('/api/places/ist-galata/room')).status, 200);
  });

  test('açıkça dışarıda gösteren konum çıkarır; belirsiz konumla geri girilemez', async () => {
    const { c } = await newUser('cikan');
    await c.post('/api/checkins', { ...GALATA, accuracy: 15 });
    const out = await c.post('/api/checkins', { ...north(600), accuracy: 20 });
    assert.deepEqual(out.data.left, ['ist-galata']);
    assert.equal(await locked(c), true);
    const back = await c.post('/api/checkins', { ...north(300), accuracy: 800 });
    assert.equal(back.data.blocked, 'low_accuracy');
    assert.equal(await locked(c), true);
  });

  test('mekân dairesinin hemen dışı tolere edilir, biraz ötesi edilmez', async () => {
    const { c } = await newUser('sinir');
    await c.post('/api/checkins', { ...GALATA, accuracy: 10 });
    assert.deepEqual((await c.post('/api/checkins', { ...north(200), accuracy: 10 })).data.left, []);
    assert.deepEqual((await c.post('/api/checkins', { ...north(320), accuracy: 10 })).data.left, ['ist-galata']);
  });

  test('ilk konumu belirsiz olan giremez (tutunma yalnızca girişten sonra)', async () => {
    const { c } = await newUser('belirsiz');
    const r = await c.post('/api/checkins', { ...north(100), accuracy: 800 });
    assert.equal(r.data.blocked, 'low_accuracy');
    assert.equal(await locked(c), true);
  });

  test('tutunma süresi dolunca yeniden iyi bir konum gerekir', async () => {
    const { c, id } = await newUser('uzun');
    await c.post('/api/checkins', { ...GALATA, accuracy: 15 });
    srv.db.prepare('UPDATE presence_anchors SET at = at - ? WHERE user_id = ?').run(srv.config.stickyPresenceMs + 1000, id);
    const r = await c.post('/api/checkins', { ...north(250), accuracy: 400 });
    assert.equal(r.data.blocked, 'low_accuracy');
    // Son iyi konum hâlâ taze ve mekânın içinde: o konumla hâlâ oradasın; yeni iyi konum çapayı tazeler.
    const fresh = await c.post('/api/checkins', { ...GALATA, accuracy: 15 });
    assert.equal(fresh.data.places[0].id, 'ist-galata');
    assert.deepEqual((await c.post('/api/checkins', { ...north(250), accuracy: 400 })).data.left, []);
  });

  test('içeride belirsiz konumla söz bırakılabilir', async () => {
    const { c } = await newUser('icerde');
    await c.post('/api/checkins', { ...GALATA, accuracy: 15 });
    const r = await c.post('/api/overheards', { text: 'Garson "kule manzarası ekstra ücretli" dedi', ...north(300), accuracy: 700 });
    assert.equal(r.status, 200);
    assert.equal(r.data.overheard.placeId, 'ist-galata');
  });
});

describe('Veritabanı göçü (v11)', () => {
  test('QR kayıtları mekânda tutunma çapalarına taşınır', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overheard-'));
    const path = join(dir, 'v10.db');
    try {
      const old = new DatabaseSync(path);
      for (let v = 0; v < 10; v++) old.exec(MIGRATIONS[v]);
      old.exec('PRAGMA user_version = 10');
      const now = Date.now();
      old.prepare("INSERT INTO users (id, handle, pass_hash, created_at) VALUES (1, 'a', 'x', ?)").run(now);
      old.prepare("INSERT INTO places (id, city_id, name, lat, lng, radius_m, created_at) VALUES ('p', 'istanbul', 'P', 41, 29, 100, ?)").run(now);
      old.prepare("INSERT INTO qr_presence (user_id, place_id, at) VALUES (1, 'p', ?)").run(now);
      old.close();

      const db = openDb(path);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
      assert.deepEqual({ ...db.prepare('SELECT user_id, place_id, source, at FROM presence_anchors').get() }, { user_id: 1, place_id: 'p', source: 'qr', at: now });
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'qr_presence'").get().n, 0);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
