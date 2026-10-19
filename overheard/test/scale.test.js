import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client, SPOTS } from './helpers.js';
import { CITY_OVERHEARD_LIMIT, BBOX_OVERHEARD_LIMIT } from '../server/domain.js';

describe('Ölçek: sayaçlar, görünür alan, sayfalama', () => {
  let srv;
  let author;
  let reader;
  const EXTRA = 350;

  before(async () => {
    srv = await startTestServer();
    author = client(srv.base);
    reader = client(srv.base);
    await author.register('kalabalik');
    await reader.register('okuyucu');
    // Moda'ya doğrudan çok sayıda söz ekle.
    await author.post('/api/checkins', SPOTS.modaSahil);
    const { id: userId } = srv.db.prepare("SELECT id FROM users WHERE handle = 'kalabalik'").get();
    const insert = srv.db.prepare("INSERT INTO overheards (id, user_id, place_id, text, created_at) VALUES (?, ?, 'ist-moda-sahil', ?, ?)");
    const now = Date.now();
    srv.db.exec('BEGIN');
    for (let i = 0; i < EXTRA; i++) insert.run(`bulk${i}`, userId, `Toplu söz ${i}`, now - i * 1000);
    srv.db.exec('COMMIT');
  });
  after(async () => { await srv.close(); });

  test('mekân sayaçları liste sınırından bağımsızdır', async () => {
    const map = (await reader.get('/api/cities/istanbul/map')).data;
    assert.equal(map.overheards.length, CITY_OVERHEARD_LIMIT);
    assert.equal(map.truncated, true);
    assert.equal(map.places.find((p) => p.id === 'ist-moda-sahil').count, EXTRA);
  });

  test('görünür alan sorgusu kurallara uyar ve doğrulanır', async () => {
    const bbox = '29.02,40.975,29.035,40.987';
    let r = await reader.get(`/api/overheards?bbox=${bbox}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.overheards.length, BBOX_OVERHEARD_LIMIT);
    assert.ok(r.data.overheards.every((o) => o.locked && o.placeId === 'ist-moda-sahil'));
    await reader.post('/api/checkins', SPOTS.modaSahil);
    r = await reader.get(`/api/overheards?bbox=${bbox}`);
    assert.ok(r.data.overheards.every((o) => !o.locked));
    // Başka bölge boş döner; geçersiz ve çok büyük alanlar reddedilir.
    assert.equal((await reader.get('/api/overheards?bbox=-97.75,30.26,-97.73,30.27')).data.overheards.length, 0);
    assert.equal((await reader.get('/api/overheards?bbox=1,2,3')).data.error, 'bad_bbox');
    assert.equal((await reader.get('/api/overheards?bbox=28,40,30,42')).data.error, 'bbox_too_large');
  });

  test('mesajlar sayfalanır', async () => {
    const sent = await reader.post('/api/overheards/bulk0/messages', { body: 'mesaj 0' });
    const convId = sent.data.conversationId;
    const { id: readerId } = srv.db.prepare("SELECT id FROM users WHERE handle = 'okuyucu'").get();
    const insert = srv.db.prepare('INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)');
    for (let i = 1; i < 130; i++) insert.run(convId, readerId, `mesaj ${i}`, Date.now());
    const first = (await author.get(`/api/conversations/${convId}`)).data.conversation;
    assert.equal(first.messages.length, 100);
    assert.equal(first.hasMore, true);
    assert.equal(first.messages.at(-1).body, 'mesaj 129');
    const older = (await author.get(`/api/conversations/${convId}?before=${first.messages[0].id}`)).data.conversation;
    assert.equal(older.messages.length, 30);
    assert.equal(older.hasMore, false);
    assert.equal(older.messages[0].body, 'mesaj 0');
  });
});
