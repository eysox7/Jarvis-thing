import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { startTestServer, client, SPOTS } from './helpers.js';
import { createAiModerator } from '../server/ai-moderation.js';
import { loadConfig } from '../server/config.js';

// Claude API'nin yerine geçen sahte istemci: metindeki işarete göre karar verir, istekleri kaydeder.
// "#block:<kategori>" → engelle, "#ratelimit" / "#timeout" / "#refusal" / "#garbage" → ilgili durum.
function fakeClient() {
  const calls = [];
  const respond = async (params, options) => {
    calls.push({ params, options });
    const text = params.messages[0].content;
    if (text.includes('#ratelimit')) throw new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error' } }, 'rate limited', new Headers());
    if (text.includes('#timeout')) throw new Anthropic.APIConnectionTimeoutError();
    if (text.includes('#autherror')) throw new Anthropic.AuthenticationError(401, { type: 'error' }, 'bad key', new Headers());
    if (text.includes('#refusal')) return { stop_reason: 'refusal', content: [] };
    if (text.includes('#garbage')) return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] };
    const m = text.match(/#block:(\w+)/);
    const verdict = m ? { decision: 'block', category: m[1] } : { decision: 'allow', category: 'none' };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(verdict) }] };
  };
  return {
    calls,
    messages: { create: (params, options) => respond({ ...params, beta: false }, options) },
    beta: { messages: { create: (params, options) => respond({ ...params, beta: true }, options) } },
  };
}

const KADIKOY = { ...SPOTS.kadikoyIskele, accuracy: 10 };

