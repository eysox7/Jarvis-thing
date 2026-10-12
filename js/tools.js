// Araç kayıt defteri. Ajan bunları isimle çağırır.
// Her araç: {name, desc, params, danger?, run(args, ctx)}
// ctx = { confirm(msg), ask(question), notify(t,b), settings, refresh() }

import * as S from './store.js';
import { calcExpression, parseWhen, fmtDate, truncate } from './util.js';
import { predict, compare, optimize, DOMAINS, CHANNELS, FRAMES } from './audience/engine.js';
import { INSTITUTIONS } from './audience/institutions.js';
import { THEORIES } from './audience/theories.js';
import { calibrate, CALIBRATION_METRICS } from './audience/calibrate.js';
import { runSurvey } from './audience/survey.js';
import { extractMessage } from './audience/extract.js';
import { SCENARIOS } from './audience/scenarios.js';
import { chatWithFallback } from './providers.js';
import { predictChoice, whatIf as choiceWhatIf, resolveChoice } from './decision/model.js';
import { DECISION_DOMAINS } from './decision/domains.js';
import { parseCSV, prepareRows } from './decision/data.js';
import { learn, calibrateShares, shareDiagnostics } from './decision/estimate.js';
import { buildEnsemble, siliconProbs, mixShares } from './decision/ensemble.js';
import { aggregatePolls } from './decision/polls.js';
import { samplePopulation } from './audience/personas.js';
import { DIMENSIONS } from './audience/personas.js';

const T = {};
const def = (t) => { T[t.name] = t; return t; };

/* ---------------- görevler ---------------- */

def({
  name: 'task_add',
  desc: 'Yeni bir görev oluşturur.',
  params: {
    title: 'string (zorunlu) — görev başlığı',
    notes: 'string — detay',
    due: 'string — son tarih: ISO tarih, "yarın 15:00", "2 saat sonra", "30 dk"',
    priority: '"low" | "normal" | "high"',
  },
  run: (a) => {
    if (!a.title) throw new Error('title zorunlu');
    const t = S.addTask({
      title: String(a.title),
      notes: a.notes ? String(a.notes) : '',
      due: parseWhen(a.due),
      priority: ['low', 'normal', 'high'].includes(a.priority) ? a.priority : 'normal',
    });
    return { id: t.id, title: t.title, due: t.due ? fmtDate(t.due) : null, priority: t.priority };
  },
});

def({
  name: 'task_list',
  desc: 'Görevleri listeler.',
  params: { status: '"open" | "done" | "all" (varsayılan open)', query: 'string — başlıkta arama' },
  run: (a) => {
    const st = a.status || 'open';
    let list = S.db().tasks;
    if (st !== 'all') list = list.filter((t) => t.status === st);
    if (a.query) {
      const q = String(a.query).toLocaleLowerCase('tr');
      list = list.filter((t) => (t.title + ' ' + t.notes).toLocaleLowerCase('tr').includes(q));
    }
    return {
      count: list.length,
      tasks: list.slice(0, 60).map((t) => ({
        id: t.id, title: t.title, status: t.status, priority: t.priority,
        due: t.due ? fmtDate(t.due) : null, notes: t.notes || undefined,
      })),
    };
  },
});

def({
  name: 'task_update',
  desc: 'Bir görevi günceller (tamamlamak için status="done").',
  params: {
    id: 'string (zorunlu) — task_list ile öğrenilir',
    title: 'string', notes: 'string', due: 'string', priority: 'string',
    status: '"open" | "done"',
  },
  run: (a) => {
    if (!a.id) throw new Error('id zorunlu');
    const patch = {};
    for (const k of ['title', 'notes', 'priority', 'status']) if (a[k] !== undefined) patch[k] = a[k];
    if (a.due !== undefined) patch.due = parseWhen(a.due);
    const t = S.updateTask(a.id, patch);
    if (!t) throw new Error('görev bulunamadı: ' + a.id);
    return { id: t.id, title: t.title, status: t.status, due: t.due ? fmtDate(t.due) : null };
  },
});

def({
  name: 'task_delete',
  desc: 'Bir görevi siler.',
  params: { id: 'string (zorunlu)' },
  danger: true,
  run: (a) => {
    const t = S.db().tasks.find((x) => x.id === a.id);
    if (!t) throw new Error('görev bulunamadı: ' + a.id);
    S.removeTask(a.id);
    return { deleted: t.title };
  },
});

/* ---------------- notlar ---------------- */

def({
  name: 'note_add',
  desc: 'Not kaydeder.',
  params: { title: 'string (zorunlu)', body: 'string — not içeriği' },
  run: (a) => {
    if (!a.title && !a.body) throw new Error('title veya body gerekli');
    const n = S.addNote({ title: String(a.title || 'Not'), body: String(a.body || '') });
    return { id: n.id, title: n.title };
  },
});

def({
  name: 'note_search',
  desc: 'Notlarda arama yapar (query boşsa hepsini döner).',
  params: { query: 'string' },
  run: (a) => {
    const q = String(a.query || '').toLocaleLowerCase('tr');
    const list = S.db().notes.filter((n) => !q || (n.title + ' ' + n.body).toLocaleLowerCase('tr').includes(q));
    return { count: list.length, notes: list.slice(0, 25).map((n) => ({ id: n.id, title: n.title, body: truncate(n.body, 600) })) };
  },
});

