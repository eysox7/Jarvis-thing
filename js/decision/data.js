// Kurum verisi: CSV ayrıştırma, persona alanlarını şemaya eşleme, sentetik veri üretimi.
// Beklenen CSV: başlık satırı; persona sütunları (yas, cinsiyet, egitim, gelir, ideoloji, …
// hepsi opsiyonel) + seçim sütunu (secim | tercih | choice) + opsiyonel agirlik.
// Türkçe karakter, büyük/küçük harf ve sayısal yaş otomatik eşlenir; tanınmayan değer boş sayılır.

import { DIMENSIONS, samplePopulation, features, rng } from '../audience/personas.js';
import { resolveChoice, coefficients, personProbs, rowResolved } from './model.js';

const fold = (s) => String(s ?? '').trim().toLocaleLowerCase('tr')
  .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
  .replace(/[\s-]+/g, '_');

const ALIASES = {
  yas: { yas: 1, age: 1, yas_grubu: 1 }, cinsiyet: { cinsiyet: 1, gender: 1, sex: 1 },
  yerlesim: { yerlesim: 1, yerlesim_yeri: 1 }, egitim: { egitim: 1, education: 1 }, gelir: { gelir: 1, income: 1 },
  ideoloji: { ideoloji: 1, ideology: 1, siyasi_egilim: 1 }, dindarlik: { dindarlik: 1, religiosity: 1 },
  dijital: { dijital: 1, dijital_beceri: 1 }, medya: { medya: 1, ana_medya: 1 }, kurumsal_guven: { kurumsal_guven: 1, guven: 1, trust: 1 },
  bilissel_ihtiyac: { bilissel_ihtiyac: 1 }, kanaat_onderi: { kanaat_onderi: 1 }, azinlik_kimlik: { azinlik_kimlik: 1, azinlik: 1 },
};
const CHOICE_COLS = { secim: 1, tercih: 1, choice: 1, oy: 1, karar: 1 };
const VALUE_ALIASES = {
  cinsiyet: { k: 'kadin', e: 'erkek', kadin: 'kadin', erkek: 'erkek', female: 'kadin', male: 'erkek', f: 'kadin', m: 'erkek' },
  _evet: { evet: 'evet', e: 'evet', '1': 'evet', true: 'evet', hayir: 'hayir', h: 'hayir', '0': 'hayir', false: 'hayir' },
  _lmh: { dusuk: 'dusuk', orta: 'orta', yuksek: 'yuksek', low: 'dusuk', mid: 'orta', medium: 'orta', high: 'yuksek', '1': 'dusuk', '2': 'orta', '3': 'yuksek' },
};

function ageBand(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n < 25 ? '18-24' : n < 35 ? '25-34' : n < 45 ? '35-44' : n < 55 ? '45-54' : n < 65 ? '55-64' : '65+';
}

/** Tek bir ham değeri boyut şemasındaki değere eşler (yoksa null). */
export function mapValue(dim, raw) {
  const d = DIMENSIONS[dim];
  if (!d || raw === undefined || raw === null || raw === '') return null;
  const v = fold(raw);
  if (v in d.base) return v;
  if (dim === 'yas') return ageBand(raw) || (v.replace('_', '-') in d.base ? v.replace('_', '-') : null);
  if (dim === 'cinsiyet') return VALUE_ALIASES.cinsiyet[v] || null;
  if (dim === 'kanaat_onderi' || dim === 'azinlik_kimlik') return VALUE_ALIASES._evet[v] || null;
  if ('dusuk' in d.base && VALUE_ALIASES._lmh[v] && VALUE_ALIASES._lmh[v] in d.base) return VALUE_ALIASES._lmh[v];
  if (dim === 'ideoloji') return { left: 'sol', center: 'merkez', right: 'sag', '-1': 'sol', '0': 'merkez', '1': 'sag' }[v] || null;
  if (dim === 'egitim') return { ilkogretim: 'ilkokul', ortaokul: 'ilkokul', lisans: 'universite', yuksek_lisans: 'lisansustu', doktora: 'lisansustu' }[v] || null;
  return null;
}

/** Basit CSV ayrıştırıcı (virgül veya noktalı virgül; tırnaklı alanlar desteklenir). */
export function parseCSV(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) throw new Error('CSV en az bir başlık ve bir veri satırı içermeli');
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const split = (l) => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === sep && !q) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => { const c = split(l); return Object.fromEntries(head.map((h, i) => [h, c[i] ?? ''])); });
}

/**
 * Ham satırları (CSV'den ya da JSON) öğrenmeye hazır gözlemlere çevirir.
 * @returns {{rows: Array<{p, secim, w}>, uyarilar: string[], eslesen_boyutlar: string[]}}
 */
