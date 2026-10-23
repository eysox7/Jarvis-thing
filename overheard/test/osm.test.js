import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startTestServer } from './helpers.js';
import { importLines, importPlaces, linesQuery, overpass, parseLines, parsePlaces, placesQuery } from '../server/osm.js';
import { cityAt } from '../server/domain.js';

// Sentetik Overpass yanıtları (gerçek OSM kaydı değildir).
const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

describe('OpenStreetMap aktarımı', () => {
  let srv;
  let placesJson;
  let linesJson;
  before(async () => {
    srv = await startTestServer();
    placesJson = await fixture('overpass-places.json');
    linesJson = await fixture('overpass-lines.json');
  });
  after(async () => { await srv.close(); });

  test('sorgular ilçe ve ili adıyla kurulur; tırnaklı ad reddedilir', () => {
    const q = placesQuery('İstanbul', 'Sultanbeyli');
    assert.match(q, /\["name"="İstanbul"\]/);
    assert.match(q, /\["admin_level"="6"\]\["name"="Sultanbeyli"\]/);
    assert.match(q, /out tags center bb;/);
    assert.throws(() => placesQuery('İstanbul', 'X"];out;'), /geçersiz ad/);
    const lq = linesQuery('İstanbul', { busRefs: ['34', '34AS'] });
    assert.match(lq, /subway\|light_rail\|train\|tram/);
    assert.match(lq, /\["ref"~"\^\(34\|34AS\)\$"\]/);
  });

  test('gündelik buluşma noktaları alınır; hassas yerler ve adsızlar alınmaz, tekrarlar birleşir', () => {
    const places = parsePlaces(placesJson, { cityId: 'istanbul' });
    const byName = new Map(places.map((p) => [p.name, p]));
    assert.deepEqual([...byName.keys()].sort(), ['Kadıköy Vapur İskelesi', 'Test AVM', 'Test Halı Saha', 'Test Millet Bahçesi', 'Test Semt Pazarı', 'Test İstasyonu', 'Uzak Pazar'].sort());
    assert.equal(byName.get('Test İstasyonu').kind, 'station');
    assert.equal(byName.get('Test İstasyonu').id, 'istanbul-osm-n1001');
    assert.equal(byName.get('Test Halı Saha').radius_m, 80);
    // Alanı olan mekânın yarıçapı gerçek büyüklüğünden (sınırlar içinde).
    assert.ok(byName.get('Test Semt Pazarı').radius_m >= 80 && byName.get('Test Semt Pazarı').radius_m < 100);
    assert.equal(byName.get('Test Millet Bahçesi').radius_m, 400);
    // Pilot bölge dışındaki, içe aktarma betiğinde elenir.
    assert.equal(cityAt(byName.get('Uzak Pazar').lat, byName.get('Uzak Pazar').lng), null);
    assert.equal(cityAt(byName.get('Test İstasyonu').lat, byName.get('Test İstasyonu').lng).id, 'istanbul');
  });

  test('içe aktarma: var olan mekânla çakışan atlanır, ikinci çalıştırma bir şey eklemez', () => {
    const places = parsePlaces(placesJson, { cityId: 'istanbul' }).filter((p) => cityAt(p.lat, p.lng)?.id === 'istanbul');
    const first = importPlaces(srv.db, places);
    // "Kadıköy Vapur İskelesi", hazır "Kadıköy İskelesi" ile aynı yerde.
    assert.deepEqual(first, { added: 5, skipped: 1 });
    assert.equal(srv.db.prepare("SELECT origin FROM places WHERE id = 'istanbul-osm-n1001'").get().origin, 'osm');
    assert.deepEqual(importPlaces(srv.db, places), { added: 0, skipped: 6 });
  });

  test('hatlar: her hattın en çok duraklı yönü, sırayla duraklar; peron tekrarları ayıklanır', () => {
    const lines = parseLines(linesJson, { cityId: 'istanbul' });
    assert.deepEqual(lines.map((l) => l.id).sort(), ['istanbul-line-bus-34t', 'istanbul-line-subway-t9']);
    const t9 = lines.find((l) => l.id === 'istanbul-line-subway-t9');
    assert.equal(t9.name, 'T9 Test A–Test D');
    assert.equal(t9.color, '#ef3e42');
    assert.deepEqual(t9.stops.map((s) => s.name), ['Test A', 'Test B', 'Test C', 'Test D']);
    assert.deepEqual([t9.lat, t9.lng], [40.97, 29.26]);
    // Durak rolü olmayan hatta peronlar kullanılır; renk geçerli değilse yok sayılır.
    const bus = lines.find((l) => l.id === 'istanbul-line-bus-34t');
    assert.equal(bus.stops.length, 2);
    assert.equal(bus.color, null);

    assert.deepEqual(importLines(srv.db, lines), { lines: 2, stops: 6 });
    assert.deepEqual(importLines(srv.db, lines), { lines: 2, stops: 6 });
    assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM line_stops WHERE place_id = 'istanbul-line-subway-t9'").get().n, 4);
    assert.equal(srv.db.prepare("SELECT kind FROM places WHERE id = 'istanbul-line-subway-t9'").get().kind, 'line');
  });

  test('Overpass isteği form gövdesiyle gider; hata kodu hata olur', async () => {
    let sent;
    const ok = async (url, init) => {
      sent = { url, init };
      return { ok: true, json: async () => ({ elements: [] }) };
    };
    assert.deepEqual(await overpass('[out:json];', { fetchImpl: ok }), { elements: [] });
    assert.equal(sent.url, 'https://overpass-api.de/api/interpreter');
    assert.equal(sent.init.body, `data=${encodeURIComponent('[out:json];')}`);
    const bad = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });
    await assert.rejects(overpass('x', { fetchImpl: bad }), /Overpass 429/);
  });
});
