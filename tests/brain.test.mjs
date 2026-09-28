// "Beyin" testleri: skiller sistem mesajına yükleniyor mu, MCP sunucusuna bağlanıp
// araçları ajanın çağrısına açılıyor mu (mcp__sunucu__araç yönlendirmesi + onay).
// Sağlayıcı ve MCP sunucusu sahte (mock) yanıtlarla taklit edilir; ağ gerekmez.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const fails = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✖ ') + m); if (!c) fails.push(m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

// Profil + bir skill + bir (boş) MCP sunucusu önden yerleştir.
await ctx.addInitScript(() => {
  if (localStorage.getItem('nexus.v1')) return;
  localStorage.setItem('nexus.v1', JSON.stringify({
    version: 1,
    settings: { activeProfile: 'p1', maxSteps: 6, temperature: 0, stream: false, autoApprove: false, lang: 'tr-TR' },
    profiles: [{ id: 'p1', name: 'TestGroq', provider: 'groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', model: 'test-model', enabled: true }],
    tasks: [], notes: [], memory: {}, reminders: [], chat: [],
    skills: [{ id: 's1', name: 'Kibar İmza', when: 'her cevabın sonunda', instructions: 'Cevabı "Saygılarımla, N.E.X.U.S." ile bitir.', enabled: true }],
    mcpServers: [{ id: 'm1', name: 'testsrv', url: 'https://mcp.example/mcp', headers: {}, enabled: true, tools: [], status: 'idle', lastError: '' }],
  }));
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// --- Sahte MCP sunucusu (Streamable HTTP, JSON yanıtlar) ---
let mcpCalls = [];
await page.route('**/mcp.example/**', async (route) => {
  const req = JSON.parse(route.request().postData() || '{}');
  const method = req.method;
  mcpCalls.push(method);
  const reply = (result) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'mcp-session-id': 'sess-123' },
    body: JSON.stringify({ jsonrpc: '2.0', id: req.id, result }),
  });
  if (method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'testsrv', version: '1' } });
  if (method === 'notifications/initialized') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
  if (method === 'tools/list') return reply({ tools: [{ name: 'echo', description: 'Verilen metni yankılar.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] });
  if (method === 'tools/call') return reply({ content: [{ type: 'text', text: 'echoed: ' + (req.params?.arguments?.text ?? '') }], isError: false });
  return reply({});
});

// --- Sahte LLM sağlayıcısı ---
let turn = 0;
const seen = [];
await page.route('**/api.groq.com/**', async (route) => {
  const req = JSON.parse(route.request().postData() || '{}');
  seen.push(req);
  turn++;
  const content = turn === 1
    ? JSON.stringify({ plan: 'MCP echo aracını çağıracağım.', steps: ['echo çağır'], actions: [{ tool: 'mcp__testsrv__echo', args: { text: 'selam' } }], reply: '', done: false })
    : JSON.stringify({ actions: [], reply: 'Sunucu **selam** dedi.', done: true });
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
});

await page.goto(BASE, { waitUntil: 'networkidle' });

console.log('\n[1] MCP sunucusu açılışta bağlandı, araçlar çekildi');
await page.waitForFunction(() => (window.NEXUS.store.db().mcpServers[0].tools || []).length > 0, { timeout: 15000 });
const srv = await page.evaluate(() => window.NEXUS.store.db().mcpServers[0]);
ok(srv.status === 'ready', 'sunucu durumu "ready"');
ok(srv.tools.some((t) => t.name === 'echo'), 'echo aracı listelendi');
ok(mcpCalls.includes('initialize') && mcpCalls.includes('tools/list'), 'initialize + tools/list çağrıldı');

console.log('\n[2] Beyin sekmesi skili ve sunucuyu gösteriyor');
await page.click('#tabbar button[data-view="brain"]');
ok(await page.locator('#view-brain').isVisible(), 'beyin sekmesi açıldı');
ok((await page.locator('#skillList').textContent()).includes('Kibar İmza'), 'skill listede');
ok((await page.locator('#mcpList').textContent()).includes('echo'), 'MCP aracı listede');

console.log('\n[3] Ajan bir MCP aracını çağırıyor (onay + yönlendirme)');
await page.click('#tabbar button[data-view="chat"]');
await page.fill('#input', 'echo aracını çağır');
await page.click('#btnSend');
await page.waitForSelector('#modalHost .modal', { timeout: 15000 });
ok((await page.locator('#modalHost').textContent()).includes('mcp__testsrv__echo'), 'MCP aracı onay penceresi açtı (dış araç → onay)');
await page.click('#modalHost .btn.primary, #modalHost .btn.danger'); // Onayla
await page.waitForFunction(() => document.querySelectorAll('.card[data-tool] .badge.ok').length >= 1, { timeout: 15000 });
const toolCard = await page.locator('.card[data-tool]').last().textContent();
ok(toolCard.includes('mcp__testsrv__echo'), 'MCP araç kartı çizildi');
ok(toolCard.includes('echoed: selam'), 'MCP sonucu karta yansıdı');
ok(mcpCalls.includes('tools/call'), 'tools/call çağrıldı');
ok((await page.locator('.msg.bot').last().textContent()).includes('selam'), 'nihai cevap geldi');

console.log('\n[4] Skiller ve MCP kataloğu sistem mesajına gömüldü');
const sys = seen[0].messages[0].content;
ok(seen[0].messages[0].role === 'system', 'ilk mesaj sistem mesajı');
ok(sys.includes('SKİLLER') && sys.includes('Kibar İmza') && sys.includes('Saygılarımla'), 'etkin skill sistem mesajında');
ok(sys.includes('DIŞ ARAÇLAR') && sys.includes('mcp__testsrv__echo'), 'MCP araç kataloğu sistem mesajında');

console.log('\n[5] Skill kapatınca sistem mesajından düşüyor');
await page.evaluate(() => window.NEXUS.store.updateSkill('s1', { enabled: false }));
turn = 0; seen.length = 0;
await page.unroute('**/api.groq.com/**');
await page.route('**/api.groq.com/**', (route) => {
  seen.push(JSON.parse(route.request().postData() || '{}'));
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ actions: [], reply: 'tamam', done: true }) } }] }) });
});
await page.fill('#input', 'merhaba');
await page.click('#btnSend');
await page.waitForFunction(() => [...document.querySelectorAll('.msg.bot')].some((n) => n.textContent.includes('tamam')), { timeout: 15000 });
ok(seen.length > 0 && !seen[0].messages[0].content.includes('Kibar İmza'), 'kapalı skill sistem mesajında yok');

console.log('\n[6] Konsol hataları');
const real = errors.filter((e) => !/favicon|manifest|Failed to load resource/i.test(e));
ok(real.length === 0, real.length ? 'konsol hatası: ' + real.join(' | ') : 'konsol temiz');

await browser.close();
console.log(fails.length ? `\n✖ ${fails.length} test başarısız:\n- ` + fails.join('\n- ') : '\n✔ Tüm beyin testleri geçti');
process.exit(fails.length ? 1 : 0);
