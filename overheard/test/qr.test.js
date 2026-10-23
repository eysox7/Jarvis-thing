import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { startTestServer, client } from './helpers.js';
import { qrMatrix, qrSvg } from '../server/qr.js';
import { placeQrCode } from '../server/domain.js';

// Matrisi piksellere döküp gerçek bir QR okuyucuyla çözer.
function decode(rows, scale = 4, border = 4) {
  const n = (rows.length + border * 2) * scale;
  const data = new Uint8ClampedArray(n * n * 4).fill(255);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '1') continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + border) * scale + dy) * n + (x + border) * scale + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  });
  return jsQR(data, n, n)?.data ?? null;
}

const GALATA = { lat: 41.0256, lng: 28.9741 };
// Galata Kulesi'nden ~500 m kuzey: hiçbir mekânın içinde değil (kapalı alandaki oynak konum gibi).
const NEAR_GALATA = { lat: 41.0301, lng: 28.9741 };
// ~3 km kuzey: mekândan çıkmış sayılır.
const FAR_FROM_GALATA = { lat: 41.0526, lng: 28.9741 };

describe('QR kodu üreticisi', () => {
  test('sürüm 1–10 arası her uzunluk okunabilir', () => {
    for (const len of [1, 12, 20, 30, 50, 70, 90, 110, 140, 170, 210]) {
      const text = `https://o.example/?qr=${'x'.repeat(len)}`.slice(0, Math.max(len, 1));
      const rows = qrMatrix(text);
      assert.ok(rows.length >= 21 && rows.length <= 57);
      assert.equal(decode(rows), text, `uzunluk ${len}`);
    }
  });

  test('SVG beyaz zeminli ve kare', () => {
    const svg = qrSvg('merhaba');
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 29 29"/);
    assert.throws(() => qrMatrix('x'.repeat(400)), /qr_data_too_long/);
  });
});