def({
  name: 'note_delete',
  desc: 'Notu siler.',
  params: { id: 'string (zorunlu)' },
  danger: true,
  run: (a) => {
    const n = S.db().notes.find((x) => x.id === a.id);
    if (!n) throw new Error('not bulunamadı');
    S.removeNote(a.id);
    return { deleted: n.title };
  },
});

/* ---------------- kalıcı hafıza ---------------- */

def({
  name: 'memory_remember',
  desc: 'Kullanıcı hakkında kalıcı bilgi saklar; her sohbette sistem mesajına eklenir. Kalıcı tercih/olgu için kullan.',
  params: { key: 'string (zorunlu)', value: 'string (zorunlu)' },
  run: (a) => {
    if (!a.key) throw new Error('key zorunlu');
    S.remember(String(a.key), String(a.value ?? ''));
    return { saved: { [a.key]: a.value } };
  },
});

def({
  name: 'memory_forget',
  desc: 'Hafızadan bir anahtarı siler.',
  params: { key: 'string (zorunlu)' },
  run: (a) => { S.forget(String(a.key)); return { forgot: a.key }; },
});

def({
  name: 'memory_list',
  desc: 'Hafızadaki tüm kayıtları döner.',
  params: {},
  run: () => ({ memory: S.db().memory }),
});

/* ---------------- zaman & hatırlatma ---------------- */

def({
  name: 'get_datetime',
  desc: 'Şu anki tarih, saat ve zaman dilimini döner.',
  params: {},
  run: () => {
    const d = new Date();
    return {
      iso: d.toISOString(),
      yerel: d.toLocaleString('tr-TR'),
      gun: d.toLocaleDateString('tr-TR', { weekday: 'long' }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  },
});

def({
  name: 'reminder_set',
  desc: 'Belirli bir zamanda bildirim çıkarır. Uygulama açıkken çalışır.',
  params: { when: 'string (zorunlu) — "10 dk", "yarın 09:00", ISO tarih', message: 'string (zorunlu)' },
  run: (a, ctx) => {
    const at = parseWhen(a.when);
    if (!at) throw new Error('zaman anlaşılamadı: ' + a.when);
    if (at < Date.now()) throw new Error('geçmiş bir zaman verdin');
    const r = S.addReminder({ at, message: String(a.message || 'Hatırlatma') });
    ctx?.scheduleReminders?.();
    return { id: r.id, at: fmtDate(at), message: r.message };
  },
});

def({
  name: 'reminder_list',
  desc: 'Bekleyen hatırlatmaları listeler.',
  params: {},
  run: () => ({
    reminders: S.db().reminders.filter((r) => !r.fired)
      .map((r) => ({ id: r.id, at: fmtDate(r.at), message: r.message })),
  }),
});

def({
  name: 'reminder_cancel',
  desc: 'Hatırlatmayı iptal eder.',
  params: { id: 'string (zorunlu)' },
  run: (a) => { S.removeReminder(a.id); return { cancelled: a.id }; },
});

/* ---------------- hesap ---------------- */

def({
  name: 'calculate',
  desc: 'Matematiksel ifade hesaplar. + - * / % ^ ve sqrt, abs, sin, cos, tan, log, log10, exp, round, floor, ceil, min, max, pow, pi, e.',
  params: { expression: 'string (zorunlu) — ör. "(1250*1.2)/3"' },
  run: (a) => ({ expression: a.expression, result: calcExpression(a.expression) }),
});

/* ---------------- web ---------------- */

def({
  name: 'web_search',
  desc: 'İnternette arama yapar. Ayarlar > Web arama sağlayıcısı tanımlıysa çalışır.',
  params: { query: 'string (zorunlu)', count: 'number — sonuç sayısı (varsayılan 5)' },
  run: async (a, ctx) => {
    const st = ctx.settings;
    const key = st.searchKey, prov = st.searchProvider;
    if (!prov || !key) throw new Error('Web arama yapılandırılmamış. Ayarlar > Web arama sağlayıcısı ve anahtarını gir.');
    const n = Math.min(Number(a.count) || 5, 10);
    const q = String(a.query || '');
    if (!q) throw new Error('query zorunlu');

    let res, items = [];
    if (prov === 'tavily') {
      res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({ query: q, max_results: n }),
      });
      if (!res.ok) throw new Error('Tavily HTTP ' + res.status);
      const d = await res.json();
      if (d.answer) items.push({ title: 'Özet', snippet: d.answer, url: '' });
      items.push(...(d.results || []).map((r) => ({ title: r.title, url: r.url, snippet: truncate(r.content, 400) })));
    } else if (prov === 'brave') {
      res = await fetch(`https://api.search.brave.com/res/v1/web/search?count=${n}&q=` + encodeURIComponent(q), {
        headers: { accept: 'application/json', 'x-subscription-token': key },
      });
      if (!res.ok) throw new Error('Brave HTTP ' + res.status);
      const d = await res.json();
      items = (d.web?.results || []).map((r) => ({ title: r.title, url: r.url, snippet: truncate(r.description, 400) }));
    } else if (prov === 'serper') {
      res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ q, num: n }),
      });
      if (!res.ok) throw new Error('Serper HTTP ' + res.status);
      const d = await res.json();
      items = (d.organic || []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet }));
    } else {
      throw new Error('bilinmeyen arama sağlayıcısı: ' + prov);
    }
    return { query: q, results: items.slice(0, n + 1) };
  },
});

