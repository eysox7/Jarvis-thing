import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startTestServer, client, SPOTS } from './helpers.js';
import { MIGRATIONS, openDb } from '../server/db.js';

describe('"Ben de duydum" tanıkları', () => {
  let srv;
  before(async () => { srv = await startTestServer(); });
  after(async () => { await srv.close(); });

  async function scene() {
    const tag = Math.random().toString(36).slice(2, 7);
    const users = {};
    for (const role of ['author', 'w1', 'w2', 'late']) {
      users[role] = client(srv.base);
      await users[role].register(`${role}_${tag}`);
    }
    const { id } = (await users.author.post('/api/overheards', { text: 'Vapurda herkes aynı anda güldü.', ...SPOTS.kadikoyIskele })).data.overheard;
    await users.w1.post('/api/checkins', SPOTS.kadikoyIskele);
    await users.w2.post('/api/checkins', SPOTS.kadikoyIskele);
    return { id, tag, ...users };
  }

  test('yalnızca o sırada orada olan "ben de duydum" diyebilir', async () => {
    const { id, tag, w1, late, author } = await scene();
    const r = await w1.post(`/api/overheards/${id}/reactions`, { kind: 'same' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.overheard.witnesses, [`w1_${tag}`]);
    assert.equal(r.data.overheard.canMessageWitnesses, true);

    // Söz 5 saat önce bırakılmış olsun: şimdi gelen kişi okuyabilir ama tanık olamaz.
    srv.db.prepare('UPDATE overheards SET created_at = created_at - ? WHERE id = ?').run(5 * 3600000, id);
    srv.db.prepare('UPDATE checkins SET at = at - ? WHERE place_id = ? AND user_id IN (SELECT id FROM users WHERE handle IN (?, ?))')
      .run(5 * 3600000, 'ist-kadikoy-iskele', `author_${tag}`, `w1_${tag}`);
    await late.post('/api/checkins', SPOTS.kadikoyIskele);
    const view = await late.get(`/api/overheards/${id}`);
    assert.equal(view.data.overheard.locked, false);
    assert.equal(view.data.overheard.canWitness, false);
    assert.equal((await late.post(`/api/overheards/${id}/reactions`, { kind: 'same' })).data.error, 'not_same_time');
    assert.equal((await author.post(`/api/overheards/${id}/reactions`, { kind: 'same' })).data.error, 'not_same_time', 'sahibi kendi sözüne tanık olamaz');
    // Diğer tepkiler serbest.
    assert.equal((await late.post(`/api/overheards/${id}/reactions`, { kind: 'lol' })).status, 200);
  });

  test('tanıklar birbirine ve söz sahibine yazabilir; diğerleri tanıklara yazamaz', async () => {
    const { id, tag, author, w1, w2, late } = await scene();
    await w1.post(`/api/overheards/${id}/reactions`, { kind: 'same' });
    await w2.post(`/api/overheards/${id}/reactions`, { kind: 'same' });
    await late.post('/api/checkins', SPOTS.kadikoyIskele);

    const between = await w1.post(`/api/overheards/${id}/messages`, { body: 'Sen de mi duydun?', to: `w2_${tag}` });
    assert.equal(between.status, 200, JSON.stringify(between.data));
    const conv = (await w2.get(`/api/conversations/${between.data.conversationId}`)).data.conversation;
    assert.equal(conv.kind, 'witness');
    assert.equal(conv.with, `w1_${tag}`);

    // Tanık olmayan biri (late de o sırada oradaydı ama 👂 demedi) tanığa yazamaz.
    assert.equal((await late.post(`/api/overheards/${id}/messages`, { body: 'selam', to: `w1_${tag}` })).data.error, 'witness_only');
    // Tanık olmayan birine "tanık" diye yazılamaz.
    assert.equal((await w1.post(`/api/overheards/${id}/messages`, { body: 'selam', to: `late_${tag}` })).data.error, 'not_witness');

    // Söz sahibi tanığa yazar; tanık sonra sahibine yazınca aynı konuşma kullanılır.
    const fromAuthor = await author.post(`/api/overheards/${id}/messages`, { body: 'Siz de mi gülüyordunuz?', to: `w1_${tag}` });
    assert.equal(fromAuthor.status, 200, JSON.stringify(fromAuthor.data));
    const reply = await w1.post(`/api/overheards/${id}/messages`, { body: 'Evet!' });
    assert.equal(reply.data.conversationId, fromAuthor.data.conversationId);
    const list = (await w1.get('/api/conversations')).data.conversations;
    assert.equal(list.length, 2);
  });
});

describe('Veritabanı göçü', () => {
  test('v1 konuşmaları ve mesajları v2 göçünde korunur', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overheard-'));
    const path = join(dir, 'v1.db');
    try {
      const old = new DatabaseSync(path);
      old.exec(MIGRATIONS[0]);
      old.exec('PRAGMA user_version = 1');
      const now = Date.now();
      old.prepare("INSERT INTO users (id, handle, pass_hash, created_at) VALUES (1, 'a', 'x', ?), (2, 'b', 'x', ?)").run(now, now);
      old.prepare("INSERT INTO places (id, city_id, name, lat, lng, radius_m, created_at) VALUES ('p', 'istanbul', 'P', 41, 29, 100, ?)").run(now);
      old.prepare("INSERT INTO overheards (id, user_id, place_id, text, created_at) VALUES ('o', 1, 'p', 'metin', ?)").run(now);
      old.prepare("INSERT INTO conversations (id, overheard_id, owner_id, starter_id, created_at, last_at) VALUES ('c', 'o', 1, 2, ?, ?)").run(now, now);
      old.prepare("INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES ('c', 2, 'merhaba', ?)").run(now);
      old.close();

      const db = openDb(path);
      assert.equal(db.prepare('SELECT version FROM _schema_version').get().version, MIGRATIONS.length);
      assert.equal(db.prepare("SELECT kind FROM conversations WHERE id = 'c'").get().kind, 'author');
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = 'c'").get().n, 1);
      assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
