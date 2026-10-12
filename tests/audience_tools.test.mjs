// Kitle araçlarının ajan döngüsünde gerçek tarayıcıda uçtan uca çalışması.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const fails = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✖ ') + m); if (!c) fails.push(m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  if (localStorage.getItem('nexus.v1')) return;
  localStorage.setItem('nexus.v1', JSON.stringify({
    version: 1,
    settings: { activeProfile: 'p1', maxSteps: 6, temperature: 0, stream: false, autoApprove: false, lang: 'tr-TR' },
    profiles: [{ id: 'p1', name: 'TestGroq', provider: 'groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', model: 'test-model', enabled: true }],
    tasks: [], notes: [], memory: {}, reminders: [], chat: [],
  }));
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

// Sahte model: 1. tur kurum kaydeder, 2. tur tahmin + karşılaştırma, 3. tur bitirir.
let turn = 0;
const seen = [];
await page.route('**/api.groq.com/**', async (route) => {
  seen.push(JSON.parse(route.request().postData() || '{}'));
  turn++;
  const steps = {
    1: { plan: 'Belediyeyi kaydedeceğim.', actions: [{ tool: 'institution_save', args: { id: 'test_bb', ad: 'Test Belediyesi', tur: 'belediye', guvenilirlik: 0.7, kitle: { yerlesim: { metropol: 100, kent: 0, kirsal: 0 } } } }], done: false },
    2: { plan: 'Tahmin ve karşılaştırma.', actions: [
      { tool: 'audience_predict', args: { alan: 'kamu_hizmeti', kurum: 'test_bb', cerceve: 'sorumluluk', kanallar: ['sosyal', 'sms'], segment: ['yas'], n: 600 } },
      { tool: 'audience_compare', args: { varyantlar: [{ ad: 'umut', alan: 'cevre', kurum: 'stk', cerceve: 'umut' }, { ad: 'korku', alan: 'cevre', kurum: 'stk', cerceve: 'korku' }], n: 400 } },
      { tool: 'audience_catalog', args: { bolum: 'kurumlar' } },
    ], done: false },
    3: { actions: [], reply: 'Tahmin hazır.', done: true },
  };
  const content = JSON.stringify(steps[turn] || steps[3]);
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
});

await page.goto(BASE, { waitUntil: 'networkidle' });

console.log('\n[1] Sistem mesajında kitle araçları');
await page.fill('#input', 'belediyemizin duyurusunun kitle tepkisini tahmin et');
await page.click('#btnSend');
await page.waitForFunction(() => [...document.querySelectorAll('.msg.bot')].some((m) => m.textContent.includes('Tahmin hazır')), { timeout: 20000 });
const sys = seen[0].messages[0].content;
ok(['audience_predict', 'audience_compare', 'audience_optimize', 'audience_catalog', 'institution_save'].every((t) => sys.includes(t)), 'araç kataloğunda kitle araçları var');

console.log('\n[2] Araç kartları');
const badges = await page.locator('.card[data-tool] .badge.ok').count();
ok(badges === 4, `dört araç da başarılı (${badges})`);

console.log('\n[3] Kurum profili kalıcı ve tahmine bağlanıyor');
await page.evaluate(() => window.NEXUS.store.flush());
const store = await page.evaluate(() => JSON.parse(localStorage.getItem('nexus.v1')));
ok(store.audience?.institutions?.test_bb?.ad === 'Test Belediyesi', 'kurum depoya yazıldı');
const fb = seen[2].messages.map((m) => m.content).join('\n');
ok(fb.includes('Test Belediyesi'), 'tahmin kayıtlı kurum profiliyle yapıldı');
ok(fb.includes('hall_okuma_yuzde') && fb.includes('kuramlar'), 'tahmin sonucu modele geri beslendi');
ok(fb.includes('"kazanan"'), 'karşılaştırma kazananı geri beslendi');
ok(fb.includes('"kayitli"') && fb.includes('test_bb'), 'katalog kayıtlı kurumu listeliyor');
const segMatch = fb.match(/"yas": \{[\s\S]*?\}\s*\}/);
ok(!!segMatch, 'yaş segmenti döndü');

console.log('\n[4] Konsol');
ok(errors.length === 0, errors.length ? errors.join(' | ') : 'sayfa hatası yok');

await browser.close();
console.log(fails.length ? `\n✖ ${fails.length} test başarısız` : '\n✔ kitle araç testleri geçti');
process.exit(fails.length ? 1 : 0);