def({
  name: 'http_fetch',
  desc: 'Bir URL çeker ve içeriğini döner. Hedef site CORS izni vermezse başarısız olur (Ayarlar > proxy ön eki yardımcı olabilir).',
  params: {
    url: 'string (zorunlu)',
    method: '"GET" | "POST" (varsayılan GET)',
    body: 'string — POST gövdesi',
    headers: 'object — ek başlıklar',
    as: '"text" | "json" (varsayılan text)',
  },
  danger: true,
  run: async (a, ctx) => {
    if (!/^https?:\/\//i.test(a.url || '')) throw new Error('geçerli bir http(s) adresi ver');
    const proxy = ctx.settings.proxy;
    const url = proxy
      ? (proxy.includes('{url}') ? proxy.replace('{url}', encodeURIComponent(a.url))
        : proxy.endsWith('=') ? proxy + encodeURIComponent(a.url) : proxy.replace(/\/+$/, '') + '/' + a.url)
      : a.url;
    const res = await fetch(url, {
      method: a.method || 'GET',
      headers: a.headers || {},
      body: a.method && a.method !== 'GET' ? a.body : undefined,
    });
    const raw = await res.text();
    let out = raw;
    if ((a.as || 'text') === 'json') { try { out = JSON.parse(raw); } catch { /* metin bırak */ } }
    else out = raw.replace(/<script[\s\S]*?<\/script>/gi, '')
                  .replace(/<style[\s\S]*?<\/style>/gi, '')
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/\s{2,}/g, ' ')
                  .trim();
    return { status: res.status, content: truncate(out, 6000) };
  },
});

def({
  name: 'open_url',
  desc: 'Telefonda bir bağlantıyı yeni sekmede açar.',
  params: { url: 'string (zorunlu)' },
  danger: true,
  run: (a) => {
    if (!/^https?:\/\//i.test(a.url || '')) throw new Error('geçerli bir http(s) adresi ver');
    window.open(a.url, '_blank', 'noopener');
    return { opened: a.url };
  },
});

/* ---------------- cihaz ---------------- */

def({
  name: 'device_info',
  desc: 'Cihaz/tarayıcı bilgisi: platform, dil, ekran, ağ, pil.',
  params: {},
  run: async () => {
    const out = {
      platform: navigator.platform,
      dil: navigator.language,
      ekran: `${screen.width}x${screen.height}`,
      cevrimici: navigator.onLine,
      cekirdek: navigator.hardwareConcurrency,
    };
    try {
      if (navigator.getBattery) {
        const b = await navigator.getBattery();
        out.pil = Math.round(b.level * 100) + '%' + (b.charging ? ' (şarjda)' : '');
      }
    } catch { /* yoksay */ }
    if (navigator.connection?.effectiveType) out.baglanti = navigator.connection.effectiveType;
    return out;
  },
});

def({
  name: 'geolocate',
  desc: 'Cihazın konumunu alır (kullanıcı izni gerekir).',
  params: {},
  danger: true,
  run: () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('bu cihazda konum yok'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5), dogruluk_m: Math.round(p.coords.accuracy) }),
      (e) => reject(new Error('konum alınamadı: ' + e.message)),
      { timeout: 12000, enableHighAccuracy: false },
    );
  }),
});

def({
  name: 'clipboard_write',
  desc: 'Metni panoya kopyalar.',
  params: { text: 'string (zorunlu)' },
  run: async (a) => { await navigator.clipboard.writeText(String(a.text ?? '')); return { copied: true, length: String(a.text ?? '').length }; },
});

def({
  name: 'share',
  desc: 'Telefonun paylaş menüsünü açar (WhatsApp, mail vb.).',
  params: { text: 'string', url: 'string', title: 'string' },
  danger: true,
  run: async (a) => {
    if (!navigator.share) throw new Error('bu tarayıcıda paylaşım yok');
    await navigator.share({ title: a.title, text: a.text, url: a.url });
    return { shared: true };
  },
});

def({
  name: 'notify',
  desc: 'Cihazda anlık bildirim gösterir.',
  params: { title: 'string (zorunlu)', body: 'string' },
  run: async (a, ctx) => { await ctx.notify(String(a.title || 'N.E.X.U.S.'), String(a.body || '')); return { shown: true }; },
});

def({
  name: 'speak',
  desc: 'Metni sesli okur.',
  params: { text: 'string (zorunlu)' },
  run: (a, ctx) => { ctx.speak(String(a.text || '')); return { spoken: true }; },
});

def({
  name: 'vibrate',
  desc: 'Telefonu titretir.',
  params: { ms: 'number — süre (varsayılan 200)' },
  run: (a) => {
    if (!navigator.vibrate) throw new Error('titreşim desteklenmiyor');
    navigator.vibrate(Math.min(Number(a.ms) || 200, 3000));
    return { vibrated: true };
  },
});

/* ---------------- etkileşim ---------------- */

def({
  name: 'ask_user',
  desc: 'Kullanıcıya soru sorar ve cevabını bekler. Eksik bilgi varsa uydurma, bunu kullan.',
  params: { question: 'string (zorunlu)', options: 'string[] — hazır seçenekler (opsiyonel)' },
  run: async (a, ctx) => {
    const ans = await ctx.ask(String(a.question || '?'), Array.isArray(a.options) ? a.options : []);
    return { answer: ans };
  },
});

