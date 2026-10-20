// matrAIx — pazar/SEO araştırma motoru ("PR koşusu").
// Bir ürün brifinden: müşteri analizi → N anahtar kelime kombinasyonu → eleştirmen puanlaması
// → deterministik sıralama → markdown rapor.
//
// Model çağrısı dışarıdan verilir (llm), böylece motor hem tarayıcıda (sağlayıcı zinciriyle)
// hem Node'da (scripts/matraix.mjs) aynı kodla çalışır. DOM'a ve depoya dokunmaz.
//
//   llm({system, messages, temperature}) -> Promise<string>

import { extractJson } from './util.js';

export const DEFAULT_COUNT = 15;
export const MAX_COUNT = 40;

/** Puan ağırlıkları. competition ters çevrilir: rekabet düşükse puan yüksek. */
export const WEIGHTS = { intent: 0.4, trigger: 0.3, relevance: 0.2, competition: 0.1 };

export const INTENTS = ['transactional', 'commercial', 'informational'];

const SYSTEM = `Sen matrAIx'sin: kıdemli bir pazar araştırmacısı ve SEO stratejistisin.
Yalnızca istenen biçimde TEK bir JSON nesnesi döndür. JSON dışında hiçbir şey yazma, kod çitiyle sarma.
Arama hacmi, yüzde veya istatistik UYDURMA; bilmediğin sayıyı yazma. Tahminleri "tahmin" olarak işaretle.`;

/** Brifi normalize eder; eksik zorunlu alan varsa hata fırlatır. */
export function normalizeBrief(b = {}) {
  const product = String(b.product || '').trim();
  if (!product) throw new Error('product (ürün) zorunlu');
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;\n]/))
    .map((x) => String(x).trim()).filter(Boolean);
  const count = Math.round(Number(b.count) || DEFAULT_COUNT);
  return {
    product,
    regions: list(b.regions),
    audience: String(b.audience || '').trim(),
    goal: String(b.goal || 'SEO: satın alma güdüsünü en çok tetikleyen anahtar kelimeler').trim(),
    count: Math.min(MAX_COUNT, Math.max(1, count)),
    keywordLang: String(b.keywordLang || 'en').trim(),
    reportLang: String(b.reportLang || 'tr').trim(),
  };
}

function briefText(b) {
  return [
    `Ürün: ${b.product}`,
    `Hedef bölgeler: ${b.regions.join(', ') || '(belirtilmedi)'}`,
    `Hedef kitle: ${b.audience || '(belirtilmedi)'}`,
    `Amaç: ${b.goal}`,
    `Anahtar kelime dili: ${b.keywordLang} · Açıklama dili: ${b.reportLang}`,
  ].join('\n');
}

/** Modelden JSON ister; protokol bozulursa bir kez uyarıp tekrar dener. */
async function askJson(llm, prompt, { temperature = 0.4, signal } = {}) {
  const messages = [{ role: 'user', content: prompt }];
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new DOMException('durduruldu', 'AbortError');
    const text = await llm({ system: SYSTEM, messages, temperature });
    const json = extractJson(text);
    if (json && typeof json === 'object') return json;
    messages.push({ role: 'assistant', content: String(text || '') });
    messages.push({ role: 'user', content: 'Bu geçerli bir JSON değildi. Aynı içeriği yalnızca ham JSON nesnesi olarak tekrar yaz.' });
  }
  throw new Error('Model geçerli JSON döndürmedi (2 deneme).');
}

/* -------------------- aşamalar -------------------- */

export function analysisPrompt(b) {
  return `AŞAMA: MÜŞTERİ ANALİZİ
${briefText(b)}

Bu ürünün hedef müşterisini analiz et. Şu şemada JSON döndür:
{
  "summary": "2-3 cümlelik özet",
  "personas": [{ "name": "kısa ad", "profile": "yaş, yaşam tarzı, alışkanlık" }],
  "motivations": ["satın alma güdüsü", "..."],
  "barriers": ["satın alma engeli", "..."],
  "channels": ["keşif kanalı", "..."],
  "regionNotes": [{ "region": "bölge", "note": "o bölgeye özgü fark" }]
}
personas 1-3, motivations 4-6, barriers 3-5 madde olsun. Açıklamalar ${b.reportLang} dilinde.`;
}

