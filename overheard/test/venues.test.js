import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client } from './helpers.js';

const CAFE = 'ist-bahariye';
const MIN = 60000;

describe('Overheard Kafe', () => {
  let srv;
  let mod;
  let staff;
  let stranger;
  let authorId;
  const texts = {};
  before(async () => {
    srv = await startTestServer({ admins: ['kafe_mod'] });
    mod = client(srv.base);
    await mod.register('kafe_mod');
    staff = client(srv.base);
    await staff.register('kafe_garson');
    stranger = client(srv.base);
    await stranger.register('kafe_yabanci');
    const author = client(srv.base);
    await author.register('kafe_yazar');
    authorId = srv.db.prepare("SELECT id FROM users WHERE handle = 'kafe_yazar'").get().id;

    const now = Date.now();
    const insert = srv.db.prepare('INSERT INTO overheards (id, user_id, place_id, text, created_at, visibility, hidden, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const add = (id, place, ageMin, { visibility = 'local', hidden = 0, expiresAt = null } = {}) => {
      texts[id] = `Söz ${id}: "${place} hakkında bir cümle"`;
      insert.run(id, authorId, place, texts[id], now - ageMin * MIN, visibility, hidden, expiresAt);
    };
    // Kafenin kendi sözleri.
    add('ic1', CAFE, 60);
    add('ic2', CAFE, 120, { visibility: 'public' });
    add('ic_yeni', CAFE, 5); // çok yeni: yazanı ele vermesin
    add('ic_gizli', CAFE, 90, { hidden: 1 });
    add('ic_sikayet', CAFE, 90);
    add('ic_suresi', CAFE, 90, { expiresAt: now - MIN });
    srv.db.prepare("INSERT INTO reports (overheard_id, user_id, reason, created_at) VALUES ('ic_sikayet', ?, 'spam', ?)").run(authorId, now);
    // Yakın çevre (1,5 km içinde) ve uzak.
    add('yakin1', 'ist-kadikoy-iskele', 30, { visibility: 'public' });
    add('yakin2', 'ist-moda-sahil', 300, { visibility: 'public' });
    add('yakin_yerel', 'ist-kadikoy-iskele', 30);
    add('uzak', 'ist-galata', 30, { visibility: 'public' });
  });
  after(async () => { await srv.close(); });

  const jobs = async () => (await staff.get(`/api/venues/${CAFE}/jobs`)).data.jobs;
  const idOf = (text) => Object.keys(texts).find((k) => texts[k] === text);

  test('moderatör mekânı kafe yapar ve personel ekler; panel yalnızca personele açık', async () => {
    assert.equal((await stranger.post(`/api/admin/venues/${CAFE}`, {})).status, 403);
    const r = await mod.post(`/api/admin/venues/${CAFE}`, { mode: 'inside' });
    assert.equal(r.data.venue.name, 'Bahariye Caddesi');
    assert.equal(r.data.venue.mode, 'inside');
    const added = await mod.post(`/api/admin/venues/${CAFE}/staff`, { handle: 'kafe_garson' });
    assert.deepEqual(added.data.venues[0].staff, ['kafe_garson']);
    assert.equal((await mod.post(`/api/admin/venues/${CAFE}/staff`, { handle: 'yok_boyle' })).data.error, 'user_not_found');

    assert.deepEqual((await staff.get('/api/me')).data.venues.map((v) => v.placeId), [CAFE]);
    assert.equal((await stranger.get(`/api/venues/${CAFE}`)).data.error, 'staff_only');
    assert.equal((await stranger.get(`/api/venues/${CAFE}/jobs`)).status, 403);
    // Haritada kafe olarak işaretli.
    const map = await stranger.get('/api/cities/istanbul/map');
    assert.equal(map.data.places.find((p) => p.id === CAFE).cafe, true);
    assert.equal(map.data.places.find((p) => p.id === 'ist-galata').cafe, false);
  });

  test('kafe içi mod: masa açılınca uygun bir söz yazıcıya gider; yenisi, gizlisi, şikâyetlisi gitmez', async () => {
    const state = await staff.get(`/api/venues/${CAFE}`);
    assert.equal(state.data.available, 2);
    const opened = await staff.post(`/api/venues/${CAFE}/tables`, { tableNo: '7' });
    assert.equal(opened.data.queued, true);
    assert.equal(opened.data.state.tables[0].tableNo, '7');
    assert.equal((await staff.post(`/api/venues/${CAFE}/tables`, { tableNo: '7' })).data.error, 'table_open');

    const tableId = opened.data.tableId;
    assert.equal((await staff.post(`/api/venues/${CAFE}/tables/${tableId}/print`)).status, 200);
    // İkisi de basıldı; aynı masaya aynı söz iki kez gitmez.
    assert.equal((await staff.post(`/api/venues/${CAFE}/tables/${tableId}/print`)).data.error, 'no_content');
    const pending = await jobs();
    assert.deepEqual(pending.map((j) => idOf(j.text)).sort(), ['ic1', 'ic2']);
    for (const j of pending) {
      assert.equal(j.tableNo, '7');
      assert.equal(j.inside, true);
      assert.equal(j.author, undefined);
      assert.doesNotMatch(JSON.stringify(j), /kafe_yazar/);
    }
    const r = await staff.get(`/api/venues/${CAFE}/jobs`);
    assert.match(r.data.qr.url, new RegExp(`\\?qr=${CAFE}\\.`));
    assert.match(r.data.qr.svg, /^<svg/);
  });

  test('basılan fiş kuyruktan düşer; masa kapanınca bekleyenler iptal olur', async () => {
    const [first] = await jobs();
    await staff.post(`/api/venues/${CAFE}/jobs/${first.id}/printed`);
    const rest = await jobs();
    assert.equal(rest.length, 1);
    const state = (await staff.get(`/api/venues/${CAFE}`)).data;
    assert.deepEqual([state.tables[0].printed, state.tables[0].pending], [1, 1]);
    await staff.post(`/api/venues/${CAFE}/tables/${state.tables[0].id}/close`);
    assert.deepEqual(await jobs(), []);
    assert.deepEqual((await staff.get(`/api/venues/${CAFE}`)).data.tables, []);
  });

  test('yakın çevre modu: yalnızca yakın mekânların herkese açık sözleri', async () => {
    const s = await staff.post(`/api/venues/${CAFE}/settings`, { mode: 'nearby' });
    assert.equal(s.data.venue.mode, 'nearby');
    assert.equal(s.data.available, 2);
    const { data } = await staff.post(`/api/venues/${CAFE}/tables`, { tableNo: 'Bahçe 3' });
    await staff.post(`/api/venues/${CAFE}/tables/${data.tableId}/print`);
    assert.equal((await staff.post(`/api/venues/${CAFE}/tables/${data.tableId}/print`)).data.error, 'no_content');
    const pending = await jobs();
    assert.deepEqual(pending.map((j) => idOf(j.text)).sort(), ['yakin1', 'yakin2']);
    for (const j of pending) {
      assert.equal(j.inside, false);
      assert.ok(j.distanceM > 0 && j.distanceM <= 1500);
    }
    await staff.post(`/api/venues/${CAFE}/tables/${data.tableId}/close`);
  });

  test('açık masaya aralıklarla yeni fiş basılır, sınıra kadar; yazıcıya canlı haber gider', async () => {
    await staff.post(`/api/venues/${CAFE}/settings`, { mode: 'nearby', everyMin: 5, perTable: 2 });
    const published = [];
    const original = srv.events.publish;
    srv.events.publish = (userId, type, data) => {
      published.push({ userId, type, data });
      return original.call(srv.events, userId, type, data);
    };
    try {
      const { data } = await staff.post(`/api/venues/${CAFE}/tables`, { tableNo: '12' });
      const staffId = srv.db.prepare("SELECT id FROM users WHERE handle = 'kafe_garson'").get().id;
      assert.deepEqual(published.at(-1), { userId: staffId, type: 'print', data: { placeId: CAFE } });

      assert.equal(srv.tickVenues().size, 0); // henüz 5 dk olmadı
      srv.db.prepare('UPDATE print_jobs SET created_at = created_at - ? WHERE table_id = ?').run(6 * MIN, data.tableId);
      assert.equal(srv.tickVenues().get(CAFE), 1);
      srv.db.prepare('UPDATE print_jobs SET created_at = created_at - ? WHERE table_id = ?').run(6 * MIN, data.tableId);
      assert.equal(srv.tickVenues().size, 0); // masa başına 2 fiş sınırı
      assert.equal((await jobs()).filter((j) => j.tableNo === '12').length, 2);
    } finally {
      srv.events.publish = original;
    }
  });

  test('kapatılması unutulan masa kendiliğinden kapanır', async () => {
    const before = (await staff.get(`/api/venues/${CAFE}`)).data.tables;
    assert.equal(before.length, 1);
    srv.db.prepare('UPDATE venue_tables SET opened_at = opened_at - ? WHERE closed_at IS NULL').run(srv.config.venueTableMaxMs + MIN);
    srv.tickVenues();
    assert.deepEqual((await staff.get(`/api/venues/${CAFE}`)).data.tables, []);
  });

  test('personel çıkarılınca ve kafe kaldırılınca erişim biter', async () => {
    await mod.del(`/api/admin/venues/${CAFE}/staff/kafe_garson`);
    assert.equal((await staff.get(`/api/venues/${CAFE}`)).data.error, 'staff_only');
    assert.deepEqual((await staff.get('/api/me')).data.venues, []);
    assert.equal((await mod.del(`/api/admin/venues/${CAFE}`)).status, 200);
    assert.equal((await mod.get(`/api/venues/${CAFE}`)).data.error, 'venue_not_found');
  });
});