/* ---------------- kitle tahmini (MatrAIx × iletişim kuramları) ---------------- */

const MSG_PARAMS = {
  metin: 'string — gerçek mesaj metni; verilirse alan/çerçeve/duruş vb. eksik alanlar metinden çıkarılır',
  alan: `string — ${Object.keys(DOMAINS).join(' | ')}`,
  kurum: 'string — kurum türü (audience_catalog) veya institution_save ile kaydedilmiş kurum id',
  kanallar: `string[] — ${Object.keys(CHANNELS).join(' | ')} (boşsa kurumun kanalları)`,
  cerceve: `string — ${Object.keys(FRAMES).join(' | ')}`,
  arguman_kalitesi: 'number 0..1 — kanıt/argüman gücü (ELM merkezi yol)',
  cevresel_ipucu: 'number 0..1 — ünlü yüz, estetik, duygu (ELM çevresel yol)',
  durus: '"egemen" | "notr" | "muhalif" — mesajın egemen ideolojiyle ilişkisi (Hall/Gramsci)',
  egilim: '"sol" | "merkez" | "sag" veya -1..1 — mesajın ideolojik eğilimi',
  yenilik: 'number 0..1 — yeni bir ürün/davranış mı (Rogers)',
  tekrar: 'number — kaç kez gösterilecek (gündem belirleme)',
  tartismali: 'number 0..1 — konunun tartışmalılığı (suskunluk sarmalı)',
  ticari: 'number 0..1 — ticari/reklam niteliği (kültür endüstrisi)',
  temsil: 'number -1..1 — kalıp yargı (-1) … kapsayıcı temsil (1)',
  egemen_ideoloji: 'number -1..1 — bağlamdaki egemen bloğun ideolojik konumu (varsayılan 0.5)',
};
const OPT_PARAMS = {
  hedef: `object — hedef kitle, ör. {"yas":"18-24"} veya {"ideoloji":["sol","merkez"]}. Boyutlar: ${Object.keys(DIMENSIONS).join(', ')}`,
  mercek: '"butunlesik" (varsayılan) | "ana_akim" | "elestirel"',
  n: 'number — sentetik persona sayısı (varsayılan 2000)',
};

/** Ajanın düz argümanlarını motor girdisine çevirir; kayıtlı kurum ve kalibrasyonu bağlar. */
function audienceInput(a) {
  const aud = S.db().audience || { institutions: {}, calibration: {} };
  const kurumId = a.kurum || a.institution;
  const kurum = kurumId && aud.institutions[kurumId] ? aud.institutions[kurumId] : kurumId;
  const msg = { ...a, institution: kurum };
  delete msg.kurum;
  const calibration = (kurumId && aud.calibration[kurumId]) || aud.calibration._genel || undefined;
  const marginals = (kurumId && aud.institutions[kurumId]?.kitle) || undefined;
  return { msg, opts: { target: a.hedef, lens: a.mercek, n: a.n, calibration, marginals } };
}

const compact = (r) => ({ ...r, kuramlar: r.kuramlar.slice(0, 8) });

def({
  name: 'audience_predict',
  desc: 'Bir mesajın/kampanyanın kitle tepkisini tahmin eder: erişim, tutum, paylaşım, benimseme, Hall okumaları (egemen/müzakereci/karşıt), hangi iletişim kuramının ne kadar etkilediği, segment kırılımı ve model belirsizliği bandı (kullanıcıya mutlaka aktar: duyarlılık yüksekse sonucu kesin gibi sunma). MatrAIx tarzı sentetik persona nüfusu üzerinde ana akım + eleştirel kuramlarla simüle eder. Her alanda (siyaset, sağlık, ticaret, eğitim, kriz…) çalışır.',
  params: {
    ...MSG_PARAMS, ...OPT_PARAMS,
    segment: `string[] — kırılım boyutları, ör. ["yas","ideoloji"]`,
    model_belirsizligi: 'boolean — kuram ağırlıklarını bozarak model belirsizliği bandı ve mercek karşılaştırması ekler (varsayılan true)',
  },
  run: (a) => {
    const { msg, opts } = audienceInput(a);
    const seg = Array.isArray(a.segment) ? a.segment : a.segment ? [a.segment] : [];
    return compact(predict(msg, { ...opts, segmentBy: seg, modelUncertainty: a.model_belirsizligi !== false }));
  },
});

def({
  name: 'audience_compare',
  desc: 'Birden çok mesaj varyantını aynı sentetik nüfusta karşılaştırır (sanal A/B testi) ve kazananı söyler.',
  params: {
    varyantlar: 'object[] (zorunlu) — her biri {ad, ...audience_predict mesaj alanları}',
    metrik: '"ortalama_tutum" | "erisim_yuzde" | "olumlu_yuzde" | "paylasim_yuzde" | "benimseme_yuzde"',
    ...OPT_PARAMS,
  },
  run: (a) => {
    if (!Array.isArray(a.varyantlar) || a.varyantlar.length < 2) throw new Error('varyantlar en az 2 öğeli dizi olmalı');
    const inputs = a.varyantlar.map((v) => audienceInput({ ...v, hedef: a.hedef, mercek: a.mercek, n: a.n }));
    return compare(inputs.map((x) => ({ message: x.msg, opts: x.opts })), {}, a.metrik || 'ortalama_tutum');
  },
});

