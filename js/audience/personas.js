// MatrAIx tarzı sentetik persona katmanı.
// MatrAIx, nüfus ölçeğinde simüle kullanıcıyı çok sayıda *kategorik boyutla* tanımlar ve
// persona ajanlarını anket/sohbet/web/uygulama ortamlarında koşturur. Burada aynı fikrin
// tarayıcıda çalışan, bağımlılıksız bir çekirdeği var: boyut şeması + koşullu örnekleyici.
// Şema genişletilebilir: DIMENSIONS'a yeni boyut ekle, sample() otomatik örnekler.
// Tamamen DOM'suz ve deterministik (tohumlu) — node testlerinde doğrudan çalışır.

/** Tohumlu, hızlı PRNG (mulberry32). Aynı tohum → aynı nüfus. */
export function rng(seed = 1) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ağırlıklı seçim: {değer: ağırlık} */
export function pick(weights, r) {
  const ent = Object.entries(weights).filter(([, w]) => w > 0);
  const sum = ent.reduce((s, [, w]) => s + w, 0);
  let x = r() * sum;
  for (const [k, w] of ent) { x -= w; if (x <= 0) return k; }
  return ent[ent.length - 1][0];
}

/**
 * Boyut şeması. `base` marjinal dağılım (varsayılanlar Türkiye yetişkin nüfusuna kaba bir
 * yaklaşımdır — kurum kendi verisiyle `marginals` geçerek ezmelidir).
 * `cond(p)` önceki boyutlara bağlı ağırlık çarpanları döner (koşullu bağımlılık).
 */
export const DIMENSIONS = {
  yas: { label: 'Yaş', base: { '18-24': 15, '25-34': 21, '35-44': 20, '45-54': 17, '55-64': 13, '65+': 14 } },
  cinsiyet: { label: 'Cinsiyet', base: { kadin: 50, erkek: 50 } },
  yerlesim: { label: 'Yerleşim', base: { kirsal: 7, kent: 50, metropol: 43 } },
  egitim: {
    label: 'Eğitim', base: { ilkokul: 35, lise: 33, universite: 27, lisansustu: 5 },
    cond: (p) => ({
      ilkokul: p.yas === '65+' || p.yas === '55-64' ? 2 : p.yas === '18-24' ? 0.4 : 1,
      universite: p.yas === '25-34' || p.yas === '18-24' ? 1.5 : p.yas === '65+' ? 0.4 : 1,
      lisansustu: p.yerlesim === 'metropol' ? 1.6 : p.yerlesim === 'kirsal' ? 0.3 : 1,
    }),
  },
  gelir: {
    label: 'Gelir', base: { dusuk: 45, orta: 40, yuksek: 15 },
    cond: (p) => ({
      yuksek: { lisansustu: 3, universite: 2, lise: 0.8, ilkokul: 0.4 }[p.egitim],
      dusuk: { ilkokul: 1.6, lise: 1, universite: 0.6, lisansustu: 0.4 }[p.egitim] * (p.yerlesim === 'kirsal' ? 1.4 : 1),
    }),
  },
  ideoloji: {
    label: 'İdeolojik konum', base: { sol: 28, merkez: 30, sag: 42 },
    cond: (p) => ({
      sol: p.egitim === 'universite' || p.egitim === 'lisansustu' ? 1.4 : 1,
      sag: p.yerlesim === 'kirsal' ? 1.4 : 1,
    }),
  },
  dindarlik: {
    label: 'Dindarlık', base: { dusuk: 25, orta: 45, yuksek: 30 },
    cond: (p) => ({
      yuksek: (p.ideoloji === 'sag' ? 1.8 : p.ideoloji === 'sol' ? 0.4 : 1) * (p.yas === '65+' ? 1.4 : 1),
      dusuk: (p.ideoloji === 'sol' ? 2 : p.ideoloji === 'sag' ? 0.4 : 1) * (p.yas === '18-24' ? 1.4 : 1),
    }),
  },
  dijital: {
    label: 'Dijital okuryazarlık', base: { dusuk: 30, orta: 40, yuksek: 30 },
    cond: (p) => ({
      dusuk: { '18-24': 0.2, '25-34': 0.4, '35-44': 0.8, '45-54': 1.3, '55-64': 2.2, '65+': 3.5 }[p.yas],
      yuksek: { '18-24': 2.2, '25-34': 1.8, '35-44': 1.1, '45-54': 0.7, '55-64': 0.4, '65+': 0.2 }[p.yas]
        * (p.egitim === 'universite' || p.egitim === 'lisansustu' ? 1.7 : 1),
    }),
  },
  medya: {
    label: 'Ana medya', base: { tv: 38, sosyal: 32, haber_sitesi: 15, yazili: 5, radyo_podcast: 10 },
    cond: (p) => ({
      tv: { dusuk: 2.2, orta: 1, yuksek: 0.45 }[p.dijital],
      sosyal: { dusuk: 0.2, orta: 1, yuksek: 1.8 }[p.dijital],
      haber_sitesi: p.egitim === 'universite' || p.egitim === 'lisansustu' ? 1.6 : 0.8,
      yazili: p.yas === '65+' || p.yas === '55-64' ? 2 : 0.6,
    }),
  },
  kurumsal_guven: {
    label: 'Kurumlara güven', base: { dusuk: 35, orta: 40, yuksek: 25 },
    cond: (p) => ({
      dusuk: p.gelir === 'dusuk' ? 1.3 : 1,
      yuksek: p.yas === '65+' ? 1.4 : 1,
    }),
  },
  bilissel_ihtiyac: {
    label: 'Bilişsel ihtiyaç', base: { dusuk: 55, yuksek: 45 },
    cond: (p) => ({ yuksek: { ilkokul: 0.6, lise: 1, universite: 1.5, lisansustu: 2.2 }[p.egitim] }),
  },
  kanaat_onderi: {
    label: 'Kanaat önderi', base: { hayir: 85, evet: 15 },
    cond: (p) => ({ evet: (p.bilissel_ihtiyac === 'yuksek' ? 1.5 : 0.7) * (p.medya === 'sosyal' ? 1.3 : 1) }),
  },
  azinlik_kimlik: {
    label: 'Marjinalleşmiş kimlik', base: { hayir: 82, evet: 18 },
  },
};

