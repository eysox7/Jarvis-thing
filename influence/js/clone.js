// Çekirdek klon: cihaz üstünde, milisaniyede eğitilen lojistik regresyon.
// Kişinin her eksene ne kadar ağırlık verdiğini öğrenir; LLM olmadan da çalışır.
import { DILEMMAS, BY_ID, isHoldout } from './dilemmas.js';

export const TRAITS = [
  { key: 'risk',    lo: 'temkinli',         hi: 'risk alan',          short: 'Risk' },
  { key: 'sosyal',  lo: 'içine dönük',      hi: 'sosyal',             short: 'Sosyal' },
  { key: 'mantik',  lo: 'duygusal',         hi: 'mantıkçı',           short: 'Mantık' },
  { key: 'sabir',   lo: 'anı yaşayan',      hi: 'uzun vadeci',        short: 'Sabır' },
  { key: 'yenilik', lo: 'alışkanlıkçı',     hi: 'yenilik arayan',     short: 'Yenilik' },
  { key: 'sadakat', lo: 'bireysel',         hi: 'sadık',              short: 'Sadakat' },
  { key: 'tutum',   lo: 'harcamayı seven',  hi: 'tutumlu',            short: 'Tutum' },
  { key: 'rekabet', lo: 'uzlaşmacı',        hi: 'rekabetçi',          short: 'Rekabet' },
];

const vec = (v = {}) => TRAITS.map((t) => v[t.key] || 0);
export const features = (d) => { const a = vec(d.a.v), b = vec(d.b.v); return a.map((x, i) => x - b[i]); };
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const dot = (w, x) => w.reduce((s, wi, i) => s + wi * x[i], 0);

/** L2 düzenlemeli, tam yığın gradyan inişi. λ, simüle kişiliklerde sınav doğruluğuna göre seçildi. */
export function train(samples, { epochs = 1000, lr = 0.25, lambda = 0.02 } = {}) {
  const w = new Array(TRAITS.length).fill(0);
  let b = 0;
  const n = samples.length || 1;
  for (let e = 0; e < epochs; e++) {
    const gw = new Array(w.length).fill(0);
    let gb = 0;
    for (const { x, y } of samples) {
      const err = sigmoid(dot(w, x) + b) - y;
      for (let i = 0; i < w.length; i++) gw[i] += err * x[i];
      gb += err;
    }
    for (let i = 0; i < w.length; i++) w[i] -= lr * (gw[i] / n + lambda * w[i]);
    b -= lr * (gb / n);
  }
  return { w: w.map((v) => +v.toFixed(4)), b: +b.toFixed(4) };
}

/** Kendi cevaplarından klon kur. Sınav sorularını (holdout) eğitime sokmaz. */
export function build(answers, profile, prev) {
  const trainSet = {}, testSet = {};
  for (const [id, a] of Object.entries(answers)) {
    if (!BY_ID[id]) continue;
    (isHoldout(id) ? testSet : trainSet)[id] = a.c;
  }
  const samples = Object.entries(trainSet).map(([id, c]) => ({ x: features(BY_ID[id]), y: c === 'A' ? 1 : 0 }));
  const { w, b } = train(samples);
  return {
    id: prev?.id || 'own-' + Date.now().toString(36),
    own: true,
    name: profile.name, code: profile.code, hue: profile.hue, bio: profile.bio || '',
    w, b, train: trainSet, test: testSet,
    sync: prev?.sync && sameKeys(prev.train, trainSet) ? prev.sync : {},
    style: prev?.style || '',
    builtAt: new Date().toISOString(),
    gen: (prev?.gen || 0) + 1,
  };
}
const sameKeys = (a = {}, b = {}) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);

/** Çekirdek tahmin: {choice, conf, pA, by}. Eğitimde gördüğü soruyu hatırlar. */
export function predictCore(clone, d, { useMemory = true } = {}) {
  if (useMemory && clone.train?.[d.id]) return { choice: clone.train[d.id], conf: 0.97, pA: clone.train[d.id] === 'A' ? 0.97 : 0.03, by: 'memory' };
  const pA = sigmoid(dot(clone.w, features(d)) + clone.b);
  const choice = pA >= 0.5 ? 'A' : 'B';
  return { choice, conf: choice === 'A' ? pA : 1 - pA, pA, by: 'core' };
}