def({
  name: 'audience_optimize',
  desc: 'Bir kurum ve alan için en etkili çerçeve × kanal kombinasyonunu arar; en iyi ve en kötü stratejileri döner.',
  params: { ...MSG_PARAMS, ...OPT_PARAMS, metrik: 'string — audience_compare ile aynı' },
  run: (a) => {
    const { msg, opts } = audienceInput(a);
    return optimize(msg, { ...opts, n: Math.min(Number(a.n) || 600, 1500) }, a.metrik || 'ortalama_tutum');
  },
});

def({
  name: 'audience_calibrate',
  desc: 'Kurumun geçmiş kampanyalarındaki GERÇEK sonuçlarla (anket, erişim, dönüşüm) modeli kalibre eder ve kaydeder; sonraki tahminler bu kuruma göre ayarlanır. Gözlem uydurma — yalnızca kullanıcının verdiği veriyi kullan.',
  params: {
    kurum: 'string — kalibrasyonun bağlanacağı kurum id (boşsa genel kalibrasyon)',
    gozlemler: `object[] (zorunlu) — her biri {mesaj: {audience_predict mesaj alanları}, hedef?: {...}, gozlenen: {${CALIBRATION_METRICS.join(', ')}}}`,
    mercek: '"butunlesik" | "ana_akim" | "elestirel"',
  },
  run: (a) => {
    if (!Array.isArray(a.gozlemler) || !a.gozlemler.length) throw new Error('gozlemler dizisi zorunlu');
    const key = a.kurum || '_genel';
    const obs = a.gozlemler.map((g) => {
      const { msg, opts } = audienceInput({ ...(g.mesaj || g.message || {}), kurum: (g.mesaj || {}).kurum || a.kurum });
      return { message: msg, opts: { marginals: opts.marginals }, hedef: g.hedef, gozlenen: g.gozlenen || g.observed };
    });
    const cal = calibrate(obs, { lens: a.mercek });
    S.setCalibration(key, { ...cal, at: Date.now() });
    return { kalibrasyon: key, ...cal };
  },
});

def({
  name: 'audience_survey',
  desc: 'MatrAIx tarzı sanal anket: sentetik nüfustan çeşitli personalar seçer, bağlı dil modeline her birini canlandırtarak mesaja tepkisini sorar ve kuram motorunun aynı personalar için tahminiyle karşılaştırır (uyum/korelasyon). Model çağrısı yapar.',
  params: { ...MSG_PARAMS, ...OPT_PARAMS, katilimci: 'number — persona sayısı (varsayılan 8, en çok 24)', tabaka: 'string — çeşitliliğin korunacağı boyut (varsayılan ideoloji)' },
  run: async (a, ctx) => {
    const { msg, opts } = audienceInput(a);
    const chat = async (system, user) => (await chatWithFallback(S.profileChain(), {
      system, messages: [{ role: 'user', content: user }], temperature: 0.7, proxy: ctx?.settings?.proxy,
    })).text;
    return runSurvey(msg, { ...opts, k: a.katilimci, by: a.tabaka, chat });
  },
});

def({
  name: 'audience_extract',
  desc: 'Bir mesaj metninden alan, çerçeve, argüman kalitesi, ticarilik, egemen/karşı duruş, ideolojik eğilim, temsil ve yenilik özelliklerini çıkarır; hangi kelimelere dayandığını gösterir.',
  params: { metin: 'string (zorunlu)' },
  run: (a) => {
    if (!a.metin) throw new Error('metin zorunlu');
    return extractMessage(String(a.metin));
  },
});

def({
  name: 'audience_catalog',
  desc: 'Kitle tahmininde kullanılabilen alanları, çerçeveleri, kanalları, kurum türlerini, kayıtlı kurumları, persona boyutlarını ve kuramları listeler.',
  params: { bolum: '"alanlar" | "cerceveler" | "kanallar" | "kurumlar" | "boyutlar" | "kuramlar" | "senaryolar" (boşsa hepsi, kısa)' },
  run: (a) => {
    const aud = S.db().audience || { institutions: {} };
    const all = {
      alanlar: Object.fromEntries(Object.entries(DOMAINS).map(([k, v]) => [k, v.label])),
      cerceveler: FRAMES,
      kanallar: Object.fromEntries(Object.entries(CHANNELS).map(([k, v]) => [k, v.label])),
      kurumlar: {
        turler: Object.fromEntries(Object.entries(INSTITUTIONS).map(([k, v]) => [k, v.ad])),
        kayitli: Object.fromEntries(Object.entries(aud.institutions).map(([k, v]) => [k, v.ad || k])),
      },
      boyutlar: Object.fromEntries(Object.entries(DIMENSIONS).map(([k, v]) => [k, Object.keys(v.base)])),
      kuramlar: THEORIES.map((t) => ({ id: t.id, ad: t.ad, kurucu: t.kurucu, gelenek: t.gelenek, ozet: t.ozet })),
      senaryolar: SCENARIOS,
    };
    if (a.bolum && all[a.bolum]) return { [a.bolum]: all[a.bolum] };
    return { ...all, kuramlar: THEORIES.map((t) => `${t.id} (${t.gelenek})`), senaryolar: Object.fromEntries(Object.entries(SCENARIOS).map(([k, v]) => [k, v.ad])) };
  },
});

