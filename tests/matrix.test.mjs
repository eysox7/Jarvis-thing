// matrAIx: saf motor (Node) + sekme ve ajan aracı (gerçek Chromium, sahte sağlayıcı).
import { chromium } from 'playwright';
import {
  normalizeBrief, cleanCombos, composite, applyScores, runMatrix, buildReport,
} from '../js/matrix.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const fails = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✖ ') + m); if (!c) fails.push(m); };

/** Sahte matrAIx modeli: istemdeki AŞAMA satırına göre cevap verir. */
function fakeModel({ short = 0, garbageFirst = false } = {}) {
  const log = [];
  let garbage = garbageFirst;
  const respond = (prompt) => {
    log.push(prompt.match(/AŞAMA: (\S+)/)?.[1] || '?');
    if (garbage) { garbage = false; return 'Tabii, işte analiz: (JSON yok)'; }
    if (prompt.includes('AŞAMA: MÜŞTERİ')) {
      return JSON.stringify({
        summary: 'Kaliteye para veren şehirli genç profesyoneller.',
        personas: [{ name: 'Hibrit çalışan', profile: '28-35, evde V60' }],
        motivations: ['özel olma', 'tazelik', 'etik'], barriers: ['fiyat'], channels: ['Instagram'],
        regionNotes: [{ region: 'Avrupa', note: 'yerel dil varyantları' }],
      });
    }
    if (prompt.includes('AŞAMA: KOMBİNASYON')) {
      const need = Number(prompt.match(/Tam olarak (\d+)/)[1]);
      const already = prompt.includes('TEKRARLAMA');
      const n = already ? need : Math.max(1, need - short);
      const combos = Array.from({ length: n }, (_, i) => ({
        keyword: `${already ? 'extra' : 'kw'} ${i + 1}`, head: 'coffee', modifier: 'm',
        intent: i % 3 === 0 ? 'transactional' : 'commercial', trigger: 'kıtlık', placement: 'H1',
      }));
      if (!already) combos.push({ keyword: 'KW 1' });          // büyük/küçük harf tekrarı: atılmalı
      return JSON.stringify({ combos });
    }
    if (prompt.includes('AŞAMA: ELEŞTİRMEN')) {
      const n = (prompt.match(/^\d+\. /gm) || []).length;
      // Son kelime en yüksek puanı alsın ki sıralamanın gerçekten yapıldığı görülsün.
      return JSON.stringify({
        scores: Array.from({ length: n }, (_, i) => ({
          n: i + 1, intent: 1 + (i % 10), trigger: 5, relevance: 5, competition: 5, note: `not ${i + 1}`,
        })),
      });
    }
    return '{}';
  };
  return { log, respond, llm: async ({ messages }) => respond(messages[0].content) };
}

/* ======================= saf motor ======================= */
console.log('\n[1] Brif ve yardımcılar');
const b = normalizeBrief({ product: ' kahve ', regions: 'Avrupa, ABD;', count: 999 });
ok(b.product === 'kahve' && b.regions.length === 2, 'brif normalize edildi');
ok(b.count === 40, 'kombinasyon sayısı üst sınıra kırpıldı');
ok(normalizeBrief({ product: 'x' }).count === 15, 'varsayılan 15 kombinasyon');
let threw = false; try { normalizeBrief({}); } catch { threw = true; }
ok(threw, 'ürünsüz brif reddedildi');
const cleaned = cleanCombos([{ keyword: 'A b' }, { keyword: 'a  B' }, { keyword: '' }, { keyword: 'c', intent: 'nonsense' }]);
ok(cleaned.length === 2 && cleaned[1].intent === 'commercial', 'tekrar ve boşlar ayıklandı, geçersiz niyet düzeltildi');
ok(composite({ intent: 10, trigger: 10, relevance: 10, competition: 1 }) === 100, 'en iyi bileşik puan 100');
ok(composite({ intent: 1, trigger: 1, relevance: 1, competition: 10 }) === 10, 'en kötü bileşik puan 10');
const ranked = applyScores([{ keyword: 'a' }, { keyword: 'b' }, { keyword: 'c' }],
  [{ n: 1, intent: 2, trigger: 2, relevance: 2, competition: 9 }, { n: 2, intent: 9, trigger: 9, relevance: 9, competition: 2 }]);
ok(ranked.map((c) => c.keyword).join() === 'b,a,c', 'puana göre sıralandı, puansız sona düştü');
ok(ranked[2].score === null && ranked[2].rank === 3, 'puansız kombinasyon işaretli');

console.log('\n[2] Uçtan uca koşu (sahte model)');
const m1 = fakeModel();
const stages = [];
const run1 = await runMatrix({ product: 'premium mikrolot kahve', regions: 'Avrupa, ABD', audience: 'genç profesyoneller' },
  { llm: m1.llm, onStage: (s) => stages.push(s) });
ok(run1.combos.length === 15, `15 kombinasyon (gerçekleşen: ${run1.combos.length})`);
ok(run1.calls === 3 && m1.log.join() === 'MÜŞTERİ,KOMBİNASYON,ELEŞTİRMEN', 'üç aşama sırayla çalıştı');
ok(stages[0] === 'analyze' && stages.at(-1) === 'done', 'aşama bildirimleri geldi');
ok(run1.combos.every((c, i, a) => i === 0 || (a[i - 1].score ?? -1) >= (c.score ?? -1)), 'sonuç azalan puanla sıralı');
ok(run1.combos[0].rank === 1 && run1.combos[0].note, 'birinci sıra ve gerekçe var');
ok((run1.report.match(/^\| \d+ \|/gm) || []).length === 15, 'raporda 15 tablo satırı');
ok(run1.report.includes('Müşteri analizi') && run1.report.includes('doğrula'), 'rapor analiz ve doğrulama uyarısı içeriyor');

