import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const fails = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✖ ') + m); if (!c) fails.push(m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

// Profili önden yerleştir
await ctx.addInitScript(() => {
  if (localStorage.getItem('nexus.v1')) return;   // reload'da mevcut veriyi ezme
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
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// Sağlayıcıyı taklit et: 1. tur araç çağırır, 2. tur bitirir.
let turn = 0;
const seen = [];
await page.route('**/api.groq.com/**', async (route) => {
  const req = JSON.parse(route.request().postData() || '{}');
  seen.push(req);
  turn++;
  const content = turn === 1
    ? JSON.stringify({
        plan: 'Görevi ekleyip sonucu bildireceğim.',
        steps: ['task_add ile görevi oluştur', 'sonucu doğrula'],
        actions: [
          { tool: 'task_add', args: { title: 'Fatura öde', due: 'yarın 15:00', priority: 'high' } },
          { tool: 'calculate', args: { expression: '(1250*1.2)/3' } },
        ],
        reply: '', done: false,
      })
    : JSON.stringify({ plan: '', steps: [], actions: [], reply: 'Görev eklendi, tutar **500** TL.', done: true });
  await route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
  });
});

await page.goto(BASE, { waitUntil: 'networkidle' });

console.log('\n[1] Açılış');
ok(await page.locator('#view-chat').isVisible(), 'sohbet ekranı görünür');
ok((await page.locator('#activeProfileLabel').textContent()).includes('TestGroq'), 'aktif profil başlıkta');
ok(await page.locator('#statusDot.ok').count() === 1, 'durum noktası yeşil');

console.log('\n[2] Sekmeler');
for (const [tab, view] of [['tasks', 'view-tasks'], ['notes', 'view-notes'], ['conn', 'view-conn'], ['settings', 'view-settings'], ['chat', 'view-chat']]) {
  await page.click(`#tabbar button[data-view="${tab}"]`);
  ok(await page.locator('#' + view).isVisible(), `${tab} sekmesi açılıyor`);
}

console.log('\n[3] Ajan döngüsü (araç çağrısı + plan + sonuç)');
await page.fill('#input', 'yarın 15:00 fatura öde görevi ekle, 1250nin %20 fazlasının 3te birini de hesapla');
await page.click('#btnSend');
await page.waitForSelector('.msg.bot', { timeout: 15000 });
await page.waitForFunction(() => document.querySelectorAll('.card[data-tool]').length >= 2, { timeout: 15000 });

ok(await page.locator('.card.plan').count() >= 1, 'plan kartı çizildi');
ok((await page.locator('.card.plan').textContent()).includes('Görevi ekleyip'), 'plan metni doğru');
const toolCards = await page.locator('.card[data-tool]').allTextContents();
ok(toolCards.some((t) => t.includes('task_add')), 'task_add kartı var');
ok(toolCards.some((t) => t.includes('calculate')), 'calculate kartı var');
ok(await page.locator('.card[data-tool] .badge.ok').count() === 2, 'iki araç da başarılı');
ok((await page.locator('.msg.bot').last().textContent()).includes('Görev eklendi'), 'nihai cevap gösterildi');
ok(await page.locator('.msg.bot strong').count() >= 1, 'markdown işlendi (**500** → <strong>)');
ok(turn === 2, `iki tur döndü (gerçekleşen: ${turn})`);

console.log('\n[4] Araç sonuçları modele geri verildi');
const secondReq = seen[1];
const feedback = secondReq.messages.map((m) => m.content).join('\n');
ok(feedback.includes('ARAÇ SONUÇLARI'), 'araç sonuçları geri beslendi');
ok(feedback.includes('"result"') && feedback.includes('500'), 'hesap sonucu (500) geri beslendi');
ok(secondReq.messages[0].role === 'system' && secondReq.messages[0].content.includes('task_add'), 'sistem mesajında araç kataloğu var');