def({
  name: 'institution_save',
  desc: 'Kurumun kendi profilini kaydeder; sonra audience_* araçlarında kurum=id ile kullanılır. Kurumun kendi kitle verisi (kitle) örneklemi ezer.',
  params: {
    id: 'string (zorunlu) — kısa kimlik, ör. "izmir_bb"',
    ad: 'string — görünen ad',
    tur: 'string — temel kurum türü (audience_catalog kurumlar)',
    sahiplik: '"devlet" | "sermaye" | "bagimsiz" | "uye"',
    ideoloji: 'number -1..1', hegemonik: 'number 0..1 — iktidar yapısına gömülülük',
    guvenilirlik: 'number 0..1', ticari: 'number 0..1',
    uzmanlik: 'object — {alan: 0..1}', kanallar: 'string[]',
    kitle: 'object — kurumun kitle marjinalleri, ör. {"yas":{"18-24":40,"25-34":30}}',
  },
  run: (a) => {
    const id = String(a.id || '').trim().replace(/\s+/g, '_');
    if (!id) throw new Error('id zorunlu');
    const { id: _ignored, ...profile } = a;
    predict({ institution: profile }, { n: 50, bootstrap: 0, marginals: a.kitle });   // geçersiz profili kaydetmeden yakala
    const saved = S.saveInstitution(id, profile);
    return { kaydedildi: id, ad: saved.ad || id };
  },
});

def({
  name: 'institution_delete',
  desc: 'Kayıtlı kurum profilini ve kalibrasyonunu siler.',
  params: { id: 'string (zorunlu)' },
  danger: true,
  run: (a) => {
    if (!S.db().audience?.institutions?.[a.id]) throw new Error('kurum bulunamadı: ' + a.id);
    S.removeInstitution(a.id);
    return { silindi: a.id };
  },
});

/* ---------------- karar tahmini (oy · satın alma · gündelik) ---------------- */

const decDb = () => S.db().decision || { scenarios: {}, datasets: {}, models: {} };

/** Senaryo kimliği ya da satır içi tanımdan seçim tanımı + kayıtlı model. */
function scenarioOf(a) {
  const d = decDb();
  if (a.senaryo) {
    const sc = d.scenarios[a.senaryo];
    if (!sc) throw new Error(`senaryo bulunamadı: ${a.senaryo}. Önce decision_scenario_save ile kaydet. Kayıtlı: ${Object.keys(d.scenarios).join(', ') || '(yok)'}`);
    const spec = { ...sc, baglam: { ...(sc.baglam || {}), ...(a.baglam || {}) }, kampanya: a.kampanya };
    return { spec, model: a.kuram_modeli ? undefined : d.models[a.senaryo], id: a.senaryo };
  }
  if (!a.alan || !Array.isArray(a.secenekler)) throw new Error('senaryo id ya da alan + secenekler ver');
  return { spec: { alan: a.alan, secenekler: a.secenekler, baglam: a.baglam || {}, kampanya: a.kampanya }, model: undefined, id: null };
}

const chatFn = (ctx) => async (system, user) => (await chatWithFallback(S.profileChain(), {
  system, messages: [{ role: 'user', content: user }], temperature: 0.7, proxy: ctx?.settings?.proxy,
})).text;

const SCEN_PARAMS = {
  senaryo: 'string — kayıtlı senaryo id (decision_scenario_save). Verilirse alan/secenekler gerekmez',
  alan: '"siyaset" | "ticaret" | "gundelik"',
  secenekler: 'object[] — her biri {id, ad, ...özellikler}; özellikler için decision_catalog',
  baglam: 'object — ör. siyaset için {"ekonomi_algisi": -0.4}',
};

def({
  name: 'decision_predict',
  desc: 'İnsanların bir karar durumunda (seçimde oy, ürün satın alma, gündelik/sağduyu kararı) ne seçeceğini tahmin eder: seçenek payları, en olası seçim, kararsızlık, segment kırılımı ve hangi kuramın sonucu ne kadar ittiği. Senaryoya veriden öğrenilmiş model bağlıysa onu kullanır ve doğrulama isabetini raporlar; yoksa kuram öncülleriyle çalışır (bunu kullanıcıya söyle).',
  params: {
    ...SCEN_PARAMS,
    hedef: 'object — hedef kitle filtresi, ör. {"yas":"18-24"}',
    segment: 'string[] — kırılım boyutları',
    kampanya: 'object — {secenek: id, mesaj: {audience_predict mesaj alanları}}: kampanyanın karara etkisi',
    kuram_modeli: 'boolean — kayıtlı modeli yok sayıp yalnız kuramla tahmin et',
  },
  run: (a) => {
    const { spec, model } = scenarioOf(a);
    const seg = Array.isArray(a.segment) ? a.segment : a.segment ? [a.segment] : [];
    const r = predictChoice(spec, { model, target: a.hedef, segmentBy: seg, n: 2000 });
    if (model?.topluluk?.silikon_paylari) r.topluluk_paylari = mixShares({ ogrenilmis: r.paylar, silikon: model.topluluk.silikon_paylari }, model.topluluk.agirliklar);
    r.terim_etkileri = r.terim_etkileri?.slice(0, 8);
    return r;
  },
});

