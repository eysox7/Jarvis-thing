// Google entegrasyonu testleri: jeton enjekte edilip (OAuth açılır penceresi atlanır)
// Gmail/Takvim araçlarının doğru uç noktaları Bearer başlığıyla çağırdığı, yanıtları
// çözümlediği ve dış hesap araçlarının onay gerektirdiği doğrulanır. Google API'leri
// sahte JSON yanıtlarıyla taklit edilir; ağ/gerçek hesap gerekmez.
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
    settings: { activeProfile: 'p1', maxSteps: 6, temperature: 0, stream: false, autoApprove: true, lang: 'tr-TR', googleClientId: 'x.apps.googleusercontent.com' },
    profiles: [{ id: 'p1', name: 'TestGroq', provider: 'groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', model: 'test-model', enabled: true }],
    tasks: [], notes: [], memory: {}, reminders: [], chat: [], skills: [], mcpServers: [],
  }));
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// --- Sahte Google API'leri ---
let gmailAuth = null;
let calBody = null;
await page.route('**/gmail.googleapis.com/**', (route) => {
  const url = route.request().url();
  gmailAuth = route.request().headers()['authorization'];
  const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
  if (/\/messages\?/.test(url)) return json({ messages: [{ id: 'm1' }] });
  if (/\/messages\/m1/.test(url)) return json({ snippet: 'Sınav yarın', labelIds: ['UNREAD'], payload: { headers: [{ name: 'Subject', value: 'Sınav' }, { name: 'From', value: 'hoca@okul.edu' }, { name: 'Date', value: 'Mon, 1 Jan 2026' }] } });
  return json({});
});
await page.route('**/www.googleapis.com/calendar/**', (route) => {
  const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
  if (route.request().method() === 'POST') { calBody = JSON.parse(route.request().postData() || '{}'); return json({ id: 'e1', summary: calBody.summary, start: calBody.start, htmlLink: 'https://cal/e1' }); }
  return json({ items: [] });
});

// --- Sahte LLM ---
let turn = 0;
await page.route('**/api.groq.com/**', (route) => {
  turn++;
  const content = turn === 1
    ? JSON.stringify({ plan: 'Postaları arayıp takvime ekleyeceğim.', actions: [
        { tool: 'gmail_search', args: { query: 'is:unread' } },
        { tool: 'calendar_add', args: { title: 'Sınav çalışması', start: 'yarın 15:00' } },
      ], done: false })
    : JSON.stringify({ actions: [], reply: 'Postan var, takvime de ekledim.', done: true });
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
});

await page.goto(BASE, { waitUntil: 'networkidle' });

console.log('\n[1] Jeton enjekte edilince durum "bağlı"');
await page.evaluate(() => window.NEXUS.google._setToken('test-token-123', 3600));
const st = await page.evaluate(() => window.NEXUS.google.status());
ok(st.connected === true, 'google.status().connected true');
ok(st.scopes.some((s) => s.includes('gmail')), 'yetki alanları raporlandı');

console.log('\n[2] Dış hesap araçları onay gerektirir (isDangerTool)');
const danger = await page.evaluate(async () => {
  const T = await import('./js/tools.js');
  return ['gmail_search', 'gmail_send', 'calendar_add', 'classroom_work', 'drive_search'].map((n) => T.isDangerTool(n));
});
ok(danger.every(Boolean), 'gmail/calendar/classroom/drive araçları danger');

console.log('\n[3] Ajan Gmail + Takvim araçlarını çalıştırıyor');
await page.fill('#input', 'okunmamış postaları bul ve yarın 15:00\'e sınav çalışması ekle');
await page.click('#btnSend');
await page.waitForFunction(() => document.querySelectorAll('.card[data-tool] .badge.ok').length >= 2, { timeout: 15000 });
const cards = await page.locator('.card[data-tool]').allTextContents();
ok(cards.some((c) => c.includes('gmail_search') && c.includes('Sınav') && c.includes('hoca@okul.edu')), 'gmail_search sonucu çözümlendi');
ok(cards.some((c) => c.includes('calendar_add') && c.includes('e1')), 'calendar_add etkinlik ekledi');

console.log('\n[4] İstek doğru gitti (Bearer başlığı + gövde)');
ok(gmailAuth === 'Bearer test-token-123', 'Gmail çağrısı Bearer jetonu taşıdı');
ok(calBody && calBody.summary === 'Sınav çalışması', 'takvim gövdesinde başlık doğru');
ok(calBody && !!calBody.start?.dateTime, '"yarın 15:00" ISO başlangıca çözüldü');
ok((await page.locator('.msg.bot').last().textContent()).includes('takvime de ekledim'), 'nihai cevap geldi');

console.log('\n[5] Çıkış durumu sıfırlar');
await page.evaluate(() => window.NEXUS.google.signOut());
ok((await page.evaluate(() => window.NEXUS.google.status().connected)) === false, 'çıkıştan sonra bağlı değil');

console.log('\n[6] Konsol hataları');
const real = errors.filter((e) => !/favicon|manifest|Failed to load resource|gsi\/client|accounts\.google/i.test(e));
ok(real.length === 0, real.length ? 'konsol hatası: ' + real.join(' | ') : 'konsol temiz');

await browser.close();
console.log(fails.length ? `\n✖ ${fails.length} test başarısız:\n- ` + fails.join('\n- ') : '\n✔ Tüm Google testleri geçti');
process.exit(fails.length ? 1 : 0);