export const DIM_KEYS = Object.keys(DIMENSIONS);

/**
 * Tek bir persona örnekler.
 * @param {() => number} r          PRNG
 * @param {object} marginals        {boyut: {değer: ağırlık}} — kurum verisiyle ezme
 * @param {object} fixed            {boyut: değer} — hedef kitleyi sabitle (ör. {yas:'18-24'})
 */
export function samplePersona(r, marginals = {}, fixed = {}) {
  const p = {};
  for (const k of DIM_KEYS) {
    if (fixed[k] !== undefined) { p[k] = fixed[k]; continue; }
    const d = DIMENSIONS[k];
    const base = { ...d.base, ...(marginals[k] || {}) };
    const mult = d.cond ? d.cond(p) : {};
    const w = {};
    for (const [v, b] of Object.entries(base)) w[v] = b * (Number.isFinite(mult[v]) ? mult[v] : 1);
    p[k] = pick(w, r);
  }
  return p;
}

/**
 * Nüfus örnekler. `target` filtre olarak da kullanılabilir: değer dizi ise o değerlerden biri.
 * Dizi verilen boyutlar örneklenip filtrelenir (koşullu yapıyı bozmadan).
 */
export function samplePopulation({ n = 2000, seed = 42, marginals = {}, target = {} } = {}) {
  const r = rng(seed);
  const fixed = {}, filters = {};
  for (const [k, v] of Object.entries(target || {})) {
    if (!DIMENSIONS[k]) continue;
    if (Array.isArray(v)) filters[k] = new Set(v.map(String)); else fixed[k] = String(v);
  }
  const out = [];
  let guard = n * 60;
  while (out.length < n && guard-- > 0) {
    const p = samplePersona(r, marginals, fixed);
    if (Object.entries(filters).every(([k, s]) => s.has(p[k]))) out.push(p);
  }
  return out;
}

/* ---- persona → sayısal özellikler (kuramların ortak dili) ---- */

const ORD = {
  yas: { '18-24': 0, '25-34': 0.2, '35-44': 0.4, '45-54': 0.6, '55-64': 0.8, '65+': 1 },
  egitim: { ilkokul: 0, lise: 0.35, universite: 0.75, lisansustu: 1 },
  gelir: { dusuk: 0, orta: 0.5, yuksek: 1 },
  ideoloji: { sol: -1, merkez: 0, sag: 1 },
  dindarlik: { dusuk: 0, orta: 0.5, yuksek: 1 },
  dijital: { dusuk: 0, orta: 0.5, yuksek: 1 },
  kurumsal_guven: { dusuk: 0, orta: 0.5, yuksek: 1 },
  yerlesim: { kirsal: 0, kent: 0.5, metropol: 1 },
};

/** Persona'yı 0..1 (ideoloji -1..1) ölçekli özelliklere çevirir. */
export function features(p) {
  const f = {};
  for (const [k, m] of Object.entries(ORD)) f[k] = m[p[k]] ?? (k === 'ideoloji' ? 0 : 0.5);
  f.nfc = p.bilissel_ihtiyac === 'yuksek' ? 1 : 0;
  f.leader = p.kanaat_onderi === 'evet' ? 1 : 0;
  f.marginal = p.azinlik_kimlik === 'evet' ? 1 : 0;
  f.kadin = p.cinsiyet === 'kadin' ? 1 : 0;
  // Sosyal konum: düşük = toplumsal yapının alt/çevre katmanı (eleştirel kuramlar için)
  f.social_position = (f.gelir + f.egitim + f.yerlesim) / 3 * (f.marginal ? 0.6 : 1);
  // Yenilikçilik (Rogers): genç, eğitimli, dijital → erken benimseyen
  f.innovativeness = Math.min(1, (1 - f.yas) * 0.4 + f.egitim * 0.3 + f.dijital * 0.3);
  return f;
}
