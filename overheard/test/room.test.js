import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client, SPOTS } from './helpers.js';
import { purgeStaleData } from '../server/domain.js';

describe('Mekân odası', () => {
  let srv;
  before(async () => { srv = await startTestServer(); });
  after(async () => { await srv.close(); });

  test('yalnızca o an mekânda olanlar okur ve yazar; mesajlar 12 saat sonra silinir', async () => {
    const a = client(srv.base);
    const b = client(srv.base);
    const far = client(srv.base);
    await a.register('oda_a');
    await b.register('oda_b');
    await far.register('oda_uzak');
    await a.post('/api/checkins', SPOTS.kadikoyIskele);
    await b.post('/api/checkins', SPOTS.kadikoyIskeleEdge);
    await far.post('/api/checkins', SPOTS.modaSahil);

    assert.equal((await far.get('/api/places/ist-kadikoy-iskele/room')).data.error, 'not_here');
    assert.equal((await far.post('/api/places/ist-kadikoy-iskele/room', { body: 'Selam!' })).data.error, 'not_here');

    const sent = await a.post('/api/places/ist-kadikoy-iskele/room', { body: 'Vapur kaçta kalkıyor, bilen var mı? Numaram 0532 123 45 67' });
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    assert.equal(sent.data.message.body, 'Vapur kaçta kalkıyor, bilen var mı? Numaram [telefon]', 'ortak odada kişisel veri maskelenir');

    const room = (await b.get('/api/places/ist-kadikoy-iskele/room')).data.room;
    assert.equal(room.place.name, 'Kadıköy İskelesi');
    assert.equal(room.peopleHere, 2);
    assert.deepEqual(room.messages.map((m) => [m.author, m.mine]), [['oda_a', false]]);
    await b.post('/api/places/ist-kadikoy-iskele/room', { body: '5 dakikaya!' });
    assert.deepEqual((await a.get('/api/places/ist-kadikoy-iskele/room')).data.room.messages.map((m) => m.body).at(-1), '5 dakikaya!');

    // Ayrılan kişi odayı artık göremez.
    await b.post('/api/checkins', SPOTS.modaSahil);
    assert.equal((await b.get('/api/places/ist-kadikoy-iskele/room')).data.error, 'not_here');

    // Engellenen kişinin mesajları görünmez.
    await a.post('/api/users/oda_b/block');
    assert.ok((await a.get('/api/places/ist-kadikoy-iskele/room')).data.room.messages.every((m) => m.author !== 'oda_b'));

    srv.db.prepare('UPDATE room_messages SET created_at = created_at - ?').run(srv.config.roomRetentionMs + 1000);
    assert.equal((await a.get('/api/places/ist-kadikoy-iskele/room')).data.room.messages.length, 0, 'eski mesajlar gösterilmez');
    assert.ok(purgeStaleData(srv.db, srv.config).rooms >= 2, 've silinir');
  });

  test('odaya gelen mesaj, mekândaki diğer kişilere canlı iletilir', async () => {
    const a = client(srv.base);
    const b = client(srv.base);
    await a.register('canli_a');
    await b.register('canli_b');
    await a.post('/api/checkins', SPOTS.modaSahil);
    await b.post('/api/checkins', SPOTS.modaSahil);
    const login = await fetch(`${srv.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: 'canli_b', password: 'gizli-parola-123' }) });
    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    const ac = new AbortController();
    const stream = await fetch(`${srv.base}/api/events`, { headers: { cookie }, signal: ac.signal });
    const reader = stream.body.getReader();
    await a.post('/api/places/ist-moda-sahil/room', { body: 'Gün batımı başlıyor!' });
    let text = '';
    while (!text.includes('event: room')) text += new TextDecoder().decode((await reader.read()).value);
    assert.match(text, /Gün batımı başlıyor!/);
    ac.abort();
  });
});