/** Kararı en çok hangi eksenler itti? Şablon gerekçe üretir. */
export function reasonCore(clone, d, choice) {
  const x = features(d);
  const sign = choice === 'A' ? 1 : -1;
  const contrib = TRAITS.map((t, i) => ({ t, w: clone.w[i], c: clone.w[i] * x[i] * sign }))
    .filter((r) => r.c > 0.02).sort((p, q) => q.c - p.c).slice(0, 2);
  const opt = choice === 'A' ? d.a.t : d.b.t;
  if (!contrib.length) return `Açıkçası emin değilim ama "${opt}" daha bana göre.`;
  const poles = contrib.map((r) => (r.w > 0 ? r.t.hi : r.t.lo));
  return `Ben ${poles.join(' ve ')} biriyim; o yüzden "${opt}".`;
}

/** -1..1 aralığına sıkıştırılmış kişilik DNA'sı (radar grafiği için). */
export const dna = (clone) => clone.w.map((w) => Math.tanh(w * 0.9));

export function personaLines(clone) {
  const d = dna(clone);
  return TRAITS.map((t, i) => {
    const v = d[i];
    if (Math.abs(v) < 0.15) return null;
    const lvl = Math.abs(v) > 0.6 ? 'çok' : 'biraz';
    return `${lvl} ${v > 0 ? t.hi : t.lo}`;
  }).filter(Boolean);
}

/** İki klonun kararlarının örtüşme oranı (40 soru üzerinde, çekirdek tahminle). */
export function compat(c1, c2) {
  let same = 0;
  for (const d of DILEMMAS) if (predictCore(c1, d).choice === predictCore(c2, d).choice) same++;
  const a = dna(c1), b = dna(c2);
  const dist = Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length) / 2;
  return { agree: same / DILEMMAS.length, dnaSim: 1 - dist };
}

export const answeredCount = (answers) => Object.keys(answers).filter((id) => BY_ID[id]).length;
export const MIN_ANSWERS = 16;

// Arenada kullanıcının yazdığı serbest ikilemler için kaba bir anahtar kelime etiketleyici.
// (Nöral motor açıkken asıl kararı LLM verir; bu yalnızca çekirdek için bir ipucu.)
const LEX = {
  risk:    [['risk', 'macera', 'yatırım', 'kripto', 'girişim', 'cesur', 'atla', 'bilinmeyen', 'şans', 'bahis', 'ani'], ['güvenli', 'garanti', 'kesin', 'sigorta', 'temkin', 'emin']],
  sosyal:  [['parti', 'arkadaş', 'kalabalık', 'grup', 'dışarı', 'buluş', 'eğlen', 'konser', 'kulüp', 'herkes'], ['evde', 'yalnız', 'tek başına', 'sessiz', 'sakin', 'dizi', 'kitap']],
  mantik:  [['mantık', 'hesap', 'analiz', 'liste', 'veri', 'araştır', 'karşılaştır'], ['kalp', 'his', 'içgüdü', 'duygu', 'aşk', 'sezgi']],
  sabir:   [['bekle', 'birik', 'uzun vade', 'sonra', 'disiplin', 'sabır'], ['hemen', 'şimdi', 'bugün', 'anında']],
  yenilik: [['yeni', 'farklı', 'ilk kez', 'değişik', 'keşfet', 'dene'], ['her zamanki', 'alışık', 'aynı', 'klasik', 'bildik']],
  sadakat: [['aile', 'sadık', 'eski', 'destek', 'yardım', 'söz'], ['kendim', 'bireysel', 'bırak', 'ayrıl']],
  tutum:   [['biriktir', 'tasarruf', 'ucuz', 'kenara', 'tutumlu', 'bedava'], ['harca', 'lüks', 'pahalı', 'alışveriş', 'ödüllendir', 'satın al']],
  rekabet: [['kazan', 'yarış', 'lider', 'birinci', 'rekabet', 'savaş', 'kapış'], ['uzlaş', 'barış', 'vazgeç', 'paylaş']],
};
export function tagOption(text) {
  const s = ' ' + String(text).toLocaleLowerCase('tr') + ' ';
  const v = {};
  for (const [k, [pos, neg]] of Object.entries(LEX)) {
    const score = pos.filter((w) => s.includes(w)).length - neg.filter((w) => s.includes(w)).length;
    if (score) v[k] = Math.max(-1, Math.min(1, score));
  }
  return v;
}
export const customDilemma = (q, a, b) => ({ id: 'c-' + Date.now().toString(36), q, a: { t: a, v: tagOption(a) }, b: { t: b, v: tagOption(b) }, custom: true });
