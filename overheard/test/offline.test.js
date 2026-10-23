import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startTestServer, client } from './helpers.js';
import { importLines, parseLines } from '../server/osm.js';

// Sentetik hat (test verisi): T9, durak B (40.97, 29.25).
const LINE = 'istanbul-line-subway-t9';
const STOP_B = { lat: 40.97, lng: 29.25 };
const MIN = 60000;
let seq = 0;
const cid = () => `test-client-${Date.now().toString(36)}-${seq++}`;

describe('Çevrimdışı söz (metroda, tünelde)', () => {
  let srv;
  before(async () => {
    srv = await startTestServer({ antiSpoofing: true });
    const json = JSON.parse(await readFile(new URL('./fixtures/overpass-lines.json', import.meta.url), 'utf8'));
    importLines(srv.db, parseLines(json, { cityId: 'istanbul' }));
  });
  after(async () => { await srv.close(); });

  const newUser = async (prefix) => {
    const c = client(srv.base);
    await c.register(`${prefix}_${Math.random().toString(36).slice(2, 7)}`);
    return c;
  };

  test('hatta binmişken tünelde yazılan söz bağlantı gelince yazıldığı anla kaydedilir; ikinci gönderim tekrar etmez', async () => {
    const c = await newUser('tunel');
    await c.post('/api/checkins', { ...STOP_B, accuracy: 15 });
    const heardAt = Date.now() - 10 * MIN;
    const item = { clientId: cid(), text: 'Tünelde biri: "Sinyal yok ama dedikodu var."', placeId: LINE, heardAt, visibility: 'local' };
    const r = await c.post('/api/overheards/offline', item);
    assert.equal(r.status, 200);
    assert.equal(r.data.overheard.placeId, LINE);
    assert.equal(r.data.overheard.createdAt, heardAt);
    assert.equal(r.data.overheard.offline, true);
    assert.equal(r.data.overheard.pioneer, true);
    // Yanıt kaybolup cihaz yeniden gönderirse aynı söz döner.
    const again = await c.post('/api/overheards/offline', item);
    assert.equal(again.data.overheard.id, r.data.overheard.id);
    assert.equal(again.data.overheard.duplicate, true);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM overheards WHERE client_id = ?').get(item.clientId).n, 1);

    // Yerel hat sözü: hatta olmayan biri okuyamaz.
    const other = await newUser('disarida');
    assert.equal((await other.get(`/api/overheards/${r.data.overheard.id}`)).data.overheard.locked, true);
  });

  test('hiç bağlantı yokken binilse de cihazın o sıradaki konumu kanıt olur', async () => {
    const c = await newUser('cevrimdisi');
    const heardAt = Date.now() - 20 * MIN;
    const fix = [STOP_B.lat + 0.0003, STOP_B.lng, 20, heardAt - 5 * MIN];
    const r = await c.post('/api/overheards/offline', { clientId: cid(), text: 'Peronda biri: "Bu tren de mi dolu?"', placeId: LINE, heardAt, fix });
    assert.equal(r.status, 200);
    // Biniş, konumun alındığı ana check-in olarak işlenir ("aynı anda oradaydın" için).
    assert.ok(srv.db.prepare('SELECT 1 FROM checkins WHERE place_id = ? AND at = ?').get(LINE, fix[3]));
  });

  test('o sırada orada olunduğu kanıtlanamazsa reddedilir', async () => {
    const c = await newUser('kanitsiz');
    const heardAt = Date.now() - 5 * MIN;
    const base = { text: 'Kanıtsız söz deneme', placeId: LINE, heardAt };
    for (const fix of [undefined, [STOP_B.lat, STOP_B.lng, 900, heardAt - MIN], [41.2, 29.0, 10, heardAt - MIN], [STOP_B.lat, STOP_B.lng, 10, heardAt - 3 * 60 * MIN]]) {
      const r = await c.post('/api/overheards/offline', { ...base, clientId: cid(), fix });
      assert.equal(r.status, 403, JSON.stringify(fix));
      assert.equal(r.data.error, 'not_there_then');
    }
    // Hatta binmiş ama söz biniş penceresinin (2 saat) dışında.
    await c.post('/api/checkins', { ...STOP_B, accuracy: 15 });
    srv.db.prepare('UPDATE checkins SET at = at - ? WHERE place_id = ?').run(3 * 60 * MIN, LINE);
    assert.equal((await c.post('/api/overheards/offline', { ...base, clientId: cid() })).data.error, 'not_there_then');
  });

  test('çok eski, gelecekten ya da bozuk gönderimler reddedilir; denetim aynen uygulanır', async () => {
    const c = await newUser('bozuk');
    await c.post('/api/checkins', { ...STOP_B, accuracy: 15 });
    const ok = { text: 'Geçerli bir metin', placeId: LINE };
    assert.equal((await c.post('/api/overheards/offline', { ...ok, clientId: cid(), heardAt: Date.now() - 7 * 60 * MIN })).data.error, 'offline_too_old');
    assert.equal((await c.post('/api/overheards/offline', { ...ok, clientId: cid(), heardAt: Date.now() + 10 * MIN })).data.error, 'bad_heard_at');
    assert.equal((await c.post('/api/overheards/offline', { ...ok, clientId: 'kısa', heardAt: Date.now() })).data.error, 'bad_client_id');
    assert.equal((await c.post('/api/overheards/offline', { ...ok, clientId: cid(), heardAt: Date.now(), placeId: 'yok-boyle' })).data.error, 'place_not_found');
    assert.equal((await c.post('/api/overheards/offline', { ...ok, clientId: cid(), heardAt: Date.now(), text: 'bu bir ibne deneme' })).data.error, 'content_blocked');
    // Cihazda başka bir hesabın bekleyen sözü bu oturumla gönderilemez.
    assert.equal((await c.post('/api/overheards/offline', { ...ok, clientId: cid(), heardAt: Date.now(), author: 'baskasi' })).data.error, 'author_mismatch');
    const masked = await c.post('/api/overheards/offline', { ...ok, clientId: cid(), heardAt: Date.now(), text: 'Beni 0532 123 45 67 numaradan ara dedi' });
    assert.match(masked.data.overheard.text, /\[telefon\]/);
  });
});
