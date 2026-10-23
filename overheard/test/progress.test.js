import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client, SPOTS } from './helpers.js';

describe('Keşif ilerlemesi ve rozetler', () => {
  let srv;
  before(async () => { srv = await startTestServer(); });
  after(async () => { await srv.close(); });

  test('eylemler rozet kazandırır ve /api/me ilerlemeyi gösterir', async () => {
    const tag = Math.random().toString(36).slice(2, 7);
    const me = client(srv.base);
    const other = client(srv.base);
    await me.register(`kasif_${tag}`);
    await other.register(`diger_${tag}`);

    let progress = (await me.get('/api/me')).data.progress;
    assert.ok(progress.badges.every((b) => !b.earned));
    assert.equal(progress.metrics.streak, 0);

    const first = await me.post('/api/checkins', SPOTS.kadikoyIskele);
    assert.deepEqual(first.data.newBadges, ['first_step']);
    assert.deepEqual((await me.post('/api/checkins', SPOTS.kadikoyIskele)).data.newBadges, []);

    // Kadıköy İskelesi'nin ilk sözü: öncü rozeti de gelir.
    const posted = await me.post('/api/overheards', { text: 'Rozet avcısı iş başında.', ...SPOTS.kadikoyIskele });
    assert.deepEqual(posted.data.newBadges, ['first_drop', 'pioneer']);
    assert.equal(posted.data.overheard.pioneer, true);

    // Başkasının sözüne "ben de duydum" ve mesaj. İkinci söz öncü değildir.
    const second = (await other.post('/api/overheards', { text: 'Aynı anda buradaydık.', ...SPOTS.kadikoyIskele })).data;
    assert.equal(second.overheard.pioneer, false);
    assert.deepEqual(second.newBadges, ['first_step', 'first_drop']);
    const { id } = second.overheard;
    assert.deepEqual((await me.post(`/api/overheards/${id}/reactions`, { kind: 'same' })).data.newBadges, ['witness']);
    assert.deepEqual((await me.post(`/api/overheards/${id}/messages`, { body: 'Merhaba!' })).data.newBadges, ['connector']);

    progress = (await me.get('/api/me')).data.progress;
    const istanbul = progress.cities.find((c) => c.cityId === 'istanbul');
    assert.equal(istanbul.visited, 1);
    assert.ok(istanbul.total >= 12);
    assert.equal(progress.metrics.streak, 1);
    assert.equal(progress.metrics.weekPlaces, 1);
    const explorer = progress.badges.find((b) => b.id === 'explorer');
    assert.deepEqual([explorer.earned, explorer.n, explorer.of], [false, 1, 5]);

    await me.post('/api/checkins', SPOTS.austin6th);
    progress = (await me.get('/api/me')).data.progress;
    assert.ok(progress.badges.find((b) => b.id === 'two_cities').earned);
  });

  test('haftalık seri ardışık haftaları sayar, boşlukta durur', async () => {
    const tag = Math.random().toString(36).slice(2, 7);
    const me = client(srv.base);
    await me.register(`seri_${tag}`);
    const { id: userId } = srv.db.prepare('SELECT id FROM users WHERE handle = ?').get(`seri_${tag}`);
    const week = 7 * 86400000;
    const now = Date.now();
    const insert = srv.db.prepare("INSERT INTO checkins (user_id, place_id, at) VALUES (?, 'ist-moda-sahil', ?)");
    // Geçen hafta, iki ve dört hafta önce (üç hafta öncesi boş).
    for (const ago of [1, 2, 4]) insert.run(userId, now - ago * week);
    assert.equal((await me.get('/api/me')).data.progress.metrics.streak, 2, 'bu hafta henüz yokken geçen haftadan sayılır');
    insert.run(userId, now - 3 * week);
    assert.equal((await me.get('/api/me')).data.progress.metrics.streak, 4);
    const badge = (await me.get('/api/me')).data.progress.badges.find((b) => b.id === 'streak');
    assert.equal(badge.earned, true);
  });
});
