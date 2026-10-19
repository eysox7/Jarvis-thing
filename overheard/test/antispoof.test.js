import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client, SPOTS } from './helpers.js';

const BAHARIYE = { lat: 40.9878, lng: 29.0288 };

describe('Konum sahteciliğine karşı', () => {
  let srv;
  before(async () => { srv = await startTestServer({ antiSpoofing: true, maxUnlocksPerHour: 2, admins: ['mod_konum'] }); });
  after(async () => { await srv.close(); });

  const newUser = async (prefix) => {
    const c = client(srv.base);
    const handle = `${prefix}_${Math.random().toString(36).slice(2, 7)}`;
    await c.register(handle);
    return { c, handle, id: srv.db.prepare('SELECT id FROM users WHERE handle = ?').get(handle).id };
  };

  test('belirsiz konum mekân açmaz', async () => {
    const { c } = await newUser('belirsiz');
    const r = await c.post('/api/checkins', { ...SPOTS.kadikoyIskele, accuracy: 900 });
    assert.equal(r.data.blocked, 'low_accuracy');
    assert.deepEqual(r.data.places, []);
    assert.equal((await c.post('/api/checkins', { ...SPOTS.kadikoyIskele, accuracy: 20 })).data.places.length > 0, true);
  });

  test('imkânsız seyahat işaretlenir; zaman geçince aynı yolculuk kabul edilir', async () => {
    const { c, id } = await newUser('isinlanan');
    await c.post('/api/checkins', SPOTS.kadikoyIskele);
    const jump = await c.post('/api/checkins', SPOTS.austin6th);
    assert.equal(jump.data.blocked, 'impossible_travel');
    assert.deepEqual(jump.data.places, []);
    assert.equal((await c.post('/api/overheards', { text: 'Austin selam', ...SPOTS.austin6th })).data.error, 'impossible_travel');

    // 20 saat önce İstanbul'daymış gibi: ~10.000 km / 20 sa ≈ 500 km/sa, uçuşla mümkün.
    srv.db.prepare('UPDATE location_reports SET at = at - ? WHERE user_id = ?').run(20 * 3600000, id);
    const flight = await c.post('/api/checkins', SPOTS.austin6th);
    assert.equal(flight.data.blocked, undefined);
    assert.ok(flight.data.places.some((p) => p.id === 'aus-6th'));
  });

  test('günde üç şüpheli olaydan sonra check-in 24 saat mekân açmaz', async () => {
    const { c } = await newUser('supheli');
    await c.post('/api/checkins', SPOTS.kadikoyIskele);
    for (let i = 0; i < 3; i++) assert.equal((await c.post('/api/checkins', SPOTS.austin6th)).data.blocked, 'impossible_travel');
    assert.equal((await c.post('/api/checkins', SPOTS.kadikoyIskele)).data.blocked, 'location_cooldown');
  });

  test('saatte çok fazla yeni mekân açılamaz', async () => {
    const { c } = await newUser('hizli');
    assert.equal((await c.post('/api/checkins', SPOTS.kadikoyIskele)).data.places.length, 1);
    assert.equal((await c.post('/api/checkins', BAHARIYE)).data.places.length, 1);
    const third = await c.post('/api/checkins', SPOTS.modaSahil);
    assert.equal(third.data.blocked, 'unlock_burst');
    assert.deepEqual(third.data.places, []);
    // Daha önce açılan mekânlar etkilenmez.
    assert.equal((await c.post('/api/checkins', SPOTS.kadikoyIskele)).data.places[0].id, 'ist-kadikoy-iskele');
  });

  test('moderatör şüpheli konum olaylarını görür', async () => {
    const mod = client(srv.base);
    await mod.register('mod_konum');
    const { users } = (await mod.get('/api/admin/location-flags')).data;
    const flagged = users.find((u) => u.handle.startsWith('supheli_'));
    assert.ok(flagged.flags >= 3);
    assert.match(flagged.last, /impossible_travel/);
  });
});