console.log('\n[5] Kalıcılık');
await page.evaluate(() => window.NEXUS.store.flush());
const store = await page.evaluate(() => JSON.parse(localStorage.getItem('nexus.v1')));
ok(store.tasks.length === 1, 'görev depoya yazıldı');
ok(store.tasks[0].title === 'Fatura öde', 'görev başlığı doğru');
ok(store.tasks[0].priority === 'high', 'öncelik yüksek');
ok(store.tasks[0].due > Date.now(), 'son tarih gelecekte ("yarın 15:00" çözüldü)');
ok(store.chat.filter((m) => m.role === 'user').length === 1, 'kullanıcı mesajı kaydedildi');

await page.click('#tabbar button[data-view="tasks"]');
ok((await page.locator('#taskList .item').first().textContent()).includes('Fatura öde'), 'görev listede görünüyor');
await page.locator('#taskList .chk').first().click();
ok((await page.evaluate(() => window.NEXUS.store.db().tasks[0].status)) === 'done', 'kutucuk görevi tamamlıyor');

console.log('\n[6] Yeniden yükleme sonrası durum korunuyor');
await page.reload({ waitUntil: 'networkidle' });
ok((await page.locator('.msg.user').count()) >= 1, 'sohbet geçmişi geri yüklendi');

console.log('\n[7] Riskli araç onayı');
turn = 0;
await page.unroute('**/api.groq.com/**');
await page.route('**/api.groq.com/**', async (route) => {
  turn++;
  const content = turn === 1
    ? JSON.stringify({ plan: 'Konumunu alacağım.', steps: ['geolocate'], actions: [{ tool: 'geolocate', args: {} }], done: false })
    : JSON.stringify({ actions: [], reply: 'Peki, konumu almadım.', done: true });
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
});
await page.click('#tabbar button[data-view="chat"]');
await page.fill('#input', 'konumumu al');
await page.click('#btnSend');
await page.waitForSelector('#modalHost .modal', { timeout: 15000 });
ok((await page.locator('#modalHost').textContent()).includes('geolocate'), 'riskli araç onay penceresi açıldı');
await page.click('#modalHost .btn:not(.primary):not(.danger)'); // Reddet
await page.waitForFunction(() => document.querySelectorAll('.msg.bot').length > 0 && [...document.querySelectorAll('.msg.bot')].pop().textContent.includes('konumu almadım'), { timeout: 15000 });
ok(true, 'red edildiğinde ajan düzgün devam etti');

console.log('\n[8] Hata yolu (API 401)');
await page.unroute('**/api.groq.com/**');
await page.route('**/api.groq.com/**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Invalid API Key' } }) }));
await page.fill('#input', 'merhaba');
await page.click('#btnSend');
await page.waitForSelector('.msg.err', { timeout: 15000 });
const errText = await page.locator('.msg.err').last().textContent();
ok(errText.includes('401') && errText.includes('anahtar'), 'anlaşılır hata mesajı: ' + errText.trim().slice(0, 90));
ok(await page.locator('#btnStop').isHidden(), 'hata sonrası durdur düğmesi gizlendi');

console.log('\n[9] Bağlantı ekranı');
await page.click('#tabbar button[data-view="conn"]');
await page.click('#btnConnAdd');
await page.waitForSelector('#modalHost .modal');
const opts = await page.locator('#modalHost select').first().locator('option').count();
ok(opts >= 15, `sağlayıcı listesi dolu (${opts} sağlayıcı)`);
await page.selectOption('#modalHost select >> nth=0', 'gemini');
ok((await page.locator('#modalHost input >> nth=3').inputValue()).includes('gemini'), 'ön ayar seçilince model doldu');
await page.keyboard.press('Escape');

console.log('\n[10] Konsol hataları');
// 401 senaryosunda app.js hatayı bilinçli olarak console.error ile kaydeder; o beklenen.
const real = errors.filter((e) => !/favicon|manifest|Failed to load resource|Hiçbir bağlantı yanıt vermedi/i.test(e));
ok(real.length === 0, real.length ? 'konsol hatası: ' + real.join(' | ') : 'konsol temiz');

await browser.close();
console.log(fails.length ? `\n✖ ${fails.length} test başarısız:\n- ` + fails.join('\n- ') : '\n✔ Tüm testler geçti');
process.exit(fails.length ? 1 : 0);
