// Nüfus: persona listesi, MatrAIx içe aktarma, eğilim (trait) eşlemesi ve segmentler.
//
// Persona: { id, name, weight, source: 'matraix' | 'synthetic', dims: { boyut: 'değer' } }
// MatrAIx persona YAML biçimi (persona/datasets/*/persona_XXXX.yaml):
//   persona_id: '0042'
//   display_name: Casey Brooks
//   dimensions:
//     att_authority: Skeptical
//     ...

import { rng } from '../core/rng.js';

// ── Eğilimler ───────────────────────────────────────────────────────────────
// Kararları belirleyen gizli eğilimler, [-1, 1] aralığında. Senaryolar seçeneklerin etkisini
// bu eğilimler üzerinden tanımlar; böylece aynı senaryo farklı nüfuslarda çalışır.
export const TRAITS = {
  price: 'Fiyat hassasiyeti',
  novelty: 'Yeniliğe açıklık',
  trust: 'Kurumlara güven',
  privacy: 'Mahremiyet kaygısı',
  habit: 'Alışkanlık / statüko bağlılığı',
  social: 'Çevreden etkilenme',
  environment: 'Çevre duyarlılığı',
  fairness: 'Adalet / eşitlik hassasiyeti',
  security: 'Güvenlik önceliği',
  time: 'Zaman baskısı',
};
export const TRAIT_KEYS = Object.keys(TRAITS);

