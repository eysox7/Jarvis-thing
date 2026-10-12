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
let surveyCalls = 0;
await page.route('**/api.groq.com/**', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  // Anket aracının persona çağrıları ayrı yanıtlanır
  if (body.messages?.[0]?.content?.includes('anket simülasyonu')) {
    surveyCalls++;
    const n = (body.messages.at(-1).content.split('PERSONALAR:')[1] || '').trim().split('\n').length;
    const content = JSON.stringify({ yanitlar: Array.from({ length: n }, (_, i) => ({ no: i + 1, tutum: 1, okuma: 'egemen', paylasir: true, gerekce: 'mantıklı' })) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
  }
  seen.push(body);
  turn++;
  const steps = {
    1: { plan: 'Belediyeyi kaydedeceğim.', actions: [{ tool: 'institution_save', args: { id: 'test_bb', ad: 'Test Belediyesi', tur: 'belediye', guvenilirlik: 0.7, kitle: { yerlesim: { metropol: 100, kent: 0, kirsal: 0 } } } }], done: false },
    2: { plan: 'Tahmin ve karşılaştırma.', actions: [
      { tool: 'audience_predict', args: { alan: 'kamu_hizmeti', kurum: 'test_bb', cerceve: 'sorumluluk', kanallar: ['sosyal', 'sms'], segment: ['yas'], n: 600 } },
      { tool: 'audience_compare', args: { varyantlar: [{ ad: 'umut', alan: 'cevre', kurum: 'stk', cerceve: 'umut' }, { ad: 'korku', alan: 'cevre', kurum: 'stk', cerceve: 'korku' }], n: 400 } },
      { tool: 'audience_catalog', args: { bolum: 'kurumlar' } },
      { tool: 'audience_survey', args: { metin: 'Yeni otobüs hatlarımız yarın başlıyor', kurum: 'test_bb', katilimci: 4 } },
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
ok(badges === 5, `beş araç da başarılı (${badges})`);
ok(surveyCalls === 1, `anket aracı modele persona panelini sordu (${surveyCalls})`);

console.log('\n[3] Kurum profili kalıcı ve tahmine bağlanıyor');
await page.evaluate(() => window.NEXUS.store.flush());
const store = await page.evaluate(() => JSON.parse(localStorage.getItem('nexus.v1')));
ok(store.audience?.institutions?.test_bb?.ad === 'Test Belediyesi', 'kurum depoya yazıldı');
const fb = seen[2].messages.map((m) => m.content).join('\n');
ok(fb.includes('Test Belediyesi'), 'tahmin kayıtlı kurum profiliyle yapıldı');
ok(fb.includes('hall_okuma_yuzde') && fb.includes('kuramlar'), 'tahmin sonucu modele geri beslendi');
ok(fb.includes('model_belirsizligi') && fb.includes('duyarlilik'), 'model belirsizliği varsayılan olarak modele iletildi');
ok(fb.includes('"kazanan"'), 'karşılaştırma kazananı geri beslendi');
ok(fb.includes('"kayitli"') && fb.includes('test_bb'), 'katalog kayıtlı kurumu listeliyor');
ok(fb.includes('okuma_eslesme_yuzde') && fb.includes('"katilimci": 4'), 'anket sonucu ve uyum metrikleri geri beslendi');
const segMatch = fb.match(/"yas": \{[\s\S]*?\}\s*\}/);
ok(!!segMatch, 'yaş segmenti döndü');

console.log('\n[4] Kitle sekmesi');
await page.click('#tabbar button[data-view="audience"]');
ok(await page.locator('#view-audience').isVisible(), 'kitle sekmesi açılıyor');
ok(await page.locator('#audInst option[value="@test_bb"]').count() === 1, 'kayıtlı kurum seçicide');
ok(await page.locator('#audScenario option').count() >= 11, 'senaryo listesi dolu');
await page.selectOption('#audScenario', 'deprem_tahliye');
ok((await page.inputValue('#audText')).includes('deprem') && (await page.inputValue('#audInst')) === 'belediye', 'senaryo formu dolduruyor');
ok(await page.locator('#audChannels .chip.on').count() === 3, 'senaryo kanalları seçili');
await page.selectOption('#audScenario', '');
await page.evaluate(() => document.querySelectorAll('#audChannels .chip.on').forEach((b) => b.click()));
await page.fill('#audText', 'Grip aşısı olmazsanız sevdiklerinizi riske atarsınız. Araştırmaya göre %40 daha az hastalanıyorsunuz.');
await page.selectOption('#audInst', 'kamu_bakanlik');
await page.click('#audChannels .chip[data-ch="tv"]');
await page.click('#btnAudPredict');
await page.waitForSelector('#audPrediction', { timeout: 15000 });
ok(await page.locator('#audPrediction .kpi').count() === 6, 'altı gösterge kutusu');
ok(await page.locator('#audPrediction .th-row').count() >= 18, 'tüm kuram katkıları çizildi');
ok(await page.locator('#audPrediction .hall span').count() === 3, 'Hall okuma çubuğu');
ok((await page.locator('#audPrediction .mu').textContent()).includes('Duyarlılık'), 'model belirsizliği kartı');
ok((await page.locator('#audPrediction').textContent()).includes('Sağlık'), 'alan metinden çıkarıldı (Sağlık)');
ok(await page.locator('#audPrediction .seg-table tr').count() === 7, 'yaş kırılım tablosu (6 grup)');
if (process.env.SHOT) { await page.screenshot({ path: process.env.SHOT }); await page.locator('#audPrediction').screenshot({ path: process.env.SHOT.replace('.png', '-sonuc.png') }); }
await page.click('#audLens button[data-l="ana_akim"]');
await page.click('#btnAudPredict');
await page.waitForFunction(() => document.querySelector('#audPrediction') && !document.querySelector('#audPrediction .hall'), { timeout: 15000 });
ok(await page.locator('#audPrediction .th-name.elestirel').count() === 0, 'ana akım mercekte eleştirel kuram yok');
await page.click('#btnAudOptimize');
await page.waitForSelector('#audOptimize', { timeout: 30000 });
ok(await page.locator('#audOptimize .seg-table').count() === 2, 'en iyi / kaçınılacak strateji tabloları');

console.log('\n[5] Konsol');
ok(errors.length === 0, errors.length ? errors.join(' | ') : 'sayfa hatası yok');

await browser.close();
console.log(fails.length ? `\n✖ ${fails.length} test başarısız` : '\n✔ kitle araç testleri geçti');
process.exit(fails.length ? 1 : 0);