export function generatePrompt(b, analysis, need, exclude = []) {
  return `AŞAMA: KOMBİNASYON ÜRETİMİ
${briefText(b)}

Müşteri analizi:
${JSON.stringify({ motivations: analysis.motivations, barriers: analysis.barriers, personas: analysis.personas })}

Tam olarak ${need} farklı anahtar kelime kombinasyonu üret. Her biri bir ana terim + niteleyici
birleşimi olsun (ör. ürün türü + kalite/kıtlık/kolaylık/etik/hediye/kullanım niteleyicisi).
Satın alma niyeti yüksek olanlara öncelik ver ama 2-3 tane bilgi amaçlı (içerik/blog) kelime de koy.
Anahtar kelimeler ${b.keywordLang} dilinde; açıklamalar ${b.reportLang} dilinde.
${exclude.length ? `Şunları TEKRARLAMA: ${exclude.join(' | ')}` : ''}

Şema:
{
  "combos": [{
    "keyword": "anahtar kelime",
    "head": "ana terim",
    "modifier": "niteleyici",
    "intent": "transactional | commercial | informational",
    "trigger": "tetiklediği satın alma güdüsü",
    "placement": "kullanım yeri (başlık, meta, ürün sayfası, blog...)",
    "localVariants": { "de": "...", "fr": "..." }
  }]
}
localVariants yalnızca hedef bölgede İngilizce dışı büyük bir pazar varsa doldur, yoksa boş nesne.`;
}

export function scorePrompt(b, combos) {
  const list = combos.map((c, i) => `${i + 1}. ${c.keyword} [${c.intent}]`).join('\n');
  return `AŞAMA: ELEŞTİRMEN PUANLAMASI
${briefText(b)}

Aşağıdaki anahtar kelimeleri tarafsız ve sert bir eleştirmen gibi puanla (1-10 tam sayı):
- intent: aramayı yapan kişinin satın almaya ne kadar yakın olduğu
- trigger: satın alma güdüsünü ne kadar güçlü tetiklediği
- relevance: bu ürüne ve hedef kitleye ne kadar uyduğu
- competition: tahmini rekabet zorluğu (10 = devlerle yarış, 1 = boş alan) — tahmin
Hepsine aynı puanı verme; ayırt et.

${list}

Şema (sırayı ve numaraları koru):
{ "scores": [{ "n": 1, "intent": 0, "trigger": 0, "relevance": 0, "competition": 0, "note": "tek cümle gerekçe (${b.reportLang})" }] }`;
}

/* -------------------- saf yardımcılar (testlenebilir) -------------------- */

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Geçersiz/boş/tekrarlı kombinasyonları ayıklar. */
export function cleanCombos(raw, seen = new Set()) {
  const out = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    const keyword = String(c?.keyword || '').trim();
    const k = norm(keyword);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({
      keyword,
      head: String(c.head || '').trim(),
      modifier: String(c.modifier || '').trim(),
      intent: INTENTS.includes(c.intent) ? c.intent : 'commercial',
      trigger: String(c.trigger || '').trim(),
      placement: String(c.placement || '').trim(),
      localVariants: c.localVariants && typeof c.localVariants === 'object' ? c.localVariants : {},
    });
  }
  return out;
}

const clampScore = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : null;
};

/** Ağırlıklı bileşik puan (0-100). Eksik puan varsa null. */
export function composite(s) {
  if (!s) return null;
  const parts = [s.intent, s.trigger, s.relevance, s.competition];
  if (parts.some((p) => p === null || p === undefined)) return null;
  const v = WEIGHTS.intent * s.intent + WEIGHTS.trigger * s.trigger
    + WEIGHTS.relevance * s.relevance + WEIGHTS.competition * (11 - s.competition);
  return Math.round(v * 10);
}

/** Eleştirmen puanlarını kombinasyonlara bağlar, bileşik puana göre sıralar. */
export function applyScores(combos, scores) {
  const byN = new Map();
  for (const s of Array.isArray(scores) ? scores : []) {
    const n = Number(s?.n);
    if (Number.isInteger(n)) byN.set(n, s);
  }
  const ranked = combos.map((c, i) => {
    const s = byN.get(i + 1);
    const sc = s ? {
      intent: clampScore(s.intent), trigger: clampScore(s.trigger),
      relevance: clampScore(s.relevance), competition: clampScore(s.competition),
    } : null;
    return { ...c, scores: sc, note: s?.note ? String(s.note) : '', score: composite(sc) };
  });
  ranked.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  ranked.forEach((c, i) => { c.rank = i + 1; });
  return ranked;
}

const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');

