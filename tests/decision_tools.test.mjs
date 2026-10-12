// Karar araçlarının ajan döngüsünde uçtan uca çalışması (gerçek tarayıcı, sahte model).
import { chromium } from 'playwright';
import { simulateDataset } from '../js/decision/data.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const fails = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✖ ') + m); if (!c) fails.push(m); };

const SPEC = { alan: 'siyaset', baglam: { ekonomi_algisi: -0.3 }, secenekler: [
  { id: 'A', ad: 'İktidar', ekonomi: 0.4, kultur: 0.7, kimlik: 'sag', iktidar: true, lider: 0.6, anket: 0.4 },
  { id: 'B', ad: 'Muhalefet', ekonomi: -0.4, kultur: -0.4, kimlik: 'sol', lider: 0.5, anket: 0.3 },
  { id: 'X', ad: 'Oy kullanmama', tur: 'cekimser' }] };
// Kurumun "anket verisi": bilinen bir modelden üretilmiş 400 kişi → CSV
const rows = simulateDataset(SPEC, { theta: { yakinlik: 2.2, parti_kimligi: 0.9, katilmama: 1 }, asc: { A: 0.2, B: 0, X: -0.2 } }, { n: 400, seed: 2 });
const DIMS = ['yas', 'cinsiyet', 'egitim', 'gelir', 'ideoloji', 'dindarlik', 'kurumsal_guven'];
const CSV = [DIMS.join(';') + ';secim', ...rows.map((r) => DIMS.map((d) => r.p[d]).join(';') + ';' + r.secim)].join('\n');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  if (localStorage.getItem('nexus.v1')) return;
  localStorage.setItem('nexus.v1', JSON.stringify({
    version: 1,
    settings: { activeProfile: 'p1', maxSteps: 8, temperature: 0, stream: false, autoApprove: false, lang: 'tr-TR' },
    profiles: [{ id: 'p1', name: 'TestGroq', provider: 'groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', model: 'test-model', enabled: true }],
    tasks: [], notes: [], memory: {}, reminders: [], chat: [],
  }));
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