export function prepareRows(raw, spec) {
  const { alts } = resolveChoice(spec);
  const altIds = new Map(alts.flatMap((a) => [[fold(a.id), a.id], [fold(a.ad), a.id]]));
  const rows = [], warn = [];
  let unknownChoice = 0, unmapped = 0;
  const cols = raw.length ? Object.keys(raw[0]) : [];
  const dimOf = {};
  for (const c of cols) {
    const fc = fold(c);
    for (const [dim, al] of Object.entries(ALIASES)) if (al[fc]) dimOf[c] = dim;
  }
  const choiceCol = cols.find((c) => CHOICE_COLS[fold(c)]);
  if (!choiceCol) throw new Error('seçim sütunu bulunamadı (secim / tercih / choice / oy / karar)');
  const wCol = cols.find((c) => ['agirlik', 'weight', 'w'].includes(fold(c)));
  // Satıra özgü seçenek özellikleri: "<özellik>_<seçenek>" (ör. fiyat_A) ve bulunurluk "var_<seçenek>"
  const attrKeys = Object.keys(resolveChoice(spec).domain.seceneOzellikleri || {});
  const altCols = [];
  for (const c of cols) {
    const fc = fold(c);
    for (const a of alts) {
      const sfx = '_' + fold(a.id);
      if (!fc.endsWith(sfx)) continue;
      const attr = fc.slice(0, -sfx.length);
      if (attr === 'var' || attr === 'mevcut_mu') altCols.push({ c, alt: a.id, attr: '__var' });
      else if (attrKeys.includes(attr)) altCols.push({ c, alt: a.id, attr });
    }
  }
  for (const r of raw) {
    const id = altIds.get(fold(r[choiceCol]));
    if (!id) { unknownChoice++; continue; }
    const p = {};
    for (const [c, dim] of Object.entries(dimOf)) {
      const v = mapValue(dim, r[c]);
      if (v) p[dim] = v; else if (r[c] !== '' && r[c] !== undefined) unmapped++;
    }
    const w = wCol ? Number(r[wCol]) : 1;
    const row = { p, secim: id, w: Number.isFinite(w) && w > 0 ? w : 1 };
    for (const { c, alt, attr } of altCols) {
      const raw = r[c];
      if (raw === '' || raw === undefined) continue;
      if (attr === '__var') { if (['0', 'hayir', 'false', 'yok'].includes(fold(raw))) (row.yok ||= []).push(alt); continue; }
      const v = ['evet', 'true'].includes(fold(raw)) ? true : ['hayir', 'false'].includes(fold(raw)) ? false : Number(String(raw).replace(',', '.'));
      if (v === true || v === false || Number.isFinite(v)) ((row.ozel ||= {})[alt] ||= {})[attr] = v;
    }
    rows.push(row);
  }
  if (unknownChoice) warn.push(`${unknownChoice} satırda seçim, seçeneklerle eşleşmedi ve atlandı`);
  if (unmapped) warn.push(`${unmapped} hücre şemaya eşlenemedi ve boş sayıldı`);
  if (!Object.keys(dimOf).length) warn.push('hiç persona sütunu tanınmadı — yalnızca seçenek sabitleri öğrenilebilir');
  if (altCols.length) warn.push(`${altCols.length} satıra özgü seçenek sütunu bulundu (conjoint/satış verisi)`);
  return { rows, uyarilar: warn, eslesen_boyutlar: [...new Set(Object.values(dimOf))] };
}

/** Bilinen "gerçek" modelden sentetik bireysel veri üretir (doğrulama ve testler için). */
export function simulateDataset(spec, trueModel, { n = 2000, seed = 7, target, marginals, vary } = {}) {
  const resolved = resolveChoice(spec);
  const coef = coefficients(resolved, trueModel);
  const pop = samplePopulation({ n, seed, target, marginals });
  const r = rng(seed * 31 + 5);
  return pop.map((p, i) => {
    // vary: {altId: {özellik: [min, max]}} → her satırda rastgele özellik (conjoint tasarımı)
    let row = { p, w: 1 };
    if (vary) for (const [alt, attrs] of Object.entries(vary)) for (const [k, [lo, hi]] of Object.entries(attrs)) ((row.ozel ||= {})[alt] ||= {})[k] = Math.round(lo + (hi - lo) * r());
    const { r: rr, mask } = rowResolved(resolved, row);
    let { P } = personProbs(rr, coef, features(p), p, i);
    if (mask) { P = P.map((q, j) => (mask[j] ? q : 0)); const s = P.reduce((a, b) => a + b, 0); P = P.map((q) => q / s); }
    let u = r(), j = 0;
    while (j < P.length - 1 && (u -= P[j]) > 0) j++;
    return { ...row, secim: resolved.alts[j].id, _P: P };
  });
}
