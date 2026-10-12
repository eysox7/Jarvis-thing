// Influence uçtan uca: rıza → profil → 40 karar → klon → senkron → veri yükleme →
// arkadaş kartı (bağlantıyla) → düello → "kim tanıyor" → aynı ikilem (sahte LLM) → silme.
import { chromium } from 'playwright';

const BASE = (process.env.BASE || 'http://127.0.0.1:8099') + '/influence/';
const fails = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✖ ') + m); if (!c) fails.push(m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());

// Tutarlı bir "insan": her eksene sabit ağırlık veren biri. Klon bunu öğrenebilmeli.
const PERSONA = { risk: 1, sosyal: 0.8, mantik: -0.5, sabir: -0.6, yenilik: 0.9, sadakat: 0.7, tutum: -0.8, rekabet: 0.5 };
const RIVAL = { risk: -1, sosyal: -0.7, mantik: 0.8, sabir: 0.9, yenilik: -0.6, sadakat: 0.4, tutum: 0.9, rekabet: -0.4 };

await page.goto(BASE, { waitUntil: 'networkidle' });
const bank = await page.evaluate(async () => (await import('./js/dilemmas.js')).DILEMMAS);
const choose = (d, p) => {
  const s = Object.keys(p).reduce((acc, k) => acc + p[k] * ((d.a.v[k] || 0) - (d.b.v[k] || 0)), 0);
  return s >= 0 ? 'A' : 'B';
};
const view = () => page.locator('#app').getAttribute('data-view');

console.log('\n[1] Karşılama ve rıza');
ok(await view() === 'welcome', 'ilk açılışta karşılama ekranı');
ok(await page.locator('#tabbar').isHidden(), 'onboarding sırasında sekme çubuğu gizli');
await page.click('#startBtn');
ok(await view() === 'consent', 'rıza ekranı açıldı');
ok((await page.locator('.notice').textContent()).includes('KVKK'), 'aydınlatma metni KVKK referanslı');
await page.click('#consentBtn');
ok(await view() === 'consent', 'zorunlu onaylar olmadan ilerlemiyor');
for (const k of ['process', 'adult', 'files', 'share']) await page.check(`#consentForm [name="${k}"]`);
await page.click('#consentBtn');
ok(await view() === 'profile', 'rıza sonrası profil ekranı');
const consent = await page.evaluate(() => JSON.parse(localStorage.getItem('influence.v1')).consent);
ok(consent?.version && consent.textHash?.length === 64 && consent.items.share === true, 'rıza kaydı: sürüm + metin özeti + kalemler');

console.log('\n[2] Profil ve karar testi');
await page.fill('#pName', 'Deniz');
await page.fill('#pBio', 'Maceracıyım, arkadaşlarım için her şeyi yaparım.');
await page.click('#profileBtn');
ok(await view() === 'train', 'karar testi açıldı');
for (let i = 0; i < 40; i++) {
  const id = await page.locator('.dilemma').getAttribute('data-id');
  const d = bank.find((x) => x.id === id);
  await page.click(choose(d, PERSONA) === 'A' ? '#optA' : '#optB');
  if (i < 39) await page.waitForFunction((prev) => document.querySelector('.dilemma')?.dataset.id !== prev, id);
}
await page.waitForFunction(() => document.querySelector('#app').dataset.view === 'lab', null, { timeout: 8000 });
ok(true, '40 karar verildi, klon otomatik kuruldu');

console.log('\n[3] Klon ve senkron');
const clone = await page.evaluate(() => JSON.parse(localStorage.getItem('influence.v1')).clone);
ok(Object.keys(clone.train).length === 30 && Object.keys(clone.test).length === 10, '30 eğitim / 10 gizli sınav sorusu');
ok(Object.keys(clone.train).every((id) => Number(id.slice(1)) % 4 !== 0), 'sınav soruları eğitime sızmadı');
ok(clone.sync.core.acc >= 0.8, `tutarlı kişide çekirdek senkron yüksek (${Math.round(clone.sync.core.acc * 100)}%)`);
ok((await page.locator('.rings').textContent()).includes('%'), 'senkron halkası gösteriliyor');
ok(await page.locator('details.card table.sync tbody tr').count() === 10, 'sınav tablosu 10 satır');
ok(await page.locator('.radar polygon').count() >= 5, 'DNA radarı çizildi');
const persona = await page.locator('.dna-text').textContent();
ok(persona.includes('risk alan') && persona.includes('yenilik arayan'), 'DNA kişiliği doğru okudu: ' + persona);

