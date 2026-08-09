import { chromium } from 'playwright';

const fails = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✖ ') + m); if (!c) fails.push(m); };
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

const reqs = [];
const cap = (route, body, ct = 'application/json') => {
  const r = route.request();
  reqs.push({ url: r.url(), headers: r.headers(), body: JSON.parse(r.postData() || '{}') });
  return route.fulfill({ status: 200, contentType: ct, body });
};

const sse = (lines) => lines.map((l) => 'data: ' + l).join('\n\n') + '\n\ndata: [DONE]\n\n';

// --- openai (Groq) ---
await page.route('**/api.groq.com/**', (r) => r.request().url().includes('/models')
  ? cap(r, JSON.stringify({ data: [{ id: 'llama-3.3-70b' }, { id: 'zeta' }] }))
  : (r.request().postData().includes('"stream":true')
      ? cap(r, sse(['{"choices":[{"delta":{"content":"Mer"}}]}', '{"choices":[{"delta":{"content":"haba"}}]}']), 'text/event-stream')
      : cap(r, JSON.stringify({ choices: [{ message: { content: 'openai-tam' } }] }))));

// --- gemini ---
await page.route('**/generativelanguage.googleapis.com/**', (r) => r.request().url().includes(':streamGenerateContent')
  ? cap(r, sse(['{"candidates":[{"content":{"parts":[{"text":"Sel"}]}}]}', '{"candidates":[{"content":{"parts":[{"text":"am"}]}}]}']), 'text/event-stream')
  : r.request().url().includes(':generateContent')
    ? cap(r, JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gemini-tam' }] } }] }))
    : cap(r, JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed-1', supportedGenerationMethods: ['embedContent'] }] })));

// --- anthropic ---
await page.route('**/api.anthropic.com/**', (r) => r.request().postData()?.includes('"stream":true')
  ? cap(r, sse(['{"type":"content_block_delta","delta":{"text":"Ha"}}', '{"type":"content_block_delta","delta":{"text":"zır"}}']), 'text/event-stream')
  : cap(r, JSON.stringify({ content: [{ type: 'text', text: 'claude-tam' }] })));

// --- ollama (NDJSON, SSE değil) ---
await page.route('**/localhost:11434/**', (r) => r.request().url().includes('/api/tags')
  ? cap(r, JSON.stringify({ models: [{ name: 'llama3.2' }] }))
  : (r.request().postData().includes('"stream":true')
      ? cap(r, '{"message":{"content":"yer"}}\n{"message":{"content":"el"}}\n', 'application/x-ndjson')
      : cap(r, JSON.stringify({ message: { content: 'ollama-tam' } }))));

await page.route('**/api.openai.com/**', (r) => r.fulfill({
  status: 429, contentType: 'application/json',
  body: JSON.stringify({ error: { message: 'Rate limit reached' } }),
}));

await page.goto(process.env.BASE || 'http://127.0.0.1:8099', { waitUntil: 'networkidle' });

const P = {
  groq: { name: 'groq', provider: 'groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gk', model: 'llama-3.3-70b' },
  gemini: { name: 'gem', provider: 'gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'gemk', model: 'gemini-2.5-flash' },
  anthropic: { name: 'ant', provider: 'anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'antk', model: 'claude-sonnet-4-5' },
  ollama: { name: 'oll', provider: 'ollama', kind: 'ollama', baseUrl: 'http://localhost:11434', apiKey: '', model: 'llama3.2' },
};

const run = (fn, arg) => page.evaluate(async ({ fn, arg }) => {
  const M = await import('./js/providers.js');
  try { return { ok: true, v: await M[fn](...arg) }; } catch (e) { return { ok: false, v: e.message }; }
}, { fn, arg });

console.log('\n[A] Tam yanıt (non-streaming)');
for (const [k, expect] of [['groq', 'openai-tam'], ['gemini', 'gemini-tam'], ['anthropic', 'claude-tam'], ['ollama', 'ollama-tam']]) {
  const r = await run('chat', [P[k], { system: 'sis', messages: [{ role: 'user', content: 'selam' }], temperature: 0.3 }]);
  ok(r.ok && r.v.text === expect, `${k}: yanıt çözümlendi (${r.ok ? r.v.text : r.v})`);
}

console.log('\n[B] Akış (streaming)');
const streamed = await page.evaluate(async (P) => {
  const M = await import('./js/providers.js');
  const out = {};
  for (const k of ['groq', 'gemini', 'anthropic', 'ollama']) {
    const chunks = [];
    const r = await M.chat(P[k], { messages: [{ role: 'user', content: 'x' }], stream: true, onDelta: (d) => chunks.push(d) });
    out[k] = { text: r.text, parts: chunks.length };
  }
  return out;
}, P);
for (const [k, expect] of [['groq', 'Merhaba'], ['gemini', 'Selam'], ['anthropic', 'Hazır'], ['ollama', 'yerel']]) {
  ok(streamed[k].text === expect && streamed[k].parts === 2,
    `${k}: akış parça parça birleşti ("${streamed[k].text}", ${streamed[k].parts} parça)`);
}

console.log('\n[C] İstek gövdesi ve başlıklar');
const byUrl = (frag) => reqs.filter((r) => r.url.includes(frag));
const g = byUrl('api.groq.com/openai/v1/chat/completions')[0];
ok(g.headers.authorization === 'Bearer gk', 'openai: Bearer başlığı');
ok(g.body.messages[0].role === 'system' && g.body.messages[1].content === 'selam', 'openai: sistem + kullanıcı mesajı');
ok(g.body.temperature === 0.3, 'openai: sıcaklık geçti');

const ge = byUrl(':generateContent')[0];
ok(ge.url.includes('key=gemk'), 'gemini: anahtar sorgu dizesinde');
ok(ge.body.systemInstruction.parts[0].text === 'sis', 'gemini: systemInstruction ayrı alanda');
ok(ge.body.contents[0].role === 'user' && ge.body.generationConfig.temperature === 0.3, 'gemini: contents + generationConfig');

const an = byUrl('api.anthropic.com/v1/messages')[0];
ok(an.headers['x-api-key'] === 'antk' && an.headers['anthropic-version'] === '2023-06-01', 'anthropic: x-api-key + version');
ok(an.headers['anthropic-dangerous-direct-browser-access'] === 'true', 'anthropic: tarayıcıdan erişim başlığı');
ok(an.body.system === 'sis' && an.body.max_tokens > 0, 'anthropic: system ayrı + max_tokens zorunlu alanı dolu');

const ol = byUrl('localhost:11434/api/chat')[0];
ok(!ol.headers.authorization, 'ollama: gereksiz yetki başlığı yok');
ok(ol.body.messages[0].role === 'system', 'ollama: sistem mesajı gövdede');

console.log('\n[D] Model listesi');
for (const [k, expect] of [['groq', 2], ['gemini', 1], ['ollama', 1]]) {
  const r = await run('listModels', [P[k], '']);
  ok(r.ok && r.v.length === expect, `${k}: ${r.ok ? r.v.length : r.v} model (gemini embed modelini elemeli)`);
}

console.log('\n[E] Yedeğe geçiş (fallback)');
const fb = await page.evaluate(async (P) => {
  const M = await import('./js/providers.js');
  const bad = { ...P.gemini, name: 'bozuk', baseUrl: 'https://api.openai.com/v1', kind: 'openai', provider: 'openai' };
  const failed = [];
  const r = await M.chatWithFallback([bad, P.groq], {
    messages: [{ role: 'user', content: 'x' }],
    onProfileFail: (p, e) => failed.push(p.name + ': ' + e.message),
  });
  return { text: r.text, used: r.profile.name, failed };
}, P);
ok(fb.used === 'groq' && fb.text === 'openai-tam', 'ilk bağlantı çökünce yedeğe geçti');
ok(fb.failed[0].includes('429') || fb.failed[0].includes('Rate'), 'başarısız denemenin sebebi raporlandı: ' + fb.failed[0].slice(0, 60));

const allFail = await page.evaluate(async () => {
  const M = await import('./js/providers.js');
  try { await M.chatWithFallback([]); return 'hata yok'; } catch (e) { return e.message; }
});
ok(allFail.includes('API bağlantısı yok'), 'bağlantı yokken anlaşılır mesaj');

await browser.close();
console.log(fails.length ? `\n✖ ${fails.length} başarısız:\n- ` + fails.join('\n- ') : '\n✔ Tüm sağlayıcı testleri geçti');
process.exit(fails.length ? 1 : 0);