describe('Yapay zekâ denetimi', () => {
  let srv;
  let fake;
  let ai;
  let alice;
  before(async () => {
    fake = fakeClient();
    ai = await createAiModerator(loadConfig({ aiModeration: true, aiModel: 'claude-opus-5-5', aiFallbacks: true, aiTimeoutMs: 5000 }), { client: fake });
    srv = await startTestServer({ ai, admins: ['ai_mod'] });
    alice = client(srv.base);
    await alice.register('ai_alice');
    await alice.post('/api/checkins', KADIKOY);
  });
  after(async () => { await srv.close(); });
  beforeEach(() => { fake.calls.length = 0; });

  const post = (text, extra = {}) => alice.post('/api/overheards', { text, ...KADIKOY, placeId: 'ist-kadikoy-iskele', ...extra });
  const stored = (text) => srv.db.prepare('SELECT COUNT(*) AS n FROM overheards WHERE text LIKE ?').get(`%${text}%`).n;

  test('istek Claude API kurallarına uygun: model, düşük çaba, JSON şeması, yedek model, süre sınırı', async () => {
    const r = await post('Vapurda biri "simit martıların hakkı" dedi');
    assert.equal(r.status, 200);
    assert.equal(fake.calls.length, 1);
    const { params, options } = fake.calls[0];
    assert.equal(params.beta, true);
    assert.equal(params.model, 'claude-opus-5-5');
    assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
    assert.equal(params.fallbacks, 'default');
    assert.equal(params.output_config.effort, 'low');
    assert.equal(params.output_config.format.type, 'json_schema');
    assert.deepEqual(params.output_config.format.schema.properties.decision.enum, ['allow', 'block']);
    assert.equal(params.thinking, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    // Yalnızca metin gider: kullanıcı adı ya da konum yok.
    const sent = JSON.stringify(params.messages);
    assert.match(sent, /simit martıların hakkı/);
    assert.doesNotMatch(sent, /ai_alice|40\.99|29\.02/);
  });

  test('kişiyi tanınır kılan söz yayımlanmaz ve nedeni söylenir', async () => {
    const r = await post('3. kattaki muhasebeci Ayşe Yılmaz yine geç kaldı #block:personal_info');
    assert.equal(r.status, 422);
    assert.equal(r.data.error, 'flagged_personal_info');
    assert.equal(stored('Ayşe Yılmaz'), 0);
  });

  test('yeni mekân adı da denetlenir', async () => {
    const r = await alice.post('/api/overheards', { text: 'Burada çay bedava dediler', ...SPOTS.istanbulNowhere, accuracy: 10, newPlaceName: 'Bedava kripto için tıkla #block:spam' });
    assert.equal(r.data.error, 'flagged_spam');
    assert.equal(fake.calls.length, 2);
    assert.ok(fake.calls.some((c) => c.params.messages[0].content.startsWith('Name for a new place')));
  });

  test('servis hatası, hız sınırı ya da zaman aşımı yayını durdurmaz (kelime listesi yine çalışır)', async () => {
    for (const tag of ['#ratelimit', '#timeout', '#garbage', '#autherror']) {
      const r = await post(`Kasada biri "${tag} bozuk param yok" dedi`);
      assert.equal(r.status, 200, tag);
    }
    // Listedeki nefret sözü için Claude'a hiç sorulmaz; alan katmanı reddeder.
    fake.calls.length = 0;
    const slur = await post('bu bir deneme ibne sözü');
    assert.equal(slur.data.error, 'content_blocked');
    assert.equal(fake.calls.length, 0);
  });

  test('tüm zincir reddederse yayımlanmaz', async () => {
    const r = await post('Sınıflandırılamayan bir söz #refusal');
    assert.equal(r.data.error, 'flagged_refused');
  });

  test('mekân odası mesajları denetlenir; özel mesajlar denetlenmez', async () => {
    const r = await alice.post('/api/places/ist-kadikoy-iskele/room', { body: 'Seni dışarıda bekliyorum, göreceksin #block:threat' });
    assert.equal(r.data.error, 'flagged_threat');
    assert.equal((await alice.post('/api/places/ist-kadikoy-iskele/room', { body: 'Vapur kaçta?' })).status, 200);

    // Oda dışındaki biri için Claude'a hiç sorulmaz.
    const bob = client(srv.base);
    await bob.register('ai_bob');
    fake.calls.length = 0;
    assert.equal((await bob.post('/api/places/ist-kadikoy-iskele/room', { body: 'merhaba' })).data.error, 'not_here');
    assert.equal(fake.calls.length, 0);

    const { data } = await post('Martı simidi kaptı, herkes alkışladı', { visibility: 'public' });
    fake.calls.length = 0;
    const dm = await bob.post(`/api/overheards/${data.overheard.id}/messages`, { body: 'Ben de oradaydım! #block:harassment' });
    assert.equal(dm.status, 200);
    assert.equal(fake.calls.length, 0);
  });

  test('moderatör panelinde durum ve sayaçlar', async () => {
    const mod = client(srv.base);
    await mod.register('ai_mod');
    const r = await mod.get('/api/admin/reports');
    assert.equal(r.data.ai.enabled, true);
    assert.equal(r.data.ai.model, 'claude-opus-5-5');
    assert.ok(r.data.ai.reviewed >= 5);
    assert.ok(r.data.ai.blocked >= 3);
    assert.ok(r.data.ai.failed >= 4);
    assert.equal((await mod.get('/api/config')).data.aiModeration, true);
  });
});

describe('Yapay zekâ denetimi yapılandırması', () => {
  test('anahtar yoksa kapalı; kapalıyken her şey eskisi gibi', async () => {
    assert.equal(await createAiModerator(loadConfig({ aiModeration: false })), null);
    const srv = await startTestServer();
    try {
      assert.equal((await client(srv.base).get('/api/config')).data.aiModeration, false);
    } finally {
      await srv.close();
    }
  });

  test('yedek model kapatılırsa beta olmayan uç kullanılır', async () => {
    const fake = fakeClient();
    const ai = await createAiModerator(loadConfig({ aiModeration: true, aiFallbacks: false, aiModel: 'claude-haiku-5-5' }), { client: fake });
    assert.deepEqual(await ai.review('Simitçi "taze" dedi', 'overheard'), { decision: 'allow', category: 'none', reviewed: true });
    assert.equal(fake.calls[0].params.beta, false);
    assert.equal(fake.calls[0].params.fallbacks, undefined);
    assert.equal(fake.calls[0].params.model, 'claude-haiku-5-5');
  });

  test('beklenmeyen programlama hataları yutulmaz', async () => {
    const broken = { beta: { messages: { create: async () => { throw new TypeError('bug'); } } } };
    const ai = await createAiModerator(loadConfig({ aiModeration: true }), { client: broken });
    await assert.rejects(ai.review('deneme sözü'), TypeError);
  });
});
