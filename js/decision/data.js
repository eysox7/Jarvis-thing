// Kurum verisi: CSV ayrıştırma, persona alanlarını şemaya eşleme, sentetik veri üretimi.
// Beklenen CSV: başlık satırı; persona sütunları (yas, cinsiyet, egitim, gelir, ideoloji, …
// hepsi opsiyonel) + seçim sütunu (secim | tercih | choice) + opsiyonel agirlik.
// Türkçe karakter, büyük/küçük harf ve sayısal yaş otomatik eşlenir; tanınmayan değer boş sayılır.

import { DIMENSIONS, samplePopulation, features, rng } from '../audience/personas.js';
import { resolveChoice, classCoefs, personProbs, rowResolved } from './model.js';
import { ensureComm } from './communication.js';

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
// Sayısal kişi alanları (eleştirel kuramların girdileri; Thomas teoremi: beyan edilen algı/konum).
// Değer aralığı otomatik ölçeklenir: 0..1, -1..1, 1..5, 1..7, 1..10, 0..100 ölçekleri tanınır.
const NUMERIC = {
  otoriterlik: { al: ['otoriterlik', 'authoritarianism', 'otoriter'], to: [0, 1] },
  ekonomi_algisi: { al: ['ekonomi_algisi', 'ekonomik_algi', 'economy', 'ekonomi'], to: [-1, 1] },
  hane_algisi: { al: ['hane_algisi', 'hane_ekonomisi', 'household_economy'], to: [-1, 1] },
  konum_ekonomi: { al: ['konum_ekonomi', 'ekonomik_konum', 'sol_sag', 'lr_self', 'left_right'], to: [-1, 1] },
  konum_kultur: { al: ['konum_kultur', 'kulturel_konum', 'muhafazakarlik', 'liberal_muhafazakar'], to: [-1, 1] },
  parti_kimligi: { al: ['parti_kimligi', 'party_id', 'partisanship'], to: [-1, 1] },
};
const CAT_EXTRA = { medya_kaynagi: ['medya_kaynagi', 'medya_kanali', 'izlenen_kanal', 'kanal'] };
const SCALES = [[0, 1], [-1, 1], [1, 5], [1, 7], [0, 10], [1, 10], [0, 100], [-3, 3], [-5, 5]];
function numericColumn(raw, col, to) {
  const vals = raw.map((r) => String(r[col] ?? '').trim()).filter((v) => v !== '').map((v) => Number(v.replace(',', '.'))).filter(Number.isFinite);
  if (!vals.length) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const [a, b] = SCALES.find(([x, y]) => lo >= x && hi <= y) || [lo, hi];
  return (v) => { const t = String(v ?? '').trim(), n = Number(t.replace(',', '.')); if (t === '' || !Number.isFinite(n) || b === a) return undefined; return Math.round((to[0] + (n - a) / (b - a) * (to[1] - to[0])) * 1000) / 1000; };
}
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
  const numOf = {};
  for (const c of cols) for (const [k, d] of Object.entries(NUMERIC)) if (d.al.includes(fold(c))) { const fn = numericColumn(raw, c, d.to); if (fn) numOf[c] = { k, fn }; }
  const catOf = {};
  for (const c of cols) for (const [k, al] of Object.entries(CAT_EXTRA)) if (al.includes(fold(c))) catOf[c] = k;
  const choiceCol = cols.find((c) => CHOICE_COLS[fold(c)]);
  if (!choiceCol) throw new Error('seçim sütunu bulunamadı (secim / tercih / choice / oy / karar)');
  const wCol = cols.find((c) => ['agirlik', 'weight', 'w'].includes(fold(c)));
  const idCol = cols.find((c) => ['kisi', 'katilimci', 'respondent', 'musteri', 'musteri_id', 'kisi_id'].includes(fold(c)));
  const pastCol = cols.find((c) => ['onceki', 'onceki_secim', 'onceki_oy', 'gecmis_oy', 'gecmis', 'previous', 'past'].includes(fold(c)));
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
    for (const [c, { k, fn }] of Object.entries(numOf)) { const v = fn(r[c]); if (v !== undefined) p[k] = v; }
    for (const [c, k] of Object.entries(catOf)) if (r[c] !== '' && r[c] !== undefined) p[k] = fold(r[c]);
    if (pastCol && r[pastCol] !== '' && r[pastCol] !== undefined) p.onceki = altIds.get(fold(r[pastCol])) || fold(r[pastCol]);
    const w = wCol ? Number(r[wCol]) : 1;
    const row = { p, secim: id, w: Number.isFinite(w) && w > 0 ? w : 1 };
    if (idCol && r[idCol] !== '') row.kisi = String(r[idCol]);
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
  if (Object.keys(numOf).length) warn.push(`kuram girdisi sütunları bulundu: ${[...new Set(Object.values(numOf).map((x) => x.k))].join(', ')} (otomatik ölçeklendi)`);
  if (Object.keys(catOf).length) warn.push('medya kaynağı sütunu bulundu — baglam.medya_yanliligi ile kanal yanlılığını tanımlayın');
  if (pastCol) warn.push('geçmiş davranış sütunu bulundu (önceki seçim → sadakat ve geçiş matrisi öğrenilecek)');
  if (altCols.length) warn.push(`${altCols.length} satıra özgü seçenek sütunu bulundu (conjoint/satış verisi)`);
  return { rows, uyarilar: warn, eslesen_boyutlar: [...new Set([...Object.values(dimOf), ...Object.values(numOf).map((x) => x.k), ...Object.values(catOf)])] };
}

