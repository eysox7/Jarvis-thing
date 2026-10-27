import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { startTestServer, client } from './helpers.js';
import { createGoogleVerifier, suggestHandle } from '../server/google.js';

const CLIENT_ID = 'test-web-client.apps.googleusercontent.com';

// Google'ın yerine: yerel bir RSA anahtarıyla imzalanan kimlik belgeleri ve onu yayımlayan sahte JWKS.
function fakeGoogle() {
  const keys = [];
  const addKey = (kid) => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    keys.push({ kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } });
  };
  addKey('k1');
  let fetches = 0;
  const fetchImpl = async () => {
    fetches++;
    return {
      ok: true,
      headers: new Headers({ 'cache-control': 'public, max-age=3600' }),
      json: async () => ({ keys: keys.map((k) => k.jwk) }),
    };
  };
  const token = (claims = {}, { kid = keys.at(-1).kid, key } = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1000001', iat: now, exp: now + 3600,
      email: 'ayse@example.com', email_verified: true, given_name: 'Ayşe', ...claims,
    })).toString('base64url');
    const signer = key ?? keys.find((k) => k.kid === kid).privateKey;
    return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), signer).toString('base64url')}`;
  };
  return { fetchImpl, token, addKey, keys, get fetches() { return fetches; } };
}

describe('Google kimlik belgesi doğrulama', () => {
  test('geçerli belge kabul edilir; yanlış kitle, süre, imza, veren ve doğrulanmamış e-posta reddedilir', async () => {
    const g = fakeGoogle();
    const verifier = createGoogleVerifier({ clientIds: [CLIENT_ID], fetchImpl: g.fetchImpl });
    assert.deepEqual(await verifier.verifyIdToken(g.token()), { sub: '1000001', name: 'Ayşe' });
    const rejects = async (token) => assert.equal((await verifier.verifyIdToken(token).catch((e) => e)).code, 'google_token_invalid');
    await rejects(g.token({ aud: 'baska-uygulama' }));
    await rejects(g.token({ exp: Math.floor(Date.now() / 1000) - 3600 }));
    await rejects(g.token({ iss: 'https://evil.example' }));
    await rejects(g.token({ email_verified: false }));
    await rejects(g.token({}, { key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey }));
    await rejects('bozuk.belge');
    await rejects(undefined);
    // Anahtarlar önbellekten gelir.
    assert.equal(g.fetches, 1);
  });

  test('Google anahtar değiştirince yeni anahtar bir kez çekilir', async () => {
    const g = fakeGoogle();
    const verifier = createGoogleVerifier({ clientIds: [CLIENT_ID], fetchImpl: g.fetchImpl });
    await verifier.verifyIdToken(g.token());
    g.addKey('k2');
    assert.equal((await verifier.verifyIdToken(g.token({ sub: '2' }, { kid: 'k2' }))).sub, '2');
    assert.equal(g.fetches, 2);
  });

  test('bilinmeyen anahtar kimliğiyle Google\'a istek yağdırılamaz; eşzamanlı istekler tek indirmeyi bekler', async () => {
    const g = fakeGoogle();
    let clock = Date.now();
    const verifier = createGoogleVerifier({ clientIds: [CLIENT_ID], fetchImpl: g.fetchImpl, now: () => clock });
    await Promise.all([1, 2, 3, 4, 5].map(() => verifier.verifyIdToken(g.token())));
    assert.equal(g.fetches, 1);
    const forged = g.token({}, { kid: 'uydurma', key: g.keys[0].privateKey });
    for (let i = 0; i < 10; i++) await verifier.verifyIdToken(forged).catch(() => {});
    assert.equal(g.fetches, 2);
    clock += 61000;
    await verifier.verifyIdToken(forged).catch(() => {});
    assert.equal(g.fetches, 3);
  });

  test('Google adından kullanıcı adı', () => {
    assert.equal(suggestHandle('Ayşe Yılmaz'), 'ayse_yilmaz');
    assert.equal(suggestHandle('Çağrı Öztürk-İnce'), 'cagri_ozturk_inc');
    assert.equal(suggestHandle('李'), 'kulak');
    assert.equal(suggestHandle(null), 'kulak');
  });
});

describe('Google ile giriş', () => {
  let srv;
  let g;
  before(async () => {
    g = fakeGoogle();
    srv = await startTestServer({
      demo: true,
      googleClientIds: [CLIENT_ID],
      google: createGoogleVerifier({ clientIds: [CLIENT_ID], fetchImpl: g.fetchImpl }),
    });
  });
  after(async () => { await srv.close(); });

  test('kapalıyken 404; açıkken istemci kimliği yapılandırmada', async () => {
    const off = await startTestServer();
    assert.equal((await client(off.base).post('/api/auth/google', { idToken: g.token() })).data.error, 'google_disabled');
    assert.equal((await client(off.base).get('/api/config')).data.googleClientId, null);
    await off.close();
    assert.equal((await client(srv.base).get('/api/config')).data.googleClientId, CLIENT_ID);
    const res = await fetch(`${srv.base}/`);
    assert.match(res.headers.get('content-security-policy'), /script-src[^;]*https:\/\/accounts\.google\.com\/gsi\/client/);
  });

  test('yeni hesap koşullar kabul edilince açılır; aynı Google hesabı hep aynı hesaba girer', async () => {
    const c = client(srv.base);
    assert.equal((await c.post('/api/auth/google', { idToken: g.token({ sub: 'g-1' }) })).data.error, 'terms_required');
    const first = await c.post('/api/auth/google', { idToken: g.token({ sub: 'g-1' }), acceptTerms: true });
    assert.equal(first.status, 200);
    assert.equal(first.data.created, true);
    assert.equal(first.data.user.handle, 'ayse');
    const me = (await c.get('/api/me')).data;
    assert.deepEqual(me.auth, { password: false, google: true, confirm: 'google' });

    // Aynı adlı başka biri: ad çakışmaz.
    const other = await client(srv.base).post('/api/auth/google', { idToken: g.token({ sub: 'g-2' }), acceptTerms: true });
    assert.match(other.data.user.handle, /^ayse_[0-9a-f]{4}$/);
    // İstenen kullanıcı adı boştaysa o kullanılır.
    const named = await client(srv.base).post('/api/auth/google', { idToken: g.token({ sub: 'g-3' }), acceptTerms: true, handle: 'metro_kulagi' });
    assert.equal(named.data.user.handle, 'metro_kulagi');

    const again = await client(srv.base).post('/api/auth/google', { idToken: g.token({ sub: 'g-1' }) });
    assert.equal(again.data.created, false);
    assert.equal(again.data.user.handle, 'ayse');
    // Google hesabının parolası yok: parolayla girilemez.
    assert.equal((await client(srv.base).post('/api/auth/login', { handle: 'ayse', password: 'herhangi-bir-parola' })).status, 401);
  });

  test('misafir hesabı Google\'a bağlanınca kalıcı olur ve misafir adı değişir; parola hesabı da bağlanabilir', async () => {
    const guest = client(srv.base);
    const { handle } = (await guest.post('/api/auth/guest')).data.user;
    const linked = await guest.post('/api/auth/google', { idToken: g.token({ sub: 'g-guest', given_name: 'Kalıcı' }) });
    assert.equal(linked.data.linked, true);
    assert.equal(linked.data.user.isGuest, false);
    assert.equal(linked.data.user.handle, 'kalici');
    assert.notEqual(linked.data.user.handle, handle);
    const me = (await guest.get('/api/me')).data;
    assert.equal(me.user.handle, 'kalici');
    assert.deepEqual(me.auth, { password: false, google: true, confirm: 'google' });
    const back = await client(srv.base).post('/api/auth/google', { idToken: g.token({ sub: 'g-guest' }) });
    assert.equal(back.data.user.handle, 'kalici');

    const member = client(srv.base);
    await member.register('parolali_uye');
    await member.post('/api/auth/google', { idToken: g.token({ sub: 'g-member' }) });
    assert.deepEqual((await member.get('/api/me')).data.auth, { password: true, google: true, confirm: 'password' });
    assert.equal((await client(srv.base).post('/api/auth/google', { idToken: g.token({ sub: 'g-member' }) })).data.user.handle, 'parolali_uye');
    // Zaten bağlı: yeniden bağlamak zararsız.
    assert.equal((await member.post('/api/auth/google', { idToken: g.token({ sub: 'g-member' }) })).data.linked, true);
  });

  test('başka hesaba bağlı Google: üye hesap değiştirilmez (409), misafir o hesaba geçer', async () => {
    const owner = client(srv.base);
    await owner.post('/api/auth/google', { idToken: g.token({ sub: 'g-owner', given_name: 'Sahip' }), acceptTerms: true });
    const member = client(srv.base);
    await member.register('baska_uye');
    const res = await member.post('/api/auth/google', { idToken: g.token({ sub: 'g-owner' }) });
    assert.equal(res.status, 409);
    assert.equal(res.data.error, 'google_linked_elsewhere');
    assert.equal((await member.get('/api/me')).data.user.handle, 'baska_uye');

    const guest = client(srv.base);
    await guest.post('/api/auth/guest');
    const switched = await guest.post('/api/auth/google', { idToken: g.token({ sub: 'g-owner' }) });
    assert.equal(switched.data.created, false);
    assert.equal((await guest.get('/api/me')).data.user.handle, 'Sahip');
  });

  test('aynı Google hesabıyla aynı anda iki kayıt: tek hesap açılır, ikisi de ona girer', async () => {
    const [a, b] = await Promise.all([1, 2].map(() =>
      client(srv.base).post('/api/auth/google', { idToken: g.token({ sub: 'g-race', given_name: 'Yarış' }), acceptTerms: true })));
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.deepEqual([a.data.created, b.data.created].sort(), [false, true]);
    assert.equal(a.data.user.handle, b.data.user.handle);
    assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM user_identities WHERE subject = 'g-race'").get().n, 1);
    assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM users WHERE handle LIKE 'yaris%'").get().n, 1);
  });

  test('parolasız hesap, taze Google girişiyle silinir', async () => {
    const c = client(srv.base);
    await c.post('/api/auth/google', { idToken: g.token({ sub: 'g-del', given_name: 'Silinecek' }), acceptTerms: true });
    assert.equal((await c.post('/api/me/delete', {})).data.error, 'google_token_invalid');
    assert.equal((await c.post('/api/me/delete', { googleIdToken: g.token({ sub: 'g-1' }) })).data.error, 'bad_credentials');
    assert.equal((await c.post('/api/me/delete', { googleIdToken: g.token({ sub: 'g-del' }) })).status, 200);
    assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM user_identities WHERE subject = 'g-del'").get().n, 0);
    // Silinen Google hesabıyla yeniden gelen yeni bir hesap açar.
    const fresh = await client(srv.base).post('/api/auth/google', { idToken: g.token({ sub: 'g-del', given_name: 'Silinecek' }) });
    assert.equal(fresh.data.error, 'terms_required');
  });

  test('Google sonradan kapatılırsa parolasız hesap kullanıcı adını yazarak silinir', async () => {
    const verifier = createGoogleVerifier({ clientIds: [CLIENT_ID], fetchImpl: g.fetchImpl });
    const own = await startTestServer({ googleClientIds: [CLIENT_ID], google: verifier });
    try {
      const c = client(own.base);
      await c.post('/api/auth/google', { idToken: g.token({ sub: 'g-off', given_name: 'Kapali' }), acceptTerms: true });
      verifier.enabled = false;
      assert.equal((await c.get('/api/me')).data.auth.confirm, 'handle');
      assert.equal((await c.post('/api/me/delete', { handle: 'baskasi' })).data.error, 'bad_credentials');
      // Büyük/küçük harf fark etmez.
      assert.equal((await c.post('/api/me/delete', { handle: ' kapali ' })).status, 200);
      assert.equal(own.db.prepare("SELECT COUNT(*) AS n FROM users WHERE handle = 'Kapali'").get().n, 0);
    } finally {
      await own.close();
    }
  });
});

describe('Ters vekil arkasında', () => {
  test('tarayıcının gördüğü adres (X-Forwarded-Host) güvenilir vekilde kabul edilir', async () => {
    const srv = await startTestServer({ demo: true, trustProxy: true });
    const post = (headers) => fetch(`${srv.base}/api/auth/guest`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
    assert.equal((await post({ origin: 'https://ornek-8787.app.github.dev', 'x-forwarded-host': 'ornek-8787.app.github.dev' })).status, 200);
    assert.equal((await post({ origin: 'https://kotu.example', 'x-forwarded-host': 'ornek-8787.app.github.dev' })).status, 403);
    await srv.close();
    const strict = await startTestServer({ demo: true });
    const res = await fetch(`${strict.base}/api/auth/guest`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://ornek-8787.app.github.dev', 'x-forwarded-host': 'ornek-8787.app.github.dev' }, body: '{}',
    });
    assert.equal(res.status, 403);
    await strict.close();
  });
});