def({
  name: 'decision_whatif',
  desc: 'Ne olur analizi: bir seçeneğin özelliklerini (fiyat, lider puanı, norm, varsayılan…) veya bağlamı değiştirince payların nasıl kayacağını gösterir.',
  params: { ...SCEN_PARAMS, degisiklik: 'object (zorunlu) — {secenekler: {id: {özellik: yeni}}, baglam: {...}, kampanya?: {...}}', hedef: 'object' },
  run: (a) => {
    if (!a.degisiklik) throw new Error('degisiklik zorunlu');
    const { spec, model } = scenarioOf(a);
    return choiceWhatIf(spec, a.degisiklik, { model, target: a.hedef, n: 2000 });
  },
});

def({
  name: 'decision_scenario_save',
  desc: 'Bir karar senaryosunu (seçim, ürün pazarı, gündelik karar) kaydeder; veri yükleme, öğrenme ve tahmin bu id ile yapılır.',
  params: { id: 'string (zorunlu)', ad: 'string', alan: '"siyaset" | "ticaret" | "gundelik" (zorunlu)', secenekler: 'object[] (zorunlu)', baglam: 'object' },
  run: (a) => {
    const id = String(a.id || '').trim().replace(/\s+/g, '_');
    if (!id) throw new Error('id zorunlu');
    const spec = { ad: a.ad || id, alan: a.alan, secenekler: a.secenekler, baglam: a.baglam || {} };
    resolveChoice(spec);
    S.saveScenario(id, spec);
    return { kaydedildi: id, secenekler: spec.secenekler.map((x) => x.id ?? x.ad) };
  },
});

def({
  name: 'decision_data_import',
  desc: 'Kurumun bireysel verisini (anket, seçim sonrası anket, satış/CRM, conjoint) CSV olarak senaryoya yükler. Sütunlar: persona alanları (yas, cinsiyet, egitim, gelir, ideoloji…) + secim; opsiyonel agirlik, kisi (aynı kişinin birden çok seçimi: panel/conjoint), onceki (önceki oy/marka — en güçlü yordayıcı), satıra özgü "<özellik>_<seçenek>" (ör. fiyat_A) ve "var_<seçenek>". Veri uydurma — yalnızca kullanıcının verdiği veriyi yükle.',
  params: { senaryo: 'string (zorunlu)', csv: 'string (zorunlu) — başlık satırlı CSV metni' },
  run: (a) => {
    const { spec, id } = scenarioOf({ senaryo: a.senaryo });
    const prep = prepareRows(parseCSV(a.csv), spec);
    if (!prep.rows.length) throw new Error('geçerli satır yok: ' + prep.uyarilar.join('; '));
    S.saveDataset(id, prep);
    const counts = {};
    for (const r of prep.rows) counts[r.secim] = (counts[r.secim] || 0) + 1;
    return { senaryo: id, satir: prep.rows.length, secim_dagilimi: counts, eslesen_boyutlar: prep.eslesen_boyutlar, uyarilar: prep.uyarilar };
  },
});

def({
  name: 'decision_learn',
  desc: 'Senaryoya yüklenen veriden kuram öncüllü modeli öğrenir, 5-katlı çapraz doğrulamayla görülmemiş verideki isabeti ölçer (kuram ve çoğunluk temel modelleriyle kıyaslı) ve modeli kaydeder. Hangi kuramın bu kitlede veriyle desteklendiğini de raporlar.',
  params: {
    senaryo: 'string (zorunlu)', kuram_guveni: 'number — kuram öncülünün sıkılığı σ (varsayılan 1; küçük = kurama daha bağlı)',
    siniflar: '1 | 2 | 3 | "oto" — gizli tercih sınıfları (panel/conjoint verisinde anlamlı; varsayılan: kişi kimliği varsa "oto", yoksa 1)',
  },
  run: (a) => {
    const { spec, id } = scenarioOf({ senaryo: a.senaryo });
    const ds = decDb().datasets[id];
    if (!ds?.rows?.length) throw new Error('bu senaryoda veri yok; önce decision_data_import');
    const panel = ds.rows.some((r) => r.kisi !== undefined);
    const model = learn(spec, ds.rows, { kuramGuveni: Number(a.kuram_guveni) || 1, siniflar: a.siniflar ?? (panel ? 'oto' : 1) });
    S.saveModel(id, model);
    const diag = shareDiagnostics(spec, ds.rows, model);
    return { senaryo: id, dogrulama: model.cv, kuramlar: model.kuramlar, gizli_siniflar: model.siniflar?.map((c) => ({ pay: c.pay, etiket: c.etiket })), sinif_secimi: model.sinif_secimi, paylar: diag };
  },
});

def({
  name: 'decision_calibrate_shares',
  desc: 'Bireysel veri yokken bilinen toplam paylara (anket sonucu, geçmiş seçim, pazar payı) senaryoyu kalibre eder ve kaydeder. Kişi düzeyindeki farklılaşmayı kuram terimleri korur.',
  params: { senaryo: 'string (zorunlu)', paylar: 'object (zorunlu) — {seçenek_id: yüzde}' },
  run: (a) => {
    const { spec, id, model } = scenarioOf({ senaryo: a.senaryo });
    const m = calibrateShares(spec, a.paylar || {}, { model });
    S.saveModel(id, { ...(model || {}), ...m });
    return { senaryo: id, hedef: m.hedef, ulasilan: m.son_paylar };
  },
});