await page.fill('#askQ', 'Hafta sonu ne yapayım?');
await page.fill('#askA', 'Yeni bir maceraya atıl, kamp');
await page.fill('#askB', 'Evde sessiz sakin kitap oku');
await page.click('#askBtn');
await page.waitForSelector('#askOut .answer');
ok((await page.locator('#askOut .big-choice').textContent()).startsWith('A)'), 'serbest ikilemde klon kişiliğe uygun seçti (A)');

console.log('\n[4] Veri yükleme (WhatsApp)');
await page.click('#tabbar button[data-go="feed"]');
const wa = [
  '12.10.2026 14:20 - Deniz: hadi bu akşam konsere gidelim 😂😂',
  '12.10.2026 14:21 - Ali: Ben evdeyim, gizli bilgi: şifrem 1234',
  '12.10.2026 14:22 - Deniz: yeni açılan yere de bakarız macera olsun 😂',
  '12.10.2026 14:23 - Ali: Olmaz',
  '12.10.2026 14:24 - Deniz: risk almadan hayat olmaz bence',
].join('\n');
await page.setInputFiles('#fileIn', { name: 'WhatsApp Sohbeti - Ali.txt', mimeType: 'text/plain', buffer: Buffer.from(wa) });
await page.waitForSelector('#modalBody [data-who="Deniz"]');
await page.click('#modalBody [data-who="Deniz"]');
await page.waitForSelector('.doc');
const docs = await page.evaluate(() => JSON.parse(localStorage.getItem('influence.v1')).docs);
const stored = docs[0].chunks.join('\n');
ok(stored.includes('konsere') && !stored.includes('şifrem'), 'yalnızca kullanıcının mesajları tutuldu, diğer kişininki atıldı');
ok(docs[0].style.includes('😂'), 'yazım tarzı çıkarıldı: ' + docs[0].style);

console.log('\n[5] Arkadaş klonu bağlantıyla geliyor');
const link = await page.evaluate(async (RIVAL) => {
  const { DILEMMAS } = await import('./js/dilemmas.js');
  const { build } = await import('./js/clone.js');
  const { toCard } = await import('./js/share.js');
  const { b64urlEncode } = await import('./js/util.js');
  const answers = {};
  for (const d of DILEMMAS) {
    const s = Object.keys(RIVAL).reduce((acc, k) => acc + RIVAL[k] * ((d.a.v[k] || 0) - (d.b.v[k] || 0)), 0);
    answers[d.id] = { c: s >= 0 ? 'A' : 'B' };
  }
  const c = build(answers, { name: 'Ali', code: 'IN-0042', hue: 350, bio: 'Hesaplı kitaplıyım.' });
  c.id = 'friend-ali';
  const card = toCard(c);
  if (JSON.stringify(card).includes('chunks')) throw new Error('kartta ham veri var');
  return location.href.split('#')[0] + '#klon=' + b64urlEncode(JSON.stringify(card));
}, RIVAL);
ok(link.length < 2500, `kart bağlantısı kısa (${link.length} karakter)`);
await page.goto('about:blank');
await page.goto(link, { waitUntil: 'networkidle' });
await page.waitForSelector('#acceptIncoming');
await page.click('#acceptIncoming');
ok(await view() === 'arena', 'gelen klon kabul edildi, arena açıldı');
ok(await page.locator('.roster-item').count() === 2, 'kadroda 2 klon');
ok(!page.url().includes('#klon='), 'bağlantı adres çubuğundan temizlendi');

console.log('\n[6] Klon düellosu');
await page.selectOption('#dB', 'friend-ali');
await page.click('#startDuel');
let rounds = 0;
for (let i = 0; i < 6; i++) {
  await page.waitForSelector('#duelReveal, .verdict', { timeout: 5000 });
  if (await page.locator('.verdict').count()) break;
  await page.click('#duelReveal');
  await page.waitForSelector('#duelNext');
  rounds++;
  await page.click('#duelNext');
}
ok(rounds === 5, '5 raund oynandı');
ok(await page.locator('.score .num').count() === 2, 'skor tablosu');
const verdict = await page.locator('.verdict').textContent();
ok(/kazandı|sadık|Berabere/.test(verdict), 'kazanan ilan edildi: ' + verdict.trim());

