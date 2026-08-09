// Eller serbest ses kontrolü. Web Speech API tarayıcıda gerçek mikrofon ister,
// bu yüzden SpeechRecognition ve speechSynthesis sahte (mock) sürümlerle değiştirilir;
// test edilen şey N.E.X.U.S.'un bu API'lere verdiği tepkidir.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const fails = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✖ ') + m); if (!c) fails.push(m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

await ctx.addInitScript(() => {
  if (!localStorage.getItem('nexus.v1')) {
    localStorage.setItem('nexus.v1', JSON.stringify({
      settings: {
        activeProfile: 'p1', maxSteps: 6, temperature: 0, stream: false, autoApprove: false,
        lang: 'tr-TR', requireWake: true, wakeWord: 'nexus', bargeIn: false, voiceRate: 1,
      },
      profiles: [{ id: 'p1', name: 'T', provider: 'groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', model: 'm', enabled: true }],
      tasks: [], notes: [], memory: {}, reminders: [], chat: [],
    }));
  }

  // --- sahte SpeechRecognition -------------------------------------------
  window.__mic = { instances: [], spoken: [], starts: 0 };
  class FakeSR {
    constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; window.__mic.instances.push(this); }
    start() { this.running = true; window.__mic.starts++; window.__mic.live = this; }
    stop() { this.running = false; this.onend?.({}); }
    abort() { this.running = false; if (window.__mic.live === this) window.__mic.live = null; }
  }
  // window üzerindeki bu adlar salt-okunur erişimci olabilir; defineProperty şart.
  const put = (name, value) => Object.defineProperty(window, name, { value, configurable: true, writable: true });
  put('SpeechRecognition', FakeSR);
  put('webkitSpeechRecognition', FakeSR);

  // Kullanıcı konuştu: etkin tanıyıcıya nihai sonuç gönder.
  window.__say = (text) => {
    const r = window.__mic.live || window.__mic.instances.filter((i) => i.running).pop();
    if (!r || !r.onresult) return false;
    r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
    return true;
  };

  // --- sahte speechSynthesis ---------------------------------------------
  put('SpeechSynthesisUtterance', class { constructor(t) { this.text = t; } });
  put('speechSynthesis', {
    speak(u) { window.__mic.spoken.push(u.text); setTimeout(() => u.onend?.(), 5); },
    cancel() { window.__mic.cancels = (window.__mic.cancels || 0) + 1; },
  });
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let scenario = 'task';
let turn = 0;
await page.route('**/api.groq.com/**', async (route) => {
  turn++;
  let content;
  if (scenario === 'task') {
    content = turn === 1
      ? JSON.stringify({ plan: 'Görevi ekliyorum.', actions: [{ tool: 'task_add', args: { title: 'Süt al' } }], done: false })
      : JSON.stringify({ actions: [], reply: 'Süt al görevini ekledim.', done: true });
  } else if (scenario === 'danger') {
    content = turn === 1
      ? JSON.stringify({ plan: 'Konumu alacağım.', actions: [{ tool: 'geolocate', args: {} }], done: false })
      : JSON.stringify({ actions: [], reply: 'Konumu almadım.', done: true });
  } else {
    content = turn === 1
      ? JSON.stringify({ plan: 'Bilgi eksik.', actions: [{ tool: 'ask_user', args: { question: 'Hangi şehir?', options: ['Ankara', 'İzmir'] } }], done: false })
      : JSON.stringify({ actions: [], reply: 'Anladım.', done: true });
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
});

const spoken = () => page.evaluate(() => window.__mic.spoken.join(' | '));
// Konuşma bittikten sonra tanıyıcı ~250 ms içinde yeniden açılır; önce onu bekle.
const say = async (t) => {
  await page.waitForFunction(() => !!window.__mic.live, { timeout: 10000 });
  const ok = await page.evaluate((x) => window.__say(x), t);
  if (!ok) throw new Error('mikrofon dinlemiyordu, söylenemedi: ' + t);
  await page.waitForTimeout(220);
};
const state = () => page.textContent('#voiceState');

await page.goto(BASE, { waitUntil: 'networkidle' });

console.log('\n[1] Niyet çözümleme (saf fonksiyonlar)');
const intent = await page.evaluate(async () => {
  const V = await import('./js/voice.js');
  return {
    wakeBare: V.matchWake('nexus', 'nexus'),
    wakeCmd: V.matchWake('Nexus süt almayı hatırlat', 'nexus'),
    wakeMid: V.matchWake('bugün hava güzel', 'nexus'),
    wakeTypo: V.matchWake('neksüs görevlerimi oku', 'nexus'),
    wakeGlued: V.matchWake('annexus bir şey', 'nexus'),
    yes: [V.parseYesNo('evet'), V.parseYesNo('tamam olur'), V.parseYesNo('onaylıyorum')],
    no: [V.parseYesNo('hayır'), V.parseYesNo('iptal et'), V.parseYesNo('vazgeçtim')],
    unclear: V.parseYesNo('bilmiyorum ki'),
    local: [V.matchLocal('dur'), V.matchLocal('uyu'), V.matchLocal('yeni sohbet'), V.matchLocal('tekrarla'), V.matchLocal('süt al')],
  };
});
ok(intent.wakeBare.hit && intent.wakeBare.rest === '', 'yalnız uyandırma kelimesi: komut boş');
ok(intent.wakeCmd.hit && intent.wakeCmd.rest === 'süt almayı hatırlat', 'uyandırma + komut ayrıştı');
ok(!intent.wakeMid.hit, 'alakasız cümle tetiklemiyor');
ok(intent.wakeTypo.hit && intent.wakeTypo.rest === 'görevlerimi oku', 'yanlış duyulan varyant ("neksüs") kabul edildi');
ok(!intent.wakeGlued.hit, 'kelime içinde geçen ses tetiklemiyor ("annexus")');
ok(intent.yes.every((v) => v === true), 'evet varyantları');
ok(intent.no.every((v) => v === false), 'hayır varyantları');
ok(intent.unclear === null, 'belirsiz cevap null döner');
ok(JSON.stringify(intent.local) === JSON.stringify(['stop', 'sleep', 'newchat', 'repeat', null]), 'yerel komutlar eşleşiyor');

console.log('\n[2] Modu açma');
await page.click('#btnHands');
await page.waitForTimeout(300);
ok(!(await page.locator('#voiceBar').isHidden()), 'durum şeridi göründü');
ok((await state()).includes('uyandırma'), 'uyandırma kelimesi bekleniyor: ' + (await state()));
ok((await spoken()).includes('Eller serbest açık'), 'açılışta sesli teyit verdi');
ok(await page.locator('#btnMic').isHidden(), 'bas-konuş düğmesi gizlendi (çakışma olmasın)');

console.log('\n[3] Uyandırma kelimesi kapısı');
await say('bugün hava çok güzel ya');
ok((await state()).includes('uyandırma'), 'çağrılmadan konuşulanı yoksaydı');
ok(turn === 0, 'API çağrısı yapılmadı');

await say('nexus');
ok((await state()) === 'dinliyorum', 'isim duyulunca komut moduna geçti');
ok((await spoken()).includes('Efendim?'), '"Efendim?" diye karşılık verdi');

console.log('\n[4] Sesli komut → ajan → sesli cevap → tekrar dinleme');
await say('süt almayı görevlere ekle');
await page.waitForFunction(() => window.__mic.spoken.some((s) => s.includes('Süt al görevini ekledim')), { timeout: 15000 });
ok(true, 'ajan çalıştı ve cevabı sesli okudu');
ok((await page.evaluate(() => window.NEXUS.store.db().tasks.length)) === 1, 'görev gerçekten eklendi');
await page.waitForTimeout(400);
ok((await state()).includes('uyandırma'), 'cevaptan sonra dinlemeye geri döndü');
ok((await page.locator('.msg.user').first().textContent()).includes('süt almayı'), 'komut sohbete kullanıcı mesajı olarak yazıldı');

console.log('\n[5] Riskli araç onayı — sesle');
scenario = 'danger'; turn = 0;
await say('nexus konumumu al');
await page.waitForSelector('#modalHost .modal', { timeout: 15000 });
await page.waitForFunction(() => window.__mic.spoken.some((s) => s.includes('Evet mi, hayır mı')), { timeout: 8000 });
ok(true, 'onay sorusu sesli soruldu');
ok((await state()).includes('cevabını bekliyorum'), 'cevap bekleme durumuna geçti');
await say('hayır');
await page.waitForFunction(() => document.querySelector('#modalHost').hidden, { timeout: 8000 });
ok(true, '"hayır" pencereyi kapattı — ekrana dokunmadan');
await page.waitForFunction(() => window.__mic.spoken.some((s) => s.includes('Konumu almadım')), { timeout: 15000 });
ok(true, 'ajan reddi anlayıp devam etti');

console.log('\n[6] Anlaşılmayan cevapta tekrar sorma');
scenario = 'danger'; turn = 0;
await say('nexus konumumu al');
await page.waitForSelector('#modalHost .modal', { timeout: 15000 });
await page.waitForFunction(() => window.__mic.spoken.some((s) => s.includes('Evet mi, hayır mı')), { timeout: 8000 });
const before = await page.evaluate(() => window.__mic.spoken.length);
await say('şey ııı bilmiyorum');
await page.waitForFunction((n) => window.__mic.spoken.slice(n).some((s) => s.includes('Anlayamadım')), { timeout: 8000 }, before);
ok(true, 'belirsiz cevapta tekrar sordu');
await say('evet');
await page.waitForFunction(() => document.querySelector('#modalHost').hidden, { timeout: 8000 });
ok(true, 'ikinci denemede "evet" kabul edildi');
await page.waitForTimeout(600);

console.log('\n[7] ask_user sorusu — sesle ve seçenekle');
scenario = 'ask'; turn = 0;
await page.evaluate(() => window.NEXUS.store.clearChat());
await say('nexus hava durumuna bak');
await page.waitForSelector('#modalHost .modal', { timeout: 15000 });
await page.waitForFunction(() => window.__mic.spoken.some((s) => s.includes('Hangi şehir')), { timeout: 8000 });
ok((await spoken()).includes('Seçenekler: Ankara, İzmir'), 'seçenekler sesli okundu');
await say('izmir olsun');
await page.waitForFunction(() => document.querySelector('#modalHost').hidden, { timeout: 8000 });
const asked = await page.evaluate(() => {
  const c = [...document.querySelectorAll('.card[data-tool]')].map((n) => n.textContent).join(' ');
  return c;
});
ok(asked.includes('İzmir'), 'serbest konuşma seçeneğe eşlendi ("izmir olsun" → İzmir)');

console.log('\n[8] Yerel komutlar (modele gitmeden)');
const turnsBefore = turn;
await say('nexus tekrarla');
await page.waitForTimeout(300);
ok(turn === turnsBefore, '"tekrarla" API çağrısı yapmadı');
ok((await spoken()).includes('Anladım'), 'son cevabı tekrar okudu');

await say('nexus yeni sohbet');
await page.waitForTimeout(400);
ok((await page.locator('.msg.user').count()) === 0, '"yeni sohbet" geçmişi temizledi');
ok((await spoken()).includes('Yeni sohbet başlattım'), 'sesli teyit verdi');

console.log('\n[9] "uyu" ile kapatma');
await say('nexus uyu');
await page.waitForTimeout(400);
ok(await page.locator('#voiceBar').isHidden(), 'durum şeridi kapandı');
ok((await spoken()).includes('Dinlemeyi kapatıyorum'), 'kapanışta sesli teyit');
ok(!(await page.locator('#btnMic').isHidden()), 'bas-konuş düğmesi geri geldi');
ok(await page.evaluate(() => !window.__mic.live), 'mikrofon serbest bırakıldı (artık dinlemiyor)');
const ignored = await page.evaluate(() => window.__say('nexus bir şey yap'));
await page.waitForTimeout(300);
ok(ignored === false && (await page.locator('.msg.user').count()) === 0, 'kapalıyken konuşulan hiçbir yere gitmedi');

console.log('\n[10] Ayar kalıcılığı ve konsol');
ok((await page.evaluate(() => window.NEXUS.store.settings().handsFree)) === false, '"uyu" kalıcı ayarı da kapattı (yeniden açılışta kendiliğinden dinlemez)');
const real = errors.filter((e) => !/favicon|manifest|Failed to load resource|wakeLock|Hiçbir bağlantı/i.test(e));
ok(real.length === 0, real.length ? 'konsol hatası: ' + real.join(' | ') : 'konsol temiz');

await browser.close();
console.log(fails.length ? `\n✖ ${fails.length} başarısız:\n- ` + fails.join('\n- ') : '\n✔ Tüm ses testleri geçti');
process.exit(fails.length ? 1 : 0);