describe('Mekân QR kodu ile giriş', () => {
  let srv;
  let author;
  let overheardId;
  before(async () => {
    srv = await startTestServer({ antiSpoofing: true, admins: ['mod_qr'] });
    author = client(srv.base);
    await author.register('qr_yazar');
    await author.post('/api/checkins', { ...GALATA, accuracy: 10 });
    const r = await author.post('/api/overheards', { text: 'Kulenin dibinde biri "asansör yok mu" dedi', ...GALATA, placeId: 'ist-galata', visibility: 'local' });
    assert.equal(r.status, 200);
    overheardId = r.data.overheard.id;
  });
  after(async () => { await srv.close(); });

  const newUser = async (prefix) => {
    const c = client(srv.base);
    const handle = `${prefix}_${Math.random().toString(36).slice(2, 7)}`;
    await c.register(handle);
    return { c, handle, id: srv.db.prepare('SELECT id FROM users WHERE handle = ?').get(handle).id };
  };
  const code = () => placeQrCode(srv.db, srv.config, 'ist-galata');

  test('QR kodunu yalnızca moderatör alır; kod bağlantıya gömülüdür ve okunur', async () => {
    const { c } = await newUser('merakli');
    assert.equal((await c.get('/api/admin/places/ist-galata/qr')).status, 403);

    const mod = client(srv.base);
    await mod.register('mod_qr');
    const search = await mod.get(`/api/admin/places?q=${encodeURIComponent('galata')}`);
    assert.deepEqual(search.data.places.map((p) => p.id), ['ist-galata']);
    const r = await mod.get('/api/admin/places/ist-galata/qr');
    assert.equal(r.status, 200);
    assert.equal(r.data.place.name, 'Galata Kulesi');
    assert.equal(r.data.url, `${srv.base}/?qr=${code()}`);
    assert.match(r.data.svg, /^<svg/);
    assert.equal(decode(r.data.matrix), r.data.url);
    // İmza sabittir: aynı mekân hep aynı kodu verir.
    assert.equal(code(), placeQrCode(srv.db, srv.config, 'ist-galata'));
  });

  test('kaba konum yeter: GPS reddederken QR ile içeri girilir ve yerel sözler açılır', async () => {
    const { c } = await newUser('kafede');
    const coarse = { ...NEAR_GALATA, accuracy: 800 };
    assert.equal((await c.post('/api/checkins', coarse)).data.blocked, 'low_accuracy');
    assert.equal((await c.get(`/api/overheards/${overheardId}`)).data.overheard.locked, true);

    const r = await c.post('/api/checkins/qr', { code: code(), ...coarse });
    assert.equal(r.status, 200);
    assert.equal(r.data.blocked, undefined);
    const galata = r.data.places.find((p) => p.id === 'ist-galata');
    assert.equal(galata.here, true);
    assert.equal(galata.qr, true);
    assert.equal(galata.arrived, true);
    assert.equal(galata.firstVisit, true);
    assert.ok(r.data.newBadges.includes('first_step'));
    const o = (await c.get(`/api/overheards/${overheardId}`)).data.overheard;
    assert.equal(o.locked, false);
    assert.equal(o.here, true);
    // Oradakiler arasında sayılır ve mekân odasına girebilir.
    const map = await c.get('/api/cities/istanbul/map');
    assert.ok(map.data.places.find((p) => p.id === 'ist-galata').peopleHere >= 1);
    assert.equal((await c.get('/api/places/ist-galata/room')).status, 200);
  });

  test('sahte ya da başka mekâna aktarılmış kod reddedilir', async () => {
    const { c } = await newUser('sahteci');
    const token = code().split('.').pop();
    for (const bad of ['', 'ist-galata', `ist-galata.${'A'.repeat(token.length)}`, `ist-moda-sahil.${token}`, `${code()}x`]) {
      const r = await c.post('/api/checkins/qr', { code: bad, ...NEAR_GALATA, accuracy: 50 });
      assert.equal(r.status, 400, bad);
      assert.equal(r.data.error, 'bad_qr');
    }
  });

  test('kodun fotoğrafı uzaktan okutulamaz', async () => {
    const { c } = await newUser('evden');
    const r = await c.post('/api/checkins/qr', { code: code(), ...FAR_FROM_GALATA, accuracy: 50 });
    assert.equal(r.data.blocked, 'qr_too_far');
    assert.deepEqual(r.data.places, []);
    assert.equal((await c.get(`/api/overheards/${overheardId}`)).data.overheard.locked, true);
  });

  test('içeride konum oynasa da kalırsın; uzaklaşınca ya da süre dolunca çıkarsın', async () => {
    const { c, id } = await newUser('oynak');
    await c.post('/api/checkins/qr', { code: code(), ...NEAR_GALATA, accuracy: 300 });
    // Kapalı alanda GPS 500 m oynadı: QR mekânı korunur, ayrılış sayılmaz.
    const drift = await c.post('/api/checkins', { ...NEAR_GALATA, accuracy: 300 });
    assert.equal(drift.data.blocked, undefined);
    assert.deepEqual(drift.data.left, []);
    assert.equal(drift.data.places.find((p) => p.id === 'ist-galata')?.here, true);

    const away = await c.post('/api/checkins', { ...FAR_FROM_GALATA, accuracy: 20 });
    assert.deepEqual(away.data.left, ['ist-galata']);
    assert.equal((await c.get(`/api/overheards/${overheardId}`)).data.overheard.locked, true);

    // Yeniden okut; QR süresi (2 saat) dolunca yakında olsan da çıkarsın.
    srv.db.prepare('UPDATE location_reports SET at = at - ? WHERE user_id = ?').run(60 * 60000, id);
    await c.post('/api/checkins/qr', { code: code(), ...NEAR_GALATA, accuracy: 300 });
    assert.equal((await c.get(`/api/overheards/${overheardId}`)).data.overheard.locked, false);
    srv.db.prepare('UPDATE qr_presence SET at = at - ? WHERE user_id = ?').run(srv.config.qrPresenceMs + 1000, id);
    assert.equal((await c.get(`/api/overheards/${overheardId}`)).data.overheard.locked, true);
  });

  test('QR ile girilen mekâna, mekân dairesinin dışından da söz bırakılır', async () => {
    const { c } = await newUser('icerde');
    await c.post('/api/checkins/qr', { code: code(), ...NEAR_GALATA, accuracy: 600 });
    const r = await c.post('/api/overheards', { text: 'Barista "bugün herkes latte" dedi', ...NEAR_GALATA, accuracy: 600 });
    assert.equal(r.status, 200);
    assert.equal(r.data.overheard.placeId, 'ist-galata');
    // QR'sız biri aynı belirsiz konumdan söz bırakamaz.
    const { c: other } = await newUser('disarda');
    await other.post('/api/checkins', { ...NEAR_GALATA, accuracy: 20 });
    assert.equal((await other.post('/api/overheards', { text: 'deneme sözü', ...NEAR_GALATA, accuracy: 600 })).data.error, 'low_accuracy');
  });

  test('QR girişi kişisel veri dökümünde görünür', async () => {
    const { c } = await newUser('dokum');
    await c.post('/api/checkins/qr', { code: code(), ...GALATA, accuracy: 30 });
    const data = (await c.get('/api/me/export')).data;
    assert.equal(data.lastQrCheckin.place, 'Galata Kulesi');
  });

  test('ayrı bir sır verilirse kodlar değişir', () => {
    const custom = placeQrCode(srv.db, { ...srv.config, qrSecret: 'baska-sir' }, 'ist-galata');
    assert.notEqual(custom, code());
    assert.match(custom, /^ist-galata\.[\w-]{22}$/);
  });
});