console.log('\n[7] Kim seni daha iyi tanıyor?');
await page.click('[data-act="leaveBattle"] >> nth=0');
await page.fill('#kGuesser', 'Ali');
await page.click('#startKnows');
for (let i = 0; i < 10; i++) {
  const before = await page.locator('#app .mono.dim').first().textContent();
  await page.click('#kA');
  if (i < 9) await page.waitForFunction((b) => document.querySelector('#app .mono.dim')?.textContent !== b, before);
}
await page.waitForSelector('.verdict');
ok(await page.locator('table.sync tbody tr').count() === 10, '10 soruluk karşılaştırma');
ok(/Klon kazandı|kazandı|Berabere/.test(await page.locator('.verdict').textContent()), 'arkadaş vs klon sonucu');

console.log('\n[8] Nöral motor (sahte yerel LLM ile)');
await page.evaluate(() => {
  window.__prompts = [];
  window.__INFLUENCE_FAKE_LLM__ = async (msgs) => { window.__prompts.push(msgs); return 'SEÇİM: B\nGEREKÇE: Test gerekçesi, ben böyleyim.'; };
});
await page.click('#tabbar button[data-go="settings"]');
await page.check('input[name="engine"][value="neural"]');
ok(await page.evaluate(() => JSON.parse(localStorage.getItem('influence.v1')).settings.engine) === 'neural', 'motor nöral olarak kaydedildi');
await page.click('#tabbar button[data-go="arena"]');
await page.selectOption('#sB', 'friend-ali');
await page.fill('#sQ', 'Bu akşam konser mi?');
await page.fill('#sOA', 'Konsere giderim');
await page.fill('#sOB', 'Evde kalırım');
await page.click('#startSame');
await page.waitForSelector('.quote');
ok((await page.locator('.quote').first().textContent()).includes('Test gerekçesi'), 'LLM gerekçesi klonun ağzından gösterildi');
ok((await page.locator('#app').textContent()).includes('nöral'), 'kararı nöral motor verdi');
const prompts = await page.evaluate(() => window.__prompts);
const sys = prompts[0][0].content;
ok(sys.includes('Deniz') && sys.includes("Kişilik DNA'n") && sys.includes('gerçek kararlar'), 'istem: kimlik + DNA + geçmiş kararlar');
ok(sys.includes('konser') && sys.includes('😂'), 'istem: yüklenen mesajdan alıntı + yazım tarzı');
ok(!prompts[1][0].content.includes('konser'), 'arkadaş klonuna kendi dosyaların sızmadı');

await page.click('#tabbar button[data-go="lab"]');
await page.click('#syncNeural');
await page.waitForFunction(() => document.querySelector('#modal').hidden && document.querySelector('#app').dataset.view === 'lab');
const neural = await page.evaluate(() => JSON.parse(localStorage.getItem('influence.v1')).clone.sync.neural);
ok(neural?.n === 10 && neural.rows.every((r) => r.by === 'neural'), 'nöral senkron testi 10 soruda LLM ile çalıştı');

console.log('\n[9] Kalıcılık ve silme');
await page.reload({ waitUntil: 'networkidle' });
ok(await view() === 'lab', 'yeniden açılışta klon ekranı');
ok((await page.locator('.idcard h2').textContent()) === 'Deniz', 'klon kalıcı');
await page.click('#tabbar button[data-go="settings"]');
await page.click('#wipeBtn');
ok(await view() === 'welcome', 'rıza geri çekilince başa dönüldü');
ok(await page.evaluate(() => localStorage.getItem('influence.v1')) === null, 'tüm veriler silindi');

console.log('\n[10] Konsol');
ok(errors.length === 0, 'konsolda hata yok' + (errors.length ? ': ' + errors.join(' | ') : ''));

await browser.close();
console.log(fails.length ? `\n✖ ${fails.length} başarısız` : '\n✔ Influence testleri geçti');
process.exit(fails.length ? 1 : 0);