let turn = 0;
const seen = [];
await page.route('**/api.groq.com/**', async (route) => {
  seen.push(JSON.parse(route.request().postData() || '{}'));
  turn++;
  const steps = {
    1: { plan: 'Senaryoyu kaydedip veriyi yükleyeceğim.', actions: [
      { tool: 'decision_scenario_save', args: { id: 'secim26', ad: 'Seçim 2026', ...SPEC } },
    ], done: false },
    2: { plan: 'Veriyi yükle.', actions: [{ tool: 'decision_data_import', args: { senaryo: 'secim26', csv: CSV } }], done: false },
    3: { plan: 'Öğren.', actions: [{ tool: 'decision_learn', args: { senaryo: 'secim26' } }], done: false },
    4: { plan: 'Tahmin ve senaryo.', actions: [
      { tool: 'decision_predict', args: { senaryo: 'secim26', segment: ['ideoloji'] } },
      { tool: 'decision_whatif', args: { senaryo: 'secim26', degisiklik: { baglam: { ekonomi_algisi: 0.5 } } } },
      { tool: 'decision_catalog', args: {} },
    ], done: false },
    5: { actions: [], reply: 'Karar tahmini hazır.', done: true },
  };
  const content = JSON.stringify(steps[turn] || steps[5]);
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.fill('#input', 'seçim anketimizden oy tahmini yap');
await page.click('#btnSend');
await page.waitForFunction(() => [...document.querySelectorAll('.msg.bot')].some((m) => m.textContent.includes('Karar tahmini hazır')), { timeout: 60000 });

console.log('\n[1] Araçlar');
ok(['decision_predict', 'decision_learn', 'decision_data_import', 'decision_ensemble', 'decision_polls'].every((t) => seen[0].messages[0].content.includes(t)), 'sistem mesajında karar araçları');
ok(seen[0].messages[0].content.includes('TAHMİN İŞ AKIŞI'), 'sistem mesajında tahmin iş akışı rehberi');
const badges = await page.locator('.card[data-tool] .badge.ok').count();
ok(badges === 6, `altı araç da başarılı (${badges})`);

console.log('\n[2] Öğrenme ve kalıcılık');
await page.evaluate(() => window.NEXUS.store.flush());
const store = await page.evaluate(() => JSON.parse(localStorage.getItem('nexus.v1')));
ok(store.decision.datasets.secim26.rows.length === 400, 'veri seti kaydedildi (400 satır)');
ok(store.decision.models.secim26?.cv?.isabet_yuzde > 0, `model ve çapraz doğrulama kaydedildi (isabet %${store.decision.models.secim26?.cv?.isabet_yuzde})`);
const fb4 = seen[3].messages.map((m) => m.content).join('\n');
ok(fb4.includes('cogunluk_isabet_yuzde') && fb4.includes('veri_payi_yuzde'), 'öğrenme sonucu (doğrulama + kuram desteği) modele iletildi');
const fb5 = seen[4].messages.map((m) => m.content).join('\n');
ok(fb5.includes('veriden öğrenilmiş') && fb5.includes('"dogrulama"'), 'tahmin öğrenilmiş modelle ve doğrulama bilgisiyle yapıldı');
ok(fb5.includes('degisim_puan') && fb5.includes('"secim26"'), 'ne olur analizi ve katalog döndü');

console.log('\n[3] Karar sekmesi');
await page.click('#tabbar button[data-view="decision"]');
ok(await page.locator('#view-decision').isVisible(), 'karar sekmesi açılıyor');
ok(await page.locator('#decScenario option[value="kayit:secim26"]').count() === 1, 'kayıtlı senaryo ve modeli seçicide');
await page.selectOption('#decScenario', 'kayit:secim26');
await page.click('#btnDecPredict');
await page.waitForSelector('#decPrediction', { timeout: 20000 });
ok((await page.locator('#decPrediction').textContent()).includes('Görülmemiş veride isabet'), 'öğrenilmiş modelin doğrulama isabeti gösteriliyor');
ok(await page.locator('#decPrediction .dec-row').count() >= 3, 'pay çubukları çizildi');
ok((await page.locator('#decPrediction').textContent()).includes('Geçerli oy payları'), 'katılım ve geçerli oy payları gösteriliyor');
ok(await page.locator('#decPrediction .seg-table tr').count() >= 4, 'ideoloji kırılımı');
if (process.env.SHOT) await page.locator('#view-decision').screenshot({ path: process.env.SHOT.replace('.png', '-karar.png') });
await page.selectOption('#decScenario', 'hazir:telefon');
await page.evaluate(() => { document.querySelector('#decWhatIf').closest('details').open = true; });
await page.fill('#decWhatIf', '{"secenekler": {"O": {"fiyat": 16000}}}');
await page.click('#btnDecWhatIf');
await page.waitForSelector('#decWhatIfOut', { timeout: 20000 });
ok((await page.locator('#decWhatIfOut').textContent()).includes('+'), 'ne olur: fiyat indirimi pay kazandırıyor');
await page.selectOption('#decScenario', 'hazir:asi');
await page.fill('#decId', 'asi_test');
await page.evaluate(() => { document.querySelector('#decDataBox').open = true; });
const csvAsi = 'yas;kurumsal_guven;secim\n' + Array.from({ length: 60 }, (_, i) => `${20 + (i % 50)};${['dusuk', 'orta', 'yuksek'][i % 3]};${i % 3 === 2 || i % 5 === 0 ? 'evet' : 'hayir'}`).join('\n');
await page.fill('#decCsv', csvAsi);
await page.click('#btnDecLearn');
await page.waitForSelector('#decLearnOut', { timeout: 30000 });
ok((await page.locator('#decLearnOut').textContent()).includes('isabet'), 'arayüzden CSV yükleyip öğrenme ve doğrulama');
ok(await page.locator('#decLearnOut .seg-table').count() === 2, 'kuram desteği ve örneklem→nüfus tabloları');

console.log('\n[4] Konsol');
ok(errors.length === 0, errors.length ? errors.join(' | ') : 'sayfa hatası yok');
await browser.close();
console.log(fails.length ? `\n✖ ${fails.length} test başarısız` : '\n✔ karar araç testleri geçti');
process.exit(fails.length ? 1 : 0);
