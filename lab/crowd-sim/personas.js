// Persona → davranış parametreleri.
//
// İki kaynak var, öncelik sırasıyla:
//  1) Kalibre edilmiş veri (matraix/calibrate.py çıktısı, persona-params.json):
//     MatrAIx personalarının tahliye anketine verdiği cevaplardan türetilir. Esas yol budur.
//  2) Önsel eşleme (priorFromDimensions): anket koşulmadıysa MatrAIx persona YAML'ındaki
//     kategorik boyutlardan kaba bir tahmin. Sezgisel bir başlangıç noktasıdır, ölçüm değildir.
//
// Simülatöre giden format (sim.js → addAgent):
//   { persona, speed, behavior: { delay, annDelay, compliance{calm,urgent,reasoned}, herding, familiarity, panic } }

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ── Önsel eşleme ────────────────────────────────────────────────────────────
// MatrAIx boyut değerleri serbest metin kategoriler; tanımadığımız değerler etkisiz kalır.
// Her kural: [boyut, değer içinde aranan alt dize (küçük harf), etki fonksiyonu]
const RULES = [
  ['att_authority', 'skeptic', (b) => { b.compliance.calm -= 0.15; b.compliance.urgent -= 0.1; b.compliance.reasoned -= 0.05; }],
  ['att_authority', 'positive', (b) => { b.compliance.calm += 0.1; b.compliance.urgent += 0.1; }],
  ['trust_level', 'verifying', (b) => { b.compliance.calm -= 0.1; b.compliance.reasoned += 0.05; b.annDelay += 1.5; }],
  ['trust_level', 'trusting', (b) => { b.compliance.calm += 0.1; b.annDelay -= 0.5; }],
  ['trait_hope_optimism', 'high', (b) => { b.delay += 1.5; b.panic -= 0.05; }],   // "bir şey olmaz" gecikmesi
  ['trait_anxiety', 'high', (b) => { b.panic += 0.25; b.delay -= 0.5; }],
  ['safety_sensitivity', 'sensitive', (b) => { b.delay -= 1; b.compliance.urgent += 0.1; }],
  ['life_stage', 'kids', (b) => { b.delay += 2; b.speedMul *= 0.8; b.herding -= 0.05; }],
  ['life_stage', 'retire', (b) => { b.speedMul *= 0.7; b.delay += 1; }],
  ['age_bracket', '65', (b) => { b.speedMul *= 0.7; }],
  ['age_bracket', '18-24', (b) => { b.speedMul *= 1.1; b.herding += 0.1; }],
  ['lstyle_household_size', '5+', (b) => { b.delay += 1; }],
  ['att_new_technology', 'positive', (b) => { b.compliance.reasoned += 0.05; }],
  ['topic_travel', 'interested', (b) => { b.familiarity -= 0.1; }],             // yeni mekânlara alışık
  ['att_brand_loyalty', 'positive', (b) => { b.familiarity += 0.1; }],          // alışkanlığa bağlılık
];

export function priorFromDimensions(dimensions = {}, base = defaultBehavior()) {
  const b = structuredClone(base);
  b.speedMul = 1;
  for (const [dim, needle, fx] of RULES) {
    const v = dimensions[dim];
    if (typeof v === 'string' && v.toLowerCase().includes(needle)) fx(b);
  }
  return finalize(b);
}

export function defaultBehavior() {
  return {
    delay: 2, annDelay: 2,
    compliance: { calm: 0.6, urgent: 0.7, reasoned: 0.75 },
    herding: 0.3, familiarity: 0.55, panic: 0.2,
  };
}

function finalize(b) {
  const speedMul = b.speedMul ?? 1;
  delete b.speedMul;
  b.delay = Math.max(0, b.delay);
  b.annDelay = Math.max(0.3, b.annDelay);
  for (const k of ['calm', 'urgent', 'reasoned']) b.compliance[k] = clamp01(b.compliance[k]);
  b.herding = clamp01(b.herding);
  b.familiarity = clamp01(b.familiarity);
  b.panic = clamp01(b.panic);
  return { behavior: b, speed: 1.34 * speedMul };
}

// ── Yerleşik arketipler ─────────────────────────────────────────────────────
// Veri yokken kullanılan, MatrAIx YAML biçiminde yazılmış SENTETİK örnek personalar.
// Gerçek MatrAIx verisi değildir; sadece boru hattının uçtan uca çalışması içindir.
export const BUILTIN_PERSONAS = [
  { persona_id: 'demo-rule-follower', weight: 0.25, dimensions: { att_authority: 'Positive', trust_level: 'Trusting', age_bracket: '35-44' } },
  { persona_id: 'demo-skeptic', weight: 0.2, dimensions: { att_authority: 'Skeptical', trust_level: 'Verifying', trait_hope_optimism: 'High' } },
  { persona_id: 'demo-family', weight: 0.2, dimensions: { life_stage: 'Parent of young kids', lstyle_household_size: '5+ people' } },
  { persona_id: 'demo-young-group', weight: 0.2, dimensions: { age_bracket: '18-24', att_new_technology: 'Positive', trait_anxiety: 'High' } },
  { persona_id: 'demo-elderly', weight: 0.15, dimensions: { age_bracket: '65+', life_stage: 'Retired', att_brand_loyalty: 'Positive' } },
];

// ── Havuz ───────────────────────────────────────────────────────────────────
// pool: [{ persona, weight, speed, behavior }]
export function poolFromPersonas(personas = BUILTIN_PERSONAS) {
  return personas.map((p) => {
    const { behavior, speed } = priorFromDimensions(p.dimensions || {});
    return { persona: p.persona_id, weight: p.weight ?? 1, speed, behavior };
  });
}

// matraix/calibrate.py çıktısını havuza çevirir.
export function poolFromCalibration(json) {
  if (!json || !Array.isArray(json.personas)) throw new Error('persona-params.json biçimi geçersiz');
  return json.personas.map((p) => ({
    persona: p.persona_id,
    weight: p.weight ?? 1,
    speed: p.speed ?? 1.34,
    behavior: finalize({ ...defaultBehavior(), ...p.behavior, compliance: { ...defaultBehavior().compliance, ...(p.behavior?.compliance || {}) } }).behavior,
  }));
}

// Ağırlıklara göre havuzdan bir persona seçip addAgent seçeneklerini döndürür.
// Aynı persona içinde küçük bireysel sapmalar eklenir (insanlar birbirinin kopyası değil).
export function sampler(pool) {
  const total = pool.reduce((s, p) => s + p.weight, 0);
  return (rand) => {
    let r = rand() * total, pick = pool[pool.length - 1];
    for (const p of pool) { r -= p.weight; if (r <= 0) { pick = p; break; } }
    const jitter = (v, s) => v * (1 + (rand() - 0.5) * 2 * s);
    const b = pick.behavior;
    return {
      persona: pick.persona,
      speed: jitter(pick.speed, 0.15),
      radius: 0.22 + rand() * 0.06,
      behavior: {
        ...b,
        delay: jitter(b.delay, 0.5),
        annDelay: jitter(b.annDelay, 0.3),
        compliance: { ...b.compliance },
      },
    };
  };
}
