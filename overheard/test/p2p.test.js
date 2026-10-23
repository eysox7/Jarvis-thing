import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { startTestServer, client, SPOTS } from './helpers.js';

const KADIKOY = { ...SPOTS.kadikoyIskele, accuracy: 10 };
const MIN = 60000;
let seq = 0;
const cid = () => `p2p-${Date.now().toString(36)}-${seq++}`;

// Bir cihaz: tarayıcıdaki gibi WebCrypto ile ECDSA P-256 anahtarı üretir ve sözü imzalar.
async function device(c) {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', keys.publicKey);
  const r = await c.post('/api/me/device-keys', { jwk });
  assert.equal(r.status, 200);
  const keyId = r.data.keyId;
  return {
    keyId,
    async sign(item) {
      const bytes = new TextEncoder().encode(JSON.stringify(item));
      const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, bytes);
      return `${Buffer.from(bytes).toString('base64url')}.${keyId}.${Buffer.from(sig).toString('base64url')}`;
    },
  };
}

describe('Kulaktan kulağa (eşten eşe)', () => {
  let srv;
  let author;
  let carrier;
  let authorDevice;
  before(async () => {
    srv = await startTestServer({ admins: ['p2p_mod'] });
    author = client(srv.base);
    await author.register('p2p_yazar');
    carrier = client(srv.base);
    await carrier.register('p2p_tasiyan');
    authorDevice = await device(author);
    await author.post('/api/checkins', KADIKOY);
  });
  after(async () => { await srv.close(); });

  const item = (extra = {}) => ({ c: cid(), p: 'ist-kadikoy-iskele', n: 'Kadıköy İskelesi', t: 'Vapurda biri: "Sinyal yok, dedikodu var."', h: Date.now() - 5 * MIN, v: 'l', a: 0, e: 0, f: null, u: 'p2p_yazar', ...extra });

  test('yanındakinin taşıdığı söz yazarın adına, yazıldığı anla kaydedilir', async () => {
    const it = item();
    const r = await carrier.post('/api/overheards/relay', { p: await authorDevice.sign(it) });
    assert.equal(r.status, 200);
    assert.equal(r.data.duplicate, false);
    const row = srv.db.prepare('SELECT o.*, u.handle, c.handle AS carrier FROM overheards o JOIN users u ON u.id = o.user_id JOIN users c ON c.id = o.relayed_by WHERE o.client_id = ?').get(it.c);
    assert.equal(row.handle, 'p2p_yazar');
    assert.equal(row.carrier, 'p2p_tasiyan');
    assert.equal(row.created_at, it.h);
    assert.equal(row.offline, 1);
    // Taşıyan o mekânda değilse yerel sözün metni ona sunucudan dönmez (QR'da zaten gördü).
    assert.equal(r.data.overheard.locked, true);

    // Bir başkası da aynı sözü ulaştırırsa ya da yazar sonra kendisi gönderirse tekrar kaydedilmez.
    assert.equal((await carrier.post('/api/overheards/relay', { p: await authorDevice.sign(it) })).data.duplicate, true);
    const own = await author.post('/api/overheards/offline', { clientId: it.c, text: it.t, placeId: it.p, heardAt: it.h });
    assert.equal(own.data.overheard.duplicate, true);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM overheards WHERE client_id = ?').get(it.c).n, 1);
  });

  test('taşıyan sözü değiştiremez, başkası adına söz uyduramaz', async () => {
    const signed = await authorDevice.sign(item());
    const [data, keyId, sig] = signed.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(data, 'base64url')), t: 'Değiştirilmiş söz' })).toString('base64url');
    assert.equal((await carrier.post('/api/overheards/relay', { p: `${forged}.${keyId}.${sig}` })).data.error, 'bad_signature');
    assert.equal((await carrier.post('/api/overheards/relay', { p: `${data}.yokboyleanahtar.${sig}` })).data.error, 'unknown_key');
    assert.equal((await carrier.post('/api/overheards/relay', { p: 'bozuk' })).data.error, 'bad_relay');
    // Taşıyanın kendi anahtarıyla imzaladığı söz taşıyanın adına sayılır (yazar taklit edilemez).
    const carrierDevice = await device(carrier);
    const fake = item({ u: 'p2p_yazar' });
    const r = await carrier.post('/api/overheards/relay', { p: await carrierDevice.sign(fake) });
    assert.equal(r.data.error, 'not_there_then');
  });

  test('yazar o sırada orada değildiyse, yasaklıysa ya da anahtar geçersizse kabul edilmez', async () => {
    const other = client(srv.base);
    await other.register('p2p_uzakta');
    const otherDevice = await device(other);
    assert.equal((await carrier.post('/api/overheards/relay', { p: await otherDevice.sign(item()) })).data.error, 'not_there_then');
    // Çevrimdışı alınmış konum kanıtı da imzanın içinde taşınır.
    const withFix = item({ f: [KADIKOY.lat, KADIKOY.lng, 15, Date.now() - 6 * MIN] });
    assert.equal((await carrier.post('/api/overheards/relay', { p: await otherDevice.sign(withFix) })).status, 200);

    const mod = client(srv.base);
    await mod.register('p2p_mod');
    await mod.post('/api/admin/users/p2p_uzakta/ban', { banned: true });
    assert.equal((await carrier.post('/api/overheards/relay', { p: await otherDevice.sign(item({ f: withFix.f })) })).data.error, 'banned');

    for (const jwk of [null, { kty: 'RSA' }, { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }, { kty: 'EC', crv: 'P-256', x: 'a', y: 'b', d: 'gizli' }]) {
      assert.equal((await author.post('/api/me/device-keys', { jwk })).data.error, 'bad_key', JSON.stringify(jwk));
    }
  });

  test('kullanıcı başına en fazla 5 cihaz anahtarı tutulur; hesap silinince anahtarlar da gider', async () => {
    const c = client(srv.base);
    await c.register('p2p_cokcihaz');
    for (let i = 0; i < 7; i++) await device(c);
    const { id } = srv.db.prepare("SELECT id FROM users WHERE handle = 'p2p_cokcihaz'").get();
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM device_keys WHERE user_id = ?').get(id).n, 5);
    await c.post('/api/me/delete', { password: 'gizli-parola-123' });
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM device_keys WHERE user_id = ?').get(id).n, 0);
  });
});
