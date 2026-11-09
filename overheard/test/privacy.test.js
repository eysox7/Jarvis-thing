import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client, SPOTS } from './helpers.js';
import { purgeStaleData } from '../server/domain.js';

describe('Kişisel veriler (KVKK/GDPR)', () => {
  let srv;
  before(async () => { srv = await startTestServer({ demo: true }); });
  after(async () => { await srv.close(); });

  async function scene() {
    const tag = Math.random().toString(36).slice(2, 7);
    const me = client(srv.base);
    const other = client(srv.base);
    await me.register(`veri_${tag}`);
    await other.register(`karsi_${tag}`);
    const { id } = (await me.post('/api/overheards', { text: 'Verilerimde görünmeli.', ...SPOTS.kadikoyIskele })).data.overheard;
    await other.post('/api/checkins', SPOTS.kadikoyIskele);
    const conv = (await other.post(`/api/overheards/${id}/messages`, { body: 'Merhaba!' })).data.conversationId;
    await me.post(`/api/conversations/${conv}/messages`, { body: 'Selam!' });
    return { tag, me, other, id, conv };
  }

  test('verilerimi indir: tüm kişisel veriler tek JSON dosyası', async () => {
    const { tag, me, id } = await scene();
    const cookie = await (async () => {
      const r = await fetch(`${srv.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: `veri_${tag}`, password: 'gizli-parola-123' }) });
      return r.headers.getSetCookie()[0].split(';')[0];
    })();
    const res = await fetch(`${srv.base}/api/me/export`, { headers: { cookie } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="overheard-verilerim.json"/);
    const data = await res.json();
    assert.equal(data.user.handle, `veri_${tag}`);
    assert.ok(data.user.termsAcceptedAt, 'onay zamanı kayıtlı');
    assert.deepEqual(data.overheards.map((o) => o.id), [id]);
    assert.ok(data.checkins.some((c) => c.place === 'Kadıköy İskelesi'));
    assert.ok(data.lastLocation);
    assert.deepEqual(data.conversations[0].messages.map((m) => [m.body, m.fromMe]), [['Merhaba!', false], ['Selam!', true]]);
    assert.equal((await client(srv.base).get('/api/me/export')).status, 401);
    assert.ok(me);
  });

  test('hesabımı sil: parola ister, tüm verileri ve oturumu siler', async () => {
    const { tag, me, other, id, conv } = await scene();
    assert.equal((await me.post('/api/me/delete', { password: 'yanlis-parola' })).status, 401);
    const del = await me.post('/api/me/delete', { password: 'gizli-parola-123' });
    assert.equal(del.status, 200);
    assert.equal((await me.get('/api/me')).data.user, null, 'oturum kapandı');
    assert.equal((await client(srv.base).post('/api/auth/login', { handle: `veri_${tag}`, password: 'gizli-parola-123' })).status, 401);
    assert.equal((await other.get(`/api/overheards/${id}`)).status, 404, 'sözleri silindi');
    assert.equal((await other.get(`/api/conversations/${conv}`)).status, 404, 'konuşmaları silindi');
    const leftovers = srv.db.prepare('SELECT COUNT(*) AS n FROM checkins WHERE user_id NOT IN (SELECT id FROM users)').get().n;
    assert.equal(leftovers, 0, 'sahipsiz check-in kalmaz');
    // Kullanıcı adı yeniden kullanılabilir.
    await client(srv.base).register(`veri_${tag}`);
  });

  test('yabancı anahtar denetimi kapalıyken de (Turso) silinen hesaptan geriye hiçbir satır kalmaz', async () => {
    const { tag, me, other, id } = await scene();
    const theirs = (await other.post('/api/overheards', { text: 'Karşı tarafın sözü kalmalı.', ...SPOTS.kadikoyIskele })).data.overheard.id;
    await me.post('/api/checkins', SPOTS.kadikoyIskele);
    assert.equal((await me.post(`/api/overheards/${theirs}/reactions`, { kind: 'lol' })).status, 200);
    assert.equal((await other.post(`/api/overheards/${id}/reactions`, { kind: 'lol' })).status, 200);
    assert.equal((await me.post(`/api/overheards/${theirs}/report`, { reason: 'spam' })).status, 200);
    assert.equal((await me.post(`/api/users/karsi_${tag}/block`)).status, 200);
    const userId = srv.db.prepare('SELECT id FROM users WHERE handle = ?').get(`veri_${tag}`).id;
    srv.db.exec('PRAGMA foreign_keys = OFF');
    try {
      assert.equal((await me.post('/api/me/delete', { password: 'gizli-parola-123' })).status, 200);
      // Hiçbir tabloda var olmayan bir satıra işaret eden kayıt yok (sahipsiz tepki, mesaj, oturum...).
      assert.deepEqual(srv.db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(userId).n, 0);
      assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM reactions WHERE overheard_id = ?').get(id).n, 0, 'sözüne gelen tepkiler de gider');
    } finally {
      srv.db.exec('PRAGMA foreign_keys = ON');
    }
    // Karşı tarafın sözü ve hesabı yerinde.
    assert.equal((await other.get(`/api/overheards/${theirs}`)).status, 200);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM reactions WHERE overheard_id = ?').get(theirs).n, 0);
  });

  test('misafir hesabı parolasız silinir', async () => {
    const guest = client(srv.base);
    await guest.post('/api/auth/guest');
    assert.equal((await guest.post('/api/me/delete', {})).status, 200);
    assert.equal((await guest.get('/api/me')).data.user, null);
  });

  test('kesin konum 24 saatten, şüpheli kayıtlar 90 günden uzun saklanmaz', async () => {
    const u = client(srv.base);
    await u.register('saklama_testi');
    await u.post('/api/checkins', SPOTS.modaSahil);
    const { id } = srv.db.prepare("SELECT id FROM users WHERE handle = 'saklama_testi'").get();
    srv.db.prepare("INSERT INTO location_flags (user_id, reason, at) VALUES (?, 'impossible_travel', ?)").run(id, Date.now() - 91 * 86400000);
    let r = purgeStaleData(srv.db, srv.config);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM location_reports WHERE user_id = ?').get(id).n, 1, 'taze konum kalır');
    assert.ok(r.flags >= 1);
    srv.db.prepare('UPDATE location_reports SET at = ? WHERE user_id = ?').run(Date.now() - 25 * 3600000, id);
    r = purgeStaleData(srv.db, srv.config);
    assert.ok(r.locations >= 1);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM location_reports WHERE user_id = ?').get(id).n, 0);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?').get(id).n, 1, 'mekân düzeyindeki check-in kalır');
  });
});