/** Sonuçtan okunabilir markdown rapor üretir (modelsiz, deterministik). */
export function buildReport(run) {
  const { brief: b, analysis: a = {}, combos = [] } = run;
  const L = [];
  L.push(`# matrAIx PR koşusu — ${b.product}`);
  L.push('');
  L.push(`**Bölge:** ${b.regions.join(', ') || '-'} · **Hedef kitle:** ${b.audience || '-'} · **Kombinasyon:** ${combos.length}`);
  L.push('');
  L.push('## Müşteri analizi');
  if (a.summary) L.push(a.summary, '');
  for (const p of a.personas || []) L.push(`- **${p.name || 'Persona'}:** ${p.profile || ''}`);
  if (a.motivations?.length) L.push('', '**Satın alma güdüleri:** ' + a.motivations.join(' · '));
  if (a.barriers?.length) L.push('', '**Engeller:** ' + a.barriers.join(' · '));
  if (a.channels?.length) L.push('', '**Keşif kanalları:** ' + a.channels.join(' · '));
  for (const r of a.regionNotes || []) L.push(`- _${r.region}:_ ${r.note}`);
  L.push('');
  L.push('## Sıralı anahtar kelimeler');
  L.push('');
  L.push('| # | Anahtar kelime | Niyet | Güdü | Puan | Niyet/Güdü/Uyum/Rekabet | Kullanım |');
  L.push('|---|---|---|---|---|---|---|');
  for (const c of combos) {
    const s = c.scores;
    L.push(`| ${c.rank} | **${cell(c.keyword)}** | ${c.intent} | ${cell(c.trigger)} | ${c.score ?? '-'} | `
      + `${s ? `${s.intent}/${s.trigger}/${s.relevance}/${s.competition}` : '-'} | ${cell(c.placement)} |`);
  }
  const top = combos.slice(0, 5);
  if (top.length) {
    L.push('', '## İlk 5');
    top.forEach((c) => L.push(`${c.rank}. **${c.keyword}** — ${c.note || c.trigger}`));
  }
  const locals = combos.filter((c) => Object.keys(c.localVariants || {}).length);
  if (locals.length) {
    L.push('', '## Yerel varyantlar');
    for (const c of locals) {
      L.push(`- ${c.keyword}: ` + Object.entries(c.localVariants).map(([k, v]) => `${k}: _${v}_`).join(' · '));
    }
  }
  L.push('', '> Puanlar modelin niteliksel tahminidir; arama hacmi içermez. '
    + 'Yayından önce Google Keyword Planner / Ahrefs / Semrush ile hedef ülkelerde doğrula.');
  return L.join('\n');
}

/* -------------------- ana giriş -------------------- */

/**
 * Uçtan uca PR koşusu.
 * @param {object} brief  {product, regions, audience, goal, count, keywordLang, reportLang}
 * @param {object} opts   {llm, onStage(stage, info), signal, temperature}
 * @returns {Promise<{brief, analysis, combos, report, calls, createdAt}>}
 */
export async function runMatrix(brief, { llm, onStage, signal, temperature = 0.5 } = {}) {
  if (typeof llm !== 'function') throw new Error('llm fonksiyonu gerekli');
  const b = normalizeBrief(brief);
  let calls = 0;
  const call = (p, t) => { calls++; return askJson(llm, p, { temperature: t, signal }); };

  onStage?.('analyze', { label: 'müşteri analizi' });
  const analysis = await call(analysisPrompt(b), temperature);

  onStage?.('generate', { label: `${b.count} kombinasyon üretiliyor` });
  const seen = new Set();
  let combos = cleanCombos((await call(generatePrompt(b, analysis, b.count), temperature + 0.2)).combos, seen);
  // Eksik ya da tekrarlı geldiyse bir kez tamamlat.
  if (combos.length < b.count) {
    const need = b.count - combos.length;
    onStage?.('generate', { label: `${need} eksik kombinasyon tamamlanıyor` });
    const more = await call(generatePrompt(b, analysis, need, combos.map((c) => c.keyword)), temperature + 0.3);
    combos = combos.concat(cleanCombos(more.combos, seen));
  }
  combos = combos.slice(0, b.count);
  if (!combos.length) throw new Error('Model hiç kombinasyon üretmedi.');

  onStage?.('score', { label: `${combos.length} kombinasyon puanlanıyor` });
  const scored = await call(scorePrompt(b, combos), 0.1);
  const ranked = applyScores(combos, scored.scores);

  const run = { brief: b, analysis, combos: ranked, calls, createdAt: Date.now() };
  run.report = buildReport(run);
  onStage?.('done', { label: 'tamamlandı' });
  return run;
}