// MatrAIx boyutu → eğilim etkileri. [boyut, değerde aranan alt dize, { eğilim: etki }]
// Tanınmayan boyut/değerler etkisizdir. Bu tablo bir başlangıç varsayımıdır; LLM veya MatrAIx
// anketiyle kalibrasyon (calibrate.js) segment düzeyinde düzeltme yapar.
export const TRAIT_RULES = [
  ['economic_motivation', 'cost', { price: 0.7 }],
  ['economic_motivation', 'value', { price: 0.2 }],
  ['economic_motivation', 'premium', { price: -0.5, novelty: 0.2 }],
  ['income_bracket', 'low', { price: 0.5, time: 0.2 }],
  ['income_bracket', 'high', { price: -0.4 }],
  ['att_authority', 'skeptic', { trust: -0.5 }],
  ['att_authority', 'positive', { trust: 0.4 }],
  ['trust_level', 'verifying', { trust: -0.2, novelty: -0.1 }],
  ['trust_level', 'trusting', { trust: 0.3 }],
  ['att_new_technology', 'positive', { novelty: 0.5 }],
  ['att_new_technology', 'skeptic', { novelty: -0.4, habit: 0.2 }],
  ['att_automation', 'skeptic', { novelty: -0.2, privacy: 0.1 }],
  ['att_automation', 'positive', { novelty: 0.2 }],
  ['att_data_privacy', 'positive', { privacy: 0.5 }],          // MatrAIx: veri mahremiyetini önemseme
  ['att_surveillance', 'positive', { security: 0.4, privacy: -0.2 }],
  ['att_privacy_vs_security', 'positive', { security: 0.2 }],
  ['att_brand_loyalty', 'positive', { habit: 0.5 }],
  ['att_brand_loyalty', 'negative', { habit: -0.3, novelty: 0.2 }],
  ['att_online_reviews', 'positive', { social: 0.4 }],
  ['att_minimalism', 'positive', { price: 0.2, environment: 0.2 }],
  ['att_environment', 'positive', { environment: 0.6 }],
  ['att_environment', 'skeptic', { environment: -0.4 }],
  ['att_inequality', 'concern', { fairness: 0.6 }],
  ['att_homeownership', 'positive', { habit: 0.2, security: 0.1 }],
  ['trait_hope_optimism', 'high', { novelty: 0.2, trust: 0.1 }],
  ['trait_hope_optimism', 'low', { trust: -0.2, habit: 0.2 }],
  ['trait_conformity', 'high', { social: 0.5 }],
  ['trait_conformity', 'low', { social: -0.3 }],
  ['safety_sensitivity', 'sensitive', { security: 0.4 }],
  ['age_bracket', '18-24', { novelty: 0.4, social: 0.3, price: 0.2, habit: -0.3 }],
  ['age_bracket', '25-34', { novelty: 0.2, time: 0.3 }],
  ['age_bracket', '35-44', { time: 0.4 }],
  ['age_bracket', '55-64', { habit: 0.3, novelty: -0.2 }],
  ['age_bracket', '65', { habit: 0.5, novelty: -0.4, security: 0.2 }],
  ['life_stage', 'kids', { time: 0.5, security: 0.3, price: 0.2 }],
  ['life_stage', 'retire', { habit: 0.3, time: -0.4, price: 0.2 }],
  ['life_stage', 'student', { price: 0.5, novelty: 0.3 }],
  ['region', 'rural', { habit: 0.2, trust: -0.1 }],
  ['region', 'urban', { novelty: 0.2, environment: 0.1 }],
  ['lstyle_household_size', '5+', { price: 0.3, time: 0.2 }],
  ['role_function', 'teaching', { fairness: 0.2 }],
  ['acad_economics', 'interested', { price: 0.1, trust: 0.05 }],
  ['acad_civics', 'interested', { fairness: 0.2, trust: 0.1 }],
  // MatrAIx dev örnekleminde (80 gerçek persona) sık görülen boyutlar:
  ['economic_motivation', 'indifferent', { price: -0.2 }],
  ['risk_tolerance', 'seeking', { novelty: 0.4, security: -0.3 }],
  ['risk_tolerance', 'cautious', { security: 0.4, habit: 0.2, novelty: -0.2 }],
  ['values_priority', 'security', { security: 0.5 }],
  ['values_priority', 'tradition', { habit: 0.5, novelty: -0.2 }],
  ['values_priority', 'novelty', { novelty: 0.5 }],
  ['values_priority', 'community', { fairness: 0.3, social: 0.2 }],
  ['values_priority', 'autonomy', { trust: -0.2 }],
  ['values_priority', 'achievement', { time: 0.2 }],
  ['dominant_trait', 'neuroticism', { security: 0.3 }],
  ['dominant_trait', 'openness', { novelty: 0.4 }],
  ['dominant_trait', 'conscientiousness', { habit: 0.1, price: 0.1 }],
  ['demo_generation', 'gen z', { novelty: 0.3, social: 0.2 }],
  ['demo_generation', 'millennial', { novelty: 0.2, time: 0.1 }],
  ['demo_generation', 'boomer', { habit: 0.3, novelty: -0.2 }],
  ['demo_generation', 'silent', { habit: 0.4, novelty: -0.3 }],
  ['demo_employment_status', 'retired', { time: -0.3, price: 0.1 }],
  ['demo_employment_status', 'self-employed', { trust: -0.1, time: 0.2 }],
  ['age_bracket', '85', { habit: 0.5, novelty: -0.4, security: 0.2 }],
  ['schwartz_value_security', 'high', { security: 0.4 }],
  ['schwartz_value_security', 'low', { security: -0.2 }],
  ['schwartz_value_conformity', 'high', { social: 0.3, habit: 0.2 }],
  ['schwartz_value_conformity', 'low', { social: -0.2 }],
  ['schwartz_value_universalism', 'high', { fairness: 0.4, environment: 0.4 }],
  ['schwartz_value_benevolence', 'high', { fairness: 0.2 }],
  ['schwartz_value_stimulation', 'high', { novelty: 0.4 }],
  ['schwartz_value_stimulation', 'low', { novelty: -0.2 }],
  ['schwartz_value_self_direction', 'high', { trust: -0.1, novelty: 0.1 }],
  ['schwartz_value_power', 'high', { fairness: -0.2 }],
  ['trait_fairness', 'strong', { fairness: 0.4 }],
  ['trait_fairness', 'signature', { fairness: 0.5 }],
  ['trait_open_mindedness', 'strong', { novelty: 0.3 }],
  ['trait_curiosity', 'strong', { novelty: 0.3 }],
  ['trait_prudence', 'strong', { price: 0.2, security: 0.2 }],
  ['att_ai', 'skeptic', { novelty: -0.3, privacy: 0.2 }],
  ['att_ai', 'opposed', { novelty: -0.4, privacy: 0.3 }],
  ['att_ai', 'enthusiast', { novelty: 0.4 }],
  ['att_new_technology', 'enthusiast', { novelty: 0.6 }],
  ['val_community', 'core', { fairness: 0.3, social: 0.2 }],
];