def({
  name: 'decision_ensemble',
  desc: 'Senaryonun verisinin %25\'inde kuram, öğrenilmiş model ve (istenirse) dil modeli persona simülasyonunu (silikon örneklem) karşılaştırıp topluluk ağırlıklarını öğrenir; nüfus tahmini bu ağırlıklarla yapılır. silikon=true model çağrısı yapar.',
  params: { senaryo: 'string (zorunlu)', silikon: 'boolean — LLM persona bileşenini ekle', dogrulama_satir: 'number — kaç satırla (varsayılan 40, silikonda maliyet!)' },
  run: async (a, ctx) => {
    const { spec, id } = scenarioOf({ senaryo: a.senaryo });
    const ds = decDb().datasets[id];
    if (!ds?.rows?.length) throw new Error('bu senaryoda veri yok; önce decision_data_import');
    const cut = Math.floor(ds.rows.length * 0.75);
    const train = ds.rows.slice(0, cut), valid = ds.rows.slice(cut, cut + Math.min(Number(a.dogrulama_satir) || 40, 200));
    const learned = learn(spec, train, { cv: false });
    const comps = { kuram: {}, ogrenilmis: learned };
    if (a.silikon) comps.silikon = 'silikon';
    const ens = await buildEnsemble(spec, valid, comps, { chat: chatFn(ctx) });
    const full = { ...(decDb().models[id] || learn(spec, ds.rows, { cv: false })) };
    if (a.silikon && ens.agirliklar.silikon > 0) {
      const panel = samplePopulation({ n: 24, seed: 5 }).map((p) => ({ p }));
      const sp = (await siliconProbs(spec, panel, chatFn(ctx))).filter(Boolean);
      const alts = resolveChoice(spec).alts;
      const sh = Object.fromEntries(alts.map((x, j) => [x.id, Math.round(sp.reduce((s, P) => s + P[j], 0) / sp.length * 1000) / 10]));
      full.topluluk = { agirliklar: { ogrenilmis: ens.agirliklar.ogrenilmis + ens.agirliklar.kuram, silikon: ens.agirliklar.silikon }, silikon_paylari: sh };
    }
    S.saveModel(id, full);
    return { senaryo: id, agirliklar: ens.agirliklar, bilesen_basarimi: ens.bilesen_basarimi, topluluk_basarimi: ens.topluluk_basarimi, dogrulama_satiri: valid.length };
  },
});

def({
  name: 'decision_polls',
  desc: 'Birden çok anketi örneklem büyüklüğü, tazelik ve kuruluş yanlılığına göre birleştirir (hata payıyla); senaryo verilirse birleşik paylara kalibre edip kaydeder. Anket uydurma — yalnızca kullanıcının verdiği anketleri kullan.',
  params: {
    anketler: 'object[] (zorunlu) — her biri {kurulus, tarih: "YYYY-AA-GG", n, paylar: {seçenek_id: yüzde}}',
    senaryo: 'string — verilirse birleşik paylara kalibre edilir',
    yari_omur_gun: 'number — tazelik yarı ömrü (varsayılan 14)',
  },
  run: (a) => {
    const agg = aggregatePolls(a.anketler, { yariOmurGun: Number(a.yari_omur_gun) || 14 });
    if (!a.senaryo) return agg;
    const { spec, id, model } = scenarioOf({ senaryo: a.senaryo });
    const m = calibrateShares(spec, agg.paylar, { model });
    S.saveModel(id, { ...(model || {}), ...m, anket_birlesimi: agg });
    return { ...agg, kalibre_edilen_senaryo: id, ulasilan: m.son_paylar };
  },
});

def({
  name: 'decision_catalog',
  desc: 'Karar alanlarını, her alanın kuram terimlerini ve seçenek özelliklerini, kayıtlı senaryoları ve modellerin doğrulama isabetini listeler.',
  params: {},
  run: () => {
    const d = decDb();
    return {
      alanlar: Object.fromEntries(Object.entries(DECISION_DOMAINS).map(([k, v]) => [k, {
        ad: v.ad, secenek_ozellikleri: v.seceneOzellikleri, baglam: v.baglam,
        kuram_terimleri: v.terimler.map((t) => `${t.id} — ${t.ad} (${t.kuram})`),
      }])),
      senaryolar: Object.fromEntries(Object.entries(d.scenarios).map(([k, v]) => [k, {
        ad: v.ad, alan: v.alan, secenekler: v.secenekler.map((x) => x.id ?? x.ad),
        veri_satiri: d.datasets[k]?.rows?.length || 0,
        model: d.models[k] ? { kaynak: d.models[k].kaynak, isabet_yuzde: d.models[k].cv?.isabet_yuzde } : null,
      }])),
    };
  },
});

/* ---------------- dışa açılan API ---------------- */

export const tools = T;
export const getTool = (name) => T[name];

/** Sistem mesajına gömülecek araç kataloğu. */
export function toolCatalog() {
  return Object.values(T).map((t) => {
    const p = Object.entries(t.params || {}).map(([k, v]) => `    - ${k}: ${v}`).join('\n');
    return `• ${t.name}${t.danger ? ' [onay gerektirir]' : ''} — ${t.desc}` + (p ? `\n${p}` : '');
  }).join('\n');
}

/** Bir aracı çalıştırır; sonucu daima {ok, result|error} olarak sarar. */
export async function runTool(name, args, ctx) {
  const t = T[name];
  if (!t) return { ok: false, error: `Bilinmeyen araç: ${name}. Kullanılabilir: ${Object.keys(T).join(', ')}` };
  try {
    const result = await t.run(args || {}, ctx);
    return { ok: true, result: result === undefined ? { done: true } : result };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