/** Bilinen "gerçek" modelden sentetik bireysel veri üretir (doğrulama ve testler için). */
export function simulateDataset(spec, trueModel, { n = 2000, seed = 7, target, marginals, vary, gorev = 1 } = {}) {
  const resolved = resolveChoice(spec);
  const cls = classCoefs(resolved, trueModel);
  const pop = samplePopulation({ n, seed, target, marginals });
  const r = rng(seed * 31 + 5);
  ensureComm(resolved, pop);
  const out = [];
  pop.forEach((p, i) => {
    // Gizli sınıflı gerçek modelde kişi sınıfını bir kez "çeker"; tüm görevlerinde o sınıfla seçer
    let u0 = r(), c = 0;
    while (c < cls.length - 1 && (u0 -= cls[c].pay) > 0) c++;
    for (let t = 0; t < gorev; t++) {
      // vary: {altId: {özellik: [min, max]}} → her görevde rastgele özellik (conjoint tasarımı)
      const row = { p, w: 1, kisi: gorev > 1 ? i : undefined };
      if (vary) for (const [alt, attrs] of Object.entries(vary)) for (const [k, [lo, hi]] of Object.entries(attrs)) ((row.ozel ||= {})[alt] ||= {})[k] = Math.round(lo + (hi - lo) * r());
      const { r: rr, mask } = rowResolved(resolved, row);
      const f = features(p);
      const norm = (P) => { if (!mask) return P; const q = P.map((v, j) => (mask[j] ? v : 0)); const s2 = q.reduce((a, b) => a + b, 0); return q.map((v) => v / s2); };
      const P = norm(personProbs(rr, cls[c].coef, f, p, i).P);
      // _P: sınıfı bilmeyen en iyi tahminci (karışım) — dürüst tavan
      const Pmix = norm(cls.reduce((acc, k) => personProbs(rr, k.coef, f, p, i).P.map((v, j) => acc[j] + k.pay * v), new Array(P.length).fill(0)));
      let u = r(), j = 0;
      while (j < P.length - 1 && (u -= P[j]) > 0) j++;
      out.push({ ...row, secim: resolved.alts[j].id, _P: Pmix });
    }
  });
  return out;
}