const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));

export function traitsOf(persona) {
  const t = Object.fromEntries(TRAIT_KEYS.map((k) => [k, 0]));
  for (const [dim, needle, fx] of TRAIT_RULES) {
    const v = persona.dims?.[dim];
    if (typeof v === 'string' && v.toLowerCase().includes(needle)) for (const k in fx) t[k] += fx[k];
  }
  // Kişiye özel küçük sapma: aynı boyutlara sahip iki kişi birebir aynı davranmaz.
  const r = rng(hash(persona.id));
  for (const k of TRAIT_KEYS) t[k] = clamp(t[k] + (r() - 0.5) * 0.3);
  return t;
}

export function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ── MatrAIx içe aktarma ─────────────────────────────────────────────────────
// MatrAIx persona YAML'ının kullandığı düz alt küme için küçük bir ayrıştırıcı
// (üst düzey anahtarlar + bir seviye iç içe eşlemeler). Tam YAML değildir.
export function parsePersonaYaml(text) {
  const out = {};
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^ */)[0].length;
    const m = raw.trim().match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = unquote(m[2].trim());
    if (indent === 0) {
      if (val === '') { out[key] = {}; section = key; } else { out[key] = val; section = null; }
    } else if (section) {
      out[section][key] = val;
    }
  }
  if (!out.persona_id) throw new Error('persona_id bulunamadı');
  return {
    id: String(out.persona_id),
    name: out.display_name || `persona ${out.persona_id}`,
    weight: 1,
    source: 'matraix',
    dims: out.dimensions || {},
  };
}

const unquote = (s) => s.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');