console.log('\n[3] Eksik üretim tamamlanır, bozuk JSON bir kez yeniden istenir');
const m2 = fakeModel({ short: 4, garbageFirst: true });
const run2 = await runMatrix({ product: 'kahve', count: 15 }, { llm: m2.llm });
ok(run2.combos.length === 15, `eksik 4 kombinasyon tamamlandı (${run2.combos.length})`);
ok(run2.combos.some((c) => c.keyword.startsWith('extra')), 'tamamlama turu kullanıldı');
ok(m2.log[0] === 'MÜŞTERİ' && m2.log[1] === 'MÜŞTERİ', 'bozuk JSON sonrası aynı aşama tekrar istendi');
ok(buildReport(run2).startsWith('# matrAIx PR koşusu — kahve'), 'rapor başlığı');

/* ======================= tarayıcı ======================= */
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
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

const m3 = fakeModel();
let agentTurn = 0;
await page.route('**/api.groq.com/**', async (route) => {
  const req = JSON.parse(route.request().postData() || '{}');
  const system = req.messages[0]?.content || '';
  let content;
  if (system.includes("matrAIx'sin")) {
    content = m3.respond(req.messages[1].content);
  } else {
    agentTurn++;
    content = agentTurn === 1
      ? JSON.stringify({
          plan: 'matrAIx PR koşusunu başlatıyorum.', steps: ['matrix_run'],
          actions: [{ tool: 'matrix_run', args: { product: 'premium mikrolot kahve', regions: 'Avrupa, ABD', audience: 'genç profesyoneller', count: 15 } }],
          done: false,
        })
      : JSON.stringify({ actions: [], reply: 'PR koşusu bitti, ilk sırada **kw 10** var.', done: true });
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
});

await page.goto(BASE, { waitUntil: 'networkidle' });

console.log('\n[4] matrAIx sekmesi');
await page.click('#tabbar button[data-view="matrix"]');
ok(await page.locator('#view-matrix').isVisible(), 'sekme açılıyor');
ok((await page.locator('#mxRuns').textContent()).includes('Henüz koşu yok'), 'boş durum gösteriliyor');
await page.click('#btnMxRun');
ok((await page.locator('#mxStatus').textContent()) === '' && (await page.locator('.toast').last().textContent()).includes('Ürün'), 'ürünsüz başlatma engellendi');

await page.fill('#mxProduct', 'premium mikrolot karışımı kahve');
await page.fill('#mxRegions', 'Avrupa, ABD');
await page.fill('#mxAudience', 'genç profesyoneller');
await page.click('#btnMxRun');
await page.waitForFunction(() => document.querySelector('#mxStatus').textContent.startsWith('✔'), { timeout: 15000 });
ok(await page.locator('.mx-run').count() === 1, 'koşu listeye eklendi');
ok(await page.locator('.mx-run .mx-combo').count() === 15, '15 kombinasyon çizildi');
const scores = (await page.locator('.mx-run .mx-score').allTextContents()).map(Number);
ok(scores.every((s, i) => i === 0 || scores[i - 1] >= s), 'ekranda azalan puan sırası');
ok((await page.locator('.mx-run').textContent()).includes('Satın alma güdüleri'), 'müşteri analizi görünüyor');
await page.evaluate(() => window.NEXUS.store.flush());
let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nexus.v1')));
ok(stored.matrix.length === 1 && stored.matrix[0].combos.length === 15, 'koşu depoya yazıldı');
ok(!JSON.stringify(stored.matrix).includes('"apiKey"'), 'koşu kaydında API anahtarı yok');

await page.click('.mx-run button:has-text("Nota kaydet")');
ok((await page.evaluate(() => window.NEXUS.store.db().notes[0]?.title)) === 'matrAIx — premium mikrolot karışımı kahve', 'rapor nota kaydedildi');

console.log('\n[5] Sohbetten ajan aracı: "matrAIx\'i çalıştır"');
await page.click('#tabbar button[data-view="chat"]');
await page.fill('#input', "matrAIx'i çalıştır, 15 kombinasyon dene: premium mikrolot kahve, Avrupa ve ABD, genç profesyoneller");
await page.click('#btnSend');
await page.waitForFunction(() => [...document.querySelectorAll('.msg.bot')].some((n) => n.textContent.includes('PR koşusu bitti')), { timeout: 20000 });
ok(await page.locator('.card[data-tool]:has-text("matrix_run") .badge.ok').count() === 1, 'matrix_run aracı başarılı');
ok(agentTurn === 2, 'ajan araç sonucunu alıp turu bitirdi');
stored = await page.evaluate(() => window.NEXUS.store.db());
ok(stored.matrix.length === 2, 'ajan koşusu da kaydedildi');
await page.click('#tabbar button[data-view="matrix"]');
ok(await page.locator('.mx-run').count() === 2, 'sekmede iki koşu');

console.log('\n[6] Konsol');
const real = errors.filter((e) => !/favicon|manifest|Failed to load resource/i.test(e));
ok(real.length === 0, real.length ? 'konsol hatası: ' + real.join(' | ') : 'konsol temiz');

await browser.close();
console.log(fails.length ? `\n✖ ${fails.length} test başarısız:\n- ` + fails.join('\n- ') : '\n✔ Tüm matrAIx testleri geçti');
process.exit(fails.length ? 1 : 0);
