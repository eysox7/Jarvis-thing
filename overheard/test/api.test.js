import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client, SPOTS } from './helpers.js';

describe('Overheard API', () => {
  let srv;
  before(async () => { srv = await startTestServer(); });
  after(async () => { await srv.close(); });

  test('config pilot şehirleri listeler', async () => {
    const r = await client(srv.base).get('/api/config');
    assert.equal(r.status, 200);
    const ids = r.data.cities.map((c) => c.id);
    for (const id of ['istanbul', 'ankara', 'izmir', 'austin', 'new-york', 'los-angeles']) assert.ok(ids.includes(id), id);
  });

  test('kayıt, giriş, çıkış', async () => {
    const c = client(srv.base);
    assert.equal((await c.post('/api/auth/register', { handle: 'a', password: 'x' })).data.error, 'bad_handle');
    assert.equal((await c.post('/api/auth/register', { handle: 'ayse', password: 'kisa' })).data.error, 'bad_password');
    await c.register('ayse');
    assert.equal((await c.get('/api/me')).data.user.handle, 'ayse');
    assert.equal((await client(srv.base).post('/api/auth/register', { handle: 'AYSE', password: 'gizli-parola-123' })).data.error, 'handle_taken');
    await c.post('/api/auth/logout');
    assert.equal((await c.get('/api/me')).data.user, null);
    assert.equal((await c.post('/api/auth/login', { handle: 'ayse', password: 'yanlis-parola' })).status, 401);
    assert.equal((await c.post('/api/auth/login', { handle: 'ayse', password: 'gizli-parola-123' })).status, 200);
    assert.equal((await c.get('/api/me')).data.user.handle, 'ayse');
  });

  test('JSON olmayan gövde ve yabancı Origin reddedilir', async () => {
    const form = await fetch(`${srv.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'handle=x' });
    assert.equal(form.status, 415);
    const evil = await fetch(`${srv.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
    assert.equal(evil.status, 403);
  });

  test('check-in yalnızca yarıçap içindeki mekânları açar', async () => {
    const c = client(srv.base);
    await c.register('checkin_user');
    const far = await c.post('/api/checkins', SPOTS.istanbulNowhere);
    assert.deepEqual(far.data.places, []);
    assert.equal(far.data.city, 'istanbul');

    const near = await c.post('/api/checkins', SPOTS.kadikoyIskeleEdge);
    const ids = near.data.places.map((p) => p.id);
    assert.ok(ids.includes('ist-kadikoy-iskele'));
    assert.equal(near.data.places.find((p) => p.id === 'ist-kadikoy-iskele').newlyUnlocked, true);

    const again = await c.post('/api/checkins', SPOTS.kadikoyIskeleEdge);
    assert.equal(again.data.places.find((p) => p.id === 'ist-kadikoy-iskele').newlyUnlocked, false);

    const mine = await c.get('/api/me/places');
    assert.ok(mine.data.places.some((p) => p.id === 'ist-kadikoy-iskele'));
  });

  test('ortak mekân kuralı: oraya gitmeyen sözü okuyamaz', async () => {
    const author = client(srv.base);
    const stranger = client(srv.base);
    const visitor = client(srv.base);
    await author.register('soz_sahibi');
    await stranger.register('yabanci');
    await visitor.register('ziyaretci');

    const posted = await author.post('/api/overheards', { text: 'Vapur yine geç kaldı ama martılar dakik.', ...SPOTS.kadikoyIskele });
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
    const { id, placeId } = posted.data.overheard;
    assert.equal(placeId, 'ist-kadikoy-iskele');
    assert.equal(posted.data.overheard.mine, true);

    // Misafir (giriş yapmamış) ve oraya hiç gitmemiş kullanıcı: kilitli, metin yok.
    for (const viewer of [client(srv.base), stranger]) {
      const r = await viewer.get(`/api/overheards/${id}`);
      assert.equal(r.data.overheard.locked, true);
      assert.equal(r.data.overheard.text, undefined);
      assert.equal(r.data.overheard.author, undefined);
      assert.ok(r.data.overheard.length > 0);
    }
    const map = await stranger.get('/api/cities/istanbul/map');
    const onMap = map.data.overheards.find((o) => o.id === id);
    assert.equal(onMap.locked, true);
    assert.ok(!JSON.stringify(map.data).includes('martılar dakik'), 'kilitli metin haritaya sızmamalı');

    // Kilitliyken tepki veremez, mesaj atamaz.
    assert.equal((await stranger.post(`/api/overheards/${id}/reactions`, { kind: 'lol' })).data.error, 'not_mutual');
    assert.equal((await stranger.post(`/api/overheards/${id}/messages`, { body: 'Selam!' })).data.error, 'not_mutual');

    // Mekâna gidince açılır.
    await visitor.post('/api/checkins', SPOTS.kadikoyIskele);
    const open = await visitor.get(`/api/overheards/${id}`);
    assert.equal(open.data.overheard.locked, false);
    assert.equal(open.data.overheard.text, 'Vapur yine geç kaldı ama martılar dakik.');
    assert.equal(open.data.overheard.author, 'soz_sahibi');
    assert.equal(open.data.overheard.sameTime, true);
    assert.equal(open.data.overheard.mutualPlaces, 1);
    assert.equal(open.data.overheard.canMessage, true);
  });

  test('söz paylaşmak için mekânda olmak gerekir', async () => {
    const c = client(srv.base);
    await c.register('paylasan');
    assert.equal((await c.post('/api/overheards', { text: 'Burada değilim', placeId: 'ist-kadikoy-iskele', ...SPOTS.modaSahil })).data.error, 'not_at_place');
    assert.equal((await c.post('/api/overheards', { text: 'ab', ...SPOTS.kadikoyIskele })).data.error, 'text_too_short');
    assert.equal((await c.post('/api/overheards', { text: 'x'.repeat(281), ...SPOTS.kadikoyIskele })).data.error, 'text_too_long');
    assert.equal((await c.post('/api/overheards', { text: 'Hiçbir yerdeyim', ...SPOTS.istanbulNowhere })).data.error, 'no_place');
    assert.equal((await c.post('/api/overheards', { text: 'Berlin', newPlaceName: 'Alexanderplatz', ...SPOTS.berlin })).data.error, 'outside_pilot');
    assert.equal((await client(srv.base).post('/api/overheards', { text: 'Giriş yok', ...SPOTS.kadikoyIskele })).status, 401);
  });

  test('yeni mekân oluşturup söz bırakma', async () => {
    const c = client(srv.base);
    await c.register('kasif');
    const r = await c.post('/api/overheards', { text: 'Bu sokakta herkes birbirini tanıyor.', newPlaceName: 'Gizli Sokak', ...SPOTS.istanbulNowhere });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.overheard.placeName, 'Gizli Sokak');
    assert.equal(r.data.overheard.cityId, 'istanbul');
    const dup = await c.post('/api/overheards', { text: 'İkinci söz', newPlaceName: 'Aynı Sokak', ...SPOTS.istanbulNowhere });
    assert.equal(dup.data.error, 'place_exists');
    assert.equal(dup.data.place.name, 'Gizli Sokak');
  });

  test('tepkiler açılıp kapanır', async () => {
    const author = client(srv.base);
    const fan = client(srv.base);
    await author.register('komik');
    await fan.register('gulen');
    const { id } = (await author.post('/api/overheards', { text: 'Simit de bir yaşam biçimidir.', ...SPOTS.modaSahil })).data.overheard;
    await fan.post('/api/checkins', SPOTS.modaSahil);
    let r = await fan.post(`/api/overheards/${id}/reactions`, { kind: 'lol' });
    assert.deepEqual(r.data.overheard.myReactions, ['lol']);
    assert.equal(r.data.overheard.reactions.lol, 1);
    r = await fan.post(`/api/overheards/${id}/reactions`, { kind: 'lol' });
    assert.deepEqual(r.data.overheard.myReactions, []);
    assert.equal((await fan.post(`/api/overheards/${id}/reactions`, { kind: 'nope' })).data.error, 'bad_reaction');
  });

  test('söz üzerinden mesajlaşma ve okunmamış sayısı', async () => {
    const author = client(srv.base);
    const reader = client(srv.base);
    await author.register('anlatan');
    await reader.register('dinleyen');
    const { id } = (await author.post('/api/overheards', { text: 'Austin is just a big backyard.', ...SPOTS.austin6th })).data.overheard;
    await reader.post('/api/checkins', SPOTS.austin6th);

    assert.equal((await author.post(`/api/overheards/${id}/messages`, { body: 'kendime' })).data.error, 'own_overheard');
    const first = await reader.post(`/api/overheards/${id}/messages`, { body: 'Ben de oradaydım, o sendin miydin?' });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    const convId = first.data.conversationId;

    assert.equal((await author.get('/api/me')).data.unread, 1);
    const inbox = await author.get('/api/conversations');
    assert.equal(inbox.data.conversations[0].with, 'dinleyen');
    assert.equal(inbox.data.conversations[0].unread, true);

    const conv = await author.get(`/api/conversations/${convId}`);
    assert.equal(conv.data.conversation.messages.length, 1);
    assert.equal(conv.data.conversation.overheard.text, 'Austin is just a big backyard.');
    assert.deepEqual(conv.data.conversation.mutualPlaces.map((p) => p.id), ['aus-6th']);
    assert.equal((await author.get('/api/me')).data.unread, 0);

    await author.post(`/api/conversations/${convId}/messages`, { body: 'Evet bendim :)' });
    const again = await reader.post(`/api/overheards/${id}/messages`, { body: 'Harika!' });
    assert.equal(again.data.conversationId, convId, 'aynı söz için aynı konuşma kullanılmalı');
    const full = await reader.get(`/api/conversations/${convId}`);
    assert.deepEqual(full.data.conversation.messages.map((m) => [m.body, m.fromMe]), [
      ['Ben de oradaydım, o sendin miydin?', true], ['Evet bendim :)', false], ['Harika!', true],
    ]);

    const outsider = client(srv.base);
    await outsider.register('merakli');
    assert.equal((await outsider.get(`/api/conversations/${convId}`)).status, 404);
  });

  test('engellenen kullanıcının sözleri görünmez, mesaj atılamaz', async () => {
    const a = client(srv.base);
    const b = client(srv.base);
    await a.register('engelleyen');
    await b.register('engellenen');
    const { id } = (await b.post('/api/overheards', { text: 'Bunu kimse görmesin.', ...SPOTS.kadikoyIskele })).data.overheard;
    await a.post('/api/checkins', SPOTS.kadikoyIskele);
    assert.equal((await a.post('/api/users/engellenen/block')).status, 200);
    assert.equal((await a.get(`/api/overheards/${id}`)).status, 404);
    const map = await a.get('/api/cities/istanbul/map');
    assert.ok(!map.data.overheards.some((o) => o.id === id));
  });

  test('yeterli şikâyet sözü gizler; sahibi silebilir', async () => {
    const author = client(srv.base);
    await author.register('sikayetlik');
    const { id } = (await author.post('/api/overheards', { text: 'Tartışmalı bir söz.', ...SPOTS.modaSahil })).data.overheard;
    for (let i = 0; i < srv.config.reportHideThreshold; i++) {
      const r = client(srv.base);
      await r.register(`sikayetci${i}`);
      await r.post('/api/checkins', SPOTS.modaSahil);
      assert.equal((await r.post(`/api/overheards/${id}/report`, { reason: 'spam' })).status, 200);
    }
    assert.equal((await client(srv.base).get(`/api/overheards/${id}`)).status, 404);
    assert.equal((await author.get(`/api/overheards/${id}`)).status, 200, 'sahibi gizlenen sözünü görebilir');

    const other = client(srv.base);
    await other.register('baskasi');
    assert.equal((await other.del(`/api/overheards/${id}`)).data.error, 'not_owner');
    assert.equal((await author.del(`/api/overheards/${id}`)).status, 200);
    assert.equal((await author.get(`/api/overheards/${id}`)).status, 404);
  });

  test('statik dosyalar ve tek sayfa yönlendirmesi', async () => {
    const index = await fetch(`${srv.base}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-security-policy'), /default-src 'self'/);
    const deep = await fetch(`${srv.base}/places`);
    assert.equal(deep.status, 200);
    // Kök dışına çıkma denemesi public/ içinde kalır ve bulunamaz.
    assert.equal((await fetch(`${srv.base}/..%2fserver/app.js`)).status, 404);
    assert.equal((await fetch(`${srv.base}/nope.js`)).status, 404);
  });
});

describe('Demo modu', () => {
  let srv;
  before(async () => { srv = await startTestServer({ demo: true }); });
  after(async () => { await srv.close(); });

  test('örnek sözler her pilot şehirde var ve kilitli gelir', async () => {
    const guest = client(srv.base);
    for (const city of ['istanbul', 'ankara', 'izmir', 'austin', 'new-york', 'los-angeles']) {
      const r = await guest.get(`/api/cities/${city}/map`);
      assert.ok(r.data.overheards.length >= 5, city);
      assert.ok(r.data.overheards.every((o) => o.locked), city);
      assert.ok(r.data.places.some((p) => p.count > 0), city);
    }
  });

  test('misafir hesabı oluşturulur', async () => {
    const c = client(srv.base);
    const r = await c.post('/api/auth/guest');
    assert.match(r.data.user.handle, /^misafir_/);
    assert.equal((await c.get('/api/me')).data.user.isGuest, true);
  });
});