// Dosya listesi (YAML'lar ve/veya JSON) → persona dizisi.
// JSON: persona dizisi ya da { personas: [...] } (calibrate.py çıktısı dahil).
export function importFiles(files) {
  const personas = [], errors = [];
  for (const { name, text } of files) {
    try {
      if (/\.ya?ml$/i.test(name)) personas.push(parsePersonaYaml(text));
      else {
        const j = JSON.parse(text);
        const list = Array.isArray(j) ? j : j.personas || [];
        for (const p of list) {
          personas.push({
            id: String(p.persona_id ?? p.id),
            name: p.display_name || p.name || `persona ${p.persona_id ?? p.id}`,
            weight: p.weight ?? 1,
            source: 'matraix',
            dims: p.dimensions || p.dims || {},
          });
        }
      }
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  return { personas, errors };
}

// ── Sentetik örnek nüfus ────────────────────────────────────────────────────
// MatrAIx'e benzer boyutlarla rastgele üretilir. GERÇEK VERİ DEĞİLDİR; yalnızca sistemi
// MatrAIx verisi olmadan denemek içindir. Arayüzde de böyle etiketlenir.
const SYNTH_DIMS = {
  age_bracket: [['18-24', 0.14], ['25-34', 0.2], ['35-44', 0.2], ['45-54', 0.17], ['55-64', 0.15], ['65+', 0.14]],
  region: [['Urban', 0.6], ['Suburban', 0.2], ['Rural', 0.2]],
  income_bracket: [['Low', 0.3], ['Middle', 0.5], ['High', 0.2]],
  economic_motivation: [['Cost-sensitive', 0.4], ['Value-driven', 0.35], ['Premium-seeking', 0.25]],
  att_authority: [['Skeptical', 0.35], ['Neutral', 0.3], ['Positive', 0.35]],
  att_new_technology: [['Positive', 0.45], ['Neutral', 0.3], ['Skeptical', 0.25]],
  att_data_privacy: [['Positive', 0.5], ['Neutral', 0.5]],
  att_brand_loyalty: [['Positive', 0.4], ['Neutral', 0.4], ['Negative', 0.2]],
  att_environment: [['Positive', 0.45], ['Neutral', 0.35], ['Skeptical', 0.2]],
  att_inequality: [['Concerned', 0.45], ['Neutral', 0.55]],
  trait_conformity: [['High', 0.3], ['Moderate', 0.45], ['Low', 0.25]],
};

export function syntheticPopulation(n = 300, seed = 7) {
  const r = rng(seed);
  const pick = (opts) => {
    let x = r();
    for (const [v, w] of opts) { x -= w; if (x <= 0) return v; }
    return opts[opts.length - 1][0];
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const dims = {};
    for (const [d, opts] of Object.entries(SYNTH_DIMS)) dims[d] = pick(opts);
    // Yaşa bağlı yaşam evresi
    const age = dims.age_bracket;
    dims.life_stage = age === '18-24' ? 'Student' : age === '65+' ? 'Retired'
      : (age === '25-34' || age === '35-44') && r() < 0.5 ? 'Parent of young kids' : 'Working adult';
    out.push({ id: `synth-${String(i).padStart(4, '0')}`, name: `Sentetik #${i + 1}`, weight: 1, source: 'synthetic', dims });
  }
  return out;
}

// ── Segmentler ──────────────────────────────────────────────────────────────
// MatrAIx boş değerleri "null" metni olarak da yazabiliyor; hepsi tek bir "Bilinmiyor" grubu olsun.
const MISSING = new Set(['', 'null', 'none', 'n/a', '—']);
const segValue = (p, dim) => {
  const v = p.dims?.[dim];
  return v == null || MISSING.has(String(v).trim().toLowerCase()) ? 'Bilinmiyor' : String(v);
};

// Bir boyuta göre gruplar; en kalabalık maxK değer ayrı, gerisi "Diğer".
export function segmentBy(personas, dim, maxK = 6) {
  const counts = new Map();
  for (const p of personas) {
    const v = segValue(p, dim);
    counts.set(v, (counts.get(v) || 0) + (p.weight ?? 1));
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxK).map(([v]) => v);
  const labels = counts.size > maxK ? [...top, 'Diğer'] : top;
  const index = personas.map((p) => {
    const v = segValue(p, dim);
    const i = top.indexOf(v);
    return i >= 0 ? i : labels.length - 1;
  });
  return { dim, labels, index };
}

// Nüfustaki tüm boyutlar ve kaç personada dolu oldukları (segment seçimi için).
export function dimensionsOf(personas) {
  const c = new Map();
  for (const p of personas) for (const d of Object.keys(p.dims || {})) c.set(d, (c.get(d) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => ({ dim: d, n }));
}

// Temsilî örneklem: büyük nüfuslarda AlphaZero ve sağlamlık testi için. Her segmentten nüfustaki
// payı kadar persona seçilir ve ağırlıklar, segmentin toplam ağırlığı korunacak şekilde ölçeklenir.
// Deterministiktir (aynı nüfus → aynı örneklem).
export function representativeSample(personas, dim, max = 800) {
  if (personas.length <= max) return personas;
  const seg = segmentBy(personas, dim);
  const K = seg.labels.length;
  const members = Array.from({ length: K }, () => []);
  personas.forEach((p, i) => members[seg.index[i]].push(i));
  const total = personas.reduce((s, p) => s + (p.weight ?? 1), 0);
  const out = [];
  for (const m of members) {
    if (!m.length) continue;
    const segW = m.reduce((s, i) => s + (personas[i].weight ?? 1), 0);
    const take = Math.max(1, Math.round((max * segW) / total));
    const step = m.length / take;
    const picked = Array.from({ length: Math.min(take, m.length) }, (_, j) => m[Math.floor(j * step)]);
    const pw = picked.reduce((s, i) => s + (personas[i].weight ?? 1), 0);
    for (const i of picked) out.push({ ...personas[i], weight: ((personas[i].weight ?? 1) * segW) / pw });
  }
  return out;
}
