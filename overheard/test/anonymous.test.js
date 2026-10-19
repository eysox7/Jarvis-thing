import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client, SPOTS } from './helpers.js';

describe('Anonim paylaşım', () => {
  let srv;
  before(async () => { srv = await startTestServer(); });
  after(async () => { await srv.close(); });

  async function scene() {
    const tag = Math.random().toString(36).slice(2, 7);
    const author = client(srv.base);
    const reader = client(srv.base);
    await author.register(`anon_${tag}`);
    await reader.register(`okur_${tag}`);
    const posted = await author.post('/api/overheards', { text: 'Bunu ben söylemedim, duydum.', anonymous: true, ...SPOTS.modaSahil });
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
    await reader.post('/api/checkins', SPOTS.modaSahil);
    return { tag, author, reader, id: posted.data.overheard.id, mine: posted.data.overheard };
  }

  test('yazarın adı başkalarına gizli, kendisine açık', async () => {
    const { tag, reader, id, mine } = await scene();
    assert.equal(mine.author, `anon_${tag}`);
    assert.equal(mine.anonymous, true);
    const seen = (await reader.get(`/api/overheards/${id}`)).data.overheard;
    assert.equal(seen.author, null);
    assert.equal(seen.anonymous, true);
    assert.equal(seen.canMessage, true);
    const map = await reader.get('/api/cities/istanbul/map');
    assert.ok(!JSON.stringify(map.data.overheards.find((o) => o.id === id)).includes(`anon_${tag}`));
  });

  test('konuşmada kimlik gizli kalır; sahibi isterse açar', async () => {
    const { tag, author, reader, id } = await scene();
    const sent = await reader.post(`/api/overheards/${id}/messages`, { body: 'Kimsin sen?' });
    const convId = sent.data.conversationId;

    assert.equal((await reader.get('/api/conversations')).data.conversations[0].with, null);
    const readerView = (await reader.get(`/api/conversations/${convId}`)).data.conversation;
    assert.equal(readerView.with, null);
    assert.equal(readerView.canReveal, false);

    const authorView = (await author.get(`/api/conversations/${convId}`)).data.conversation;
    assert.equal(authorView.with, `okur_${tag}`);
    assert.equal(authorView.canReveal, true);

    assert.equal((await reader.post(`/api/conversations/${convId}/reveal`)).data.error, 'nothing_to_reveal');
    const revealed = await author.post(`/api/conversations/${convId}/reveal`);
    assert.equal(revealed.status, 200);
    assert.equal(revealed.data.conversation.canReveal, false);
    assert.equal((await reader.get(`/api/conversations/${convId}`)).data.conversation.with, `anon_${tag}`);
    assert.equal((await author.post(`/api/conversations/${convId}/reveal`)).data.error, 'nothing_to_reveal');
  });

  test('anonim yazar kimliği açılmadan engellenebilir', async () => {
    const { reader, id } = await scene();
    assert.equal((await reader.post(`/api/overheards/${id}/block-author`)).status, 200);
    assert.equal((await reader.get(`/api/overheards/${id}`)).status, 404);
  });

  test('anonim yazar tanığa yazınca da adı gizli kalır', async () => {
    const tag = Math.random().toString(36).slice(2, 7);
    const author = client(srv.base);
    const witness = client(srv.base);
    await author.register(`gizli_${tag}`);
    await witness.register(`tanik_${tag}`);
    const { id } = (await author.post('/api/overheards', { text: 'Gizli kulak burada.', anonymous: true, ...SPOTS.kadikoyIskele })).data.overheard;
    await witness.post('/api/checkins', SPOTS.kadikoyIskele);
    await witness.post(`/api/overheards/${id}/reactions`, { kind: 'same' });
    const sent = await author.post(`/api/overheards/${id}/messages`, { body: 'Sen de duydun!', to: `tanik_${tag}` });
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    const view = (await witness.get(`/api/conversations/${sent.data.conversationId}`)).data.conversation;
    assert.equal(view.with, null);
  });
});
