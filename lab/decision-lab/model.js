// Hızlı tepki motoru + AlphaZero ortamı.
//
// Her persona için, seçilen kararlar altında bir fayda (U) hesaplanır:
//   U_i = Σ_kollar ( base + Σ_eğilim ağırlık × eğilim_i ) + segment düzeltmesi + güvenilirlik + geçici etkiler
// Sonra zaman içinde (ay ay) kitle dinamiği işler:
//   pazarlama: haberdar olma → benimseme → memnuniyet / bırakma, ağızdan ağıza yayılım
//   politika:  bilgilenme → destek; bilgisizken kuruma güven ve statüko belirler; çevreye uyum
// Beklenen değerlerle (ortalama alan) çalışır: deterministik ve hızlıdır, AlphaZero'nun
// binlerce ileri sarmasına uygundur. LLM / MatrAIx ile segment düzeyinde kalibre edilir.

import { traitsOf, segmentBy, TRAIT_KEYS } from './population.js';
import { initialConfig } from './scenarios.js';
export { initialConfig };

const sig = (x) => 1 / (1 + Math.exp(-x));
const pos = (x) => (x > 0 ? x : 0);
const EVENT_DURATION = 3;     // tek seferlik eylemlerin etkisi kaç adım sürer
const EVENT_COOLDOWN = 3;     // aynı eylem en erken kaç adım sonra tekrarlanabilir
const FLIP_FLOP = 0.12;       // her kol değişikliğinin güvenilirliğe maliyeti

// ── Bağlam: senaryo + nüfus, değişmeyen kısım ───────────────────────────────
export function createContext(scn, personas, { segmentDim = 'age_bracket', calibration = null } = {}) {
  const n = personas.length;
  const w = Float64Array.from(personas, (p) => p.weight ?? 1);
  const wsum = w.reduce((s, v) => s + v, 0);
  const traits = personas.map(traitsOf);
  const T = Object.fromEntries(TRAIT_KEYS.map((k) => [k, Float64Array.from(traits, (t) => t[k])]));
  const seg = segmentBy(personas, segmentDim);

  // Seçenek katkıları önceden hesaplanır: contrib[kol][seçenek] = Float64Array(n)
  const contrib = {};
  for (const l of scn.levers) {
    contrib[l.id] = {};
    for (const o of l.options) {
      const c = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let u = o.effect.base || 0;
        for (const [k, a] of Object.entries(o.effect.traits || {})) u += a * (T[k]?.[i] ?? 0);
        c[i] = u;
      }
      contrib[l.id][o.id] = c;
    }
  }

  // Eylem listesi: 0 = bekle, sonra her kol-seçenek, sonra her tek seferlik eylem.
  const actions = [{ type: 'noop', label: 'Değişiklik yok' }];
  for (const l of scn.levers) for (const o of l.options) actions.push({ type: 'set', lever: l.id, option: o.id, label: `${l.label} → ${o.label}` });
  for (const e of scn.events || []) actions.push({ type: 'event', event: e.id, label: e.label });

  const segBias = new Float64Array(seg.labels.length);
  if (calibration?.segBias) calibration.segBias.forEach((b, k) => { if (k < segBias.length) segBias[k] = b; });

  return { scn, personas, n, w, wsum, T, seg, contrib, actions, segBias, calibration };
}

// ── Durum ───────────────────────────────────────────────────────────────────
// design=true: önce tasarım evresi. Kollar zaman geçmeden ve bedelsiz ayarlanır; "bekle"
// (eylem 0) tasarımı onaylayıp uygulamayı başlatır. AlphaZero hem tasarımı hem zamanlamayı arar.
export function initialState(ctx, config = initialConfig(ctx.scn), { design = false } = {}) {
  const { n, T } = ctx;
  const x = new Float64Array(n), aw = new Float64Array(n);
  const s = {
    t: 0, design, designMoves: 0, config: { ...config }, budget: ctx.scn.budget ?? 0, overspend: 0,
    credibility: 0, effects: [], cooldown: {}, moves: [],
    x, aw, acc: { revenue: 0, support: 0, churn: 0, impact: 0 }, series: [],
  };
  if (ctx.scn.domain === 'policy') {
    for (let i = 0; i < n; i++) { aw[i] = 0.25; x[i] = prior(T, i); }
  } else {
    for (let i = 0; i < n; i++) aw[i] = 0.05;
  }
  return s;
}

// Bilgisizken destek: kuruma güven ve statüko bağlılığı belirler.
const prior = (T, i) => sig(1.2 * T.trust[i] - 0.3 - 0.6 * pos(T.habit[i]));

export function clone(s) {
  return {
    ...s, config: { ...s.config }, effects: s.effects.map((e) => ({ ...e })), cooldown: { ...s.cooldown },
    moves: s.moves.slice(), x: s.x.slice(), aw: s.aw.slice(), acc: { ...s.acc }, series: s.series.slice(),
  };
}

export const isTerminal = (ctx, s) => s.t >= ctx.scn.horizon;

const MAX_DESIGN_MOVES = (ctx) => ctx.scn.levers.length * 2;

export function legalMask(ctx, s) {
  return ctx.actions.map((a) => {
    if (a.type === 'noop') return true;
    if (s.design) return a.type === 'set' && s.config[a.lever] !== a.option && s.designMoves < MAX_DESIGN_MOVES(ctx);
    if (a.type === 'set') return s.config[a.lever] !== a.option;
    const ev = ctx.scn.events.find((e) => e.id === a.event);
    return !(s.cooldown[a.event] > s.t) && s.budget >= ev.cost;
  });
}

// ── Bir adım (bir ay) ───────────────────────────────────────────────────────
export function apply(ctx, s, actionIndex) {
  const a = ctx.actions[actionIndex];
  const scn = ctx.scn;
  if (s.design) {
    s.moves.push(actionIndex);
    if (a.type === 'set') { s.config[a.lever] = a.option; s.designMoves++; }
    else s.design = false;          // tasarım onaylandı; zaman bir sonraki eylemle akmaya başlar
    return s;
  }
  if (a.type === 'set') {
    s.config[a.lever] = a.option;
    if (s.t > 0) s.credibility -= FLIP_FLOP;     // başlangıç tasarımı serbest; sonradan değişiklik bedelli
  } else if (a.type === 'event') {
    const ev = scn.events.find((e) => e.id === a.event);
    s.budget -= ev.cost;
    s.cooldown[ev.id] = s.t + EVENT_COOLDOWN;
    s.effects.push({ kind: ev.kind, strength: ev.strength, until: s.t + EVENT_DURATION });
    if (ev.kind === 'consultation') s.credibility += 0.05;
  }
  s.moves.push(actionIndex);

  // Seçeneklerin süregelen maliyeti
  for (const l of scn.levers) s.budget -= l.options.find((o) => o.id === s.config[l.id]).cost || 0;
  if (s.budget < 0) { s.overspend += -s.budget; s.budget = 0; }

  const active = s.effects.filter((e) => e.until > s.t);
  const eff = (kind) => active.filter((e) => e.kind === kind).reduce((m, e) => m + e.strength, 0);
  const fx = { information: eff('information'), consultation: eff('consultation'), evidence: eff('evidence'), awareness: eff('awareness'), trial: eff('trial') };

  if (scn.domain === 'policy') stepPolicy(ctx, s, fx); else stepMarketing(ctx, s, fx);
  s.t++;
  s.effects = active;
  return s;
}

export function utility(ctx, s, i, fx = {}) {
  const { T } = ctx;
  let u = ctx.segBias[ctx.seg.index[i]] + s.credibility;
  for (const l of ctx.scn.levers) u += ctx.contrib[l.id][s.config[l.id]][i];
  if (fx.consultation) u += fx.consultation * (0.4 + 0.6 * pos(T.fairness[i]));     // usule ilişkin adalet
  if (fx.evidence) u += fx.evidence * (0.5 + 0.5 * pos(-T.trust[i]));               // kanıt en çok şüpheciye işler
  if (fx.trial) u += fx.trial * (0.5 + 0.5 * pos(T.novelty[i]) + 0.5 * pos(T.price[i]));
  return u;
}

function segMeans(ctx, arr) {
  const K = ctx.seg.labels.length;
  const sum = new Float64Array(K), wt = new Float64Array(K);
  for (let i = 0; i < ctx.n; i++) { const k = ctx.seg.index[i]; sum[k] += ctx.w[i] * arr[i]; wt[k] += ctx.w[i]; }
  return Array.from(sum, (v, k) => (wt[k] ? v / wt[k] : 0));
}

function mean(ctx, arr) {
  let s = 0;
  for (let i = 0; i < ctx.n; i++) s += ctx.w[i] * arr[i];
  return s / ctx.wsum;
}

function stepPolicy(ctx, s, fx) {
  const { T, n } = ctx;
  const seg = segMeans(ctx, s.x);
  for (let i = 0; i < n; i++) {
    s.aw[i] += (1 - s.aw[i]) * Math.min(1, 0.03 + fx.information);
    const informed = sig(1.5 * utility(ctx, s, i, fx));
    let target = s.aw[i] * informed + (1 - s.aw[i]) * prior(T, i);
    target += 0.5 * pos(T.social[i]) * (seg[ctx.seg.index[i]] - target);
    s.x[i] += (target - s.x[i]) * 0.35 * (1 - 0.4 * pos(T.habit[i]));
  }
  const m = mean(ctx, s.x);
  s.acc.support += m;
  // Etkinlik dönem boyunca ortalanır: son ayda kararı sertleştirip "son durumu" iyi
  // göstermek (yem-ve-değiştir) ödüllendirilmesin. AlphaZero ilk sürümde tam bunu buldu.
  s.acc.impact += impactMean(ctx, s);
  s.series.push(m);
}

function stepMarketing(ctx, s, fx) {
  const { T, n } = ctx;
  const seg = segMeans(ctx, s.x);
  const all = mean(ctx, s.x);
  let churnSum = 0;
  for (let i = 0; i < n; i++) {
    const u = utility(ctx, s, i, fx);
    const wom = 0.6 * seg[ctx.seg.index[i]] + 0.4 * all;
    const gain = 0.04 + fx.awareness + 0.3 * wom * (0.5 + 0.5 * pos(T.social[i]));
    s.aw[i] += (1 - s.aw[i]) * Math.min(1, gain);
    const adopt = s.aw[i] * (1 - s.x[i]) * sig(1.5 * u) * 0.3 * (1 - 0.4 * pos(T.habit[i]));
    const churn = s.x[i] * sig(-1.5 * u - 0.3) * 0.25;
    s.x[i] += adopt - churn;
    churnSum += ctx.w[i] * churn;
  }
  const m = mean(ctx, s.x);
  s.acc.revenue += m * margin(ctx, s);
  s.acc.churn += churnSum / ctx.wsum;
  s.series.push(m);
}

// Seçili seçeneklerin karar vericinin amacına katkısı (0-1). Pazarlamada kullanıcı başı kâr marjı.
function margin(ctx, s) {
  return ctx.scn.levers.reduce((m, l) => m * (l.options.find((o) => o.id === s.config[l.id]).impact ?? 1), 1);
}
function impactMean(ctx, s) {
  const v = ctx.scn.levers.map((l) => l.options.find((o) => o.id === s.config[l.id]).impact ?? 1);
  return v.reduce((a, b) => a + b, 0) / v.length;
}

// ── Hedef fonksiyonu ────────────────────────────────────────────────────────
// Bileşenler arayüzde ayrı ayrı gösterilir; ağırlıklar senaryonun objective alanından gelir.
export function score(ctx, s) {
  const o = ctx.scn.objective;
  const h = Math.max(1, s.t);
  const segs = segMeans(ctx, s.x);
  const final = mean(ctx, s.x);
  const overspend = s.overspend / Math.max(1, ctx.scn.budget || 1);
  if (ctx.scn.domain === 'policy') {
    const avg = s.acc.support / h;
    const minSeg = Math.min(...segs);
    const m = segs.reduce((a, b) => a + b, 0) / segs.length;
    const pol = Math.sqrt(segs.reduce((a, v) => a + (v - m) ** 2, 0) / segs.length) * 2;
    const parts = {
      impact: s.acc.impact / h, support: 0.5 * final + 0.5 * avg, minSegment: minSeg, polarization: pol, overspend,
    };
    const total = o.impact * parts.impact + o.support * parts.support + o.minSegment * parts.minSegment
      - o.polarization * parts.polarization - 0.5 * overspend;
    return { total, parts, final, segs };
  }
  // pazarlama: memnuniyet = benimseyenlerin ortalama "ürünü isteme" olasılığı
  let sat = 0, sw = 0;
  for (let i = 0; i < ctx.n; i++) { const wx = ctx.w[i] * s.x[i]; sat += wx * sig(1.5 * utility(ctx, s, i)); sw += wx; }
  const parts = {
    revenue: (2 * s.acc.revenue) / h, adoption: final, satisfaction: sw ? sat / sw : 0, churn: (4 * s.acc.churn) / h, overspend,
  };
  const total = o.revenue * parts.revenue + o.adoption * parts.adoption + o.satisfaction * parts.satisfaction
    - o.churn * parts.churn - 0.5 * overspend;
  return { total, parts, final, segs };
}

// ── Tahmin: sabit kararlar, eylemsiz ────────────────────────────────────────
export function forecast(ctx, config) {
  const s = initialState(ctx, config);
  while (!isTerminal(ctx, s)) apply(ctx, s, 0);
  return { state: s, ...score(ctx, s) };
}

// ── AlphaZero arayüzü ───────────────────────────────────────────────────────
export function encode(ctx, s) {
  const K = ctx.seg.labels.length;
  const nOpt = ctx.scn.levers.reduce((a, l) => a + l.options.length, 0);
  const E = (ctx.scn.events || []).length;
  const v = new Float32Array(2 * K + nOpt + E + 4);
  let o = 0;
  for (const m of segMeans(ctx, s.x)) v[o++] = m;
  for (const m of segMeans(ctx, s.aw)) v[o++] = m;
  for (const l of ctx.scn.levers) for (const opt of l.options) v[o++] = s.config[l.id] === opt.id ? 1 : 0;
  for (const e of ctx.scn.events || []) v[o++] = s.cooldown[e.id] > s.t ? 1 : 0;
  v[o++] = s.t / ctx.scn.horizon;
  v[o++] = ctx.scn.budget ? s.budget / ctx.scn.budget : 0;
  v[o++] = s.credibility;
  v[o++] = s.design ? 1 : 0;
  return v;
}
export const inputSize = (ctx) => encode(ctx, initialState(ctx)).length;

// Hamle dizisini okunur plana çevirir: [{ t, label, phase }]
export function describeMoves(ctx, moves, start = null) {
  const out = [];
  if (start) {
    const init = initialConfig(ctx.scn);
    for (const l of ctx.scn.levers) {
      if (start[l.id] === init[l.id]) continue;
      out.push({ t: 0, phase: 'design', label: `${l.label} → ${l.options.find((o) => o.id === start[l.id])?.label} (en iyi statik tasarımdan)` });
    }
  }
  let design = true, t = 0;
  for (const m of moves) {
    const a = ctx.actions[m];
    if (design) {
      if (a.type === 'noop') { design = false; out.push({ t: 0, phase: 'design', label: 'Tasarım onaylandı, uygulama başladı' }); }
      else out.push({ t: 0, phase: 'design', label: a.label });
      continue;
    }
    if (a.type !== 'noop') out.push({ t, phase: 'run', label: a.label });
    t++;
  }
  return out;
}

// MCTS'nin beklediği arayüze bağlar. base: kıyas skoru (hiçbir şey yapmamak).
export function makeEnv(ctx, scale = 0.08) {
  return {
    clone, isTerminal: (s) => isTerminal(ctx, s), legalMask: (s) => legalMask(ctx, s),
    apply: (s, a) => apply(ctx, s, a), encode: (s) => encode(ctx, s),
    outcome: (s, base) => Math.tanh((score(ctx, s).total - base) / scale),
  };
}

export function baselineScore(ctx, start) {
  const s = clone(start);
  while (!isTerminal(ctx, s)) apply(ctx, s, 0);
  return score(ctx, s).total;
}

// ── Sağlamlık (duyarlılık) testi ────────────────────────────────────────────
// Seçenek etkileri varsayımdır. Planı, etkileri rastgele bozulmuş "alternatif dünyalarda"
// yeniden oynatıp hâlâ iyi olup olmadığına bakarız. Bir plan yalnızca modelin tam olarak
// doğru olduğu dünyada iyiyse, büyük olasılıkla modelin bir açığını sömürüyordur.
export function perturbScenario(scn, rand, magnitude = 0.3) {
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
  const s = JSON.parse(JSON.stringify(scn));
  for (const l of s.levers) for (const o of l.options) {
    o.effect.base = (o.effect.base || 0) + gauss() * magnitude * 0.5;
    for (const k of Object.keys(o.effect.traits || {})) o.effect.traits[k] *= 1 + gauss() * magnitude;
  }
  for (const e of s.events || []) e.strength = Math.max(0, e.strength * (1 + gauss() * magnitude));
  return s;
}

// Kaydedilmiş hamle dizisini (tasarım evresi dahil) verilen bağlamda yeniden oynatır.
export function replay(ctx, moves, start) {
  const s = initialState(ctx, start, { design: true });
  for (const m of moves) {
    if (isTerminal(ctx, s)) break;
    // Alternatif dünyada eylem yasal değilse (ör. bütçe yetmiyor) beklemeyle değiştir.
    apply(ctx, s, legalMask(ctx, s)[m] ? m : 0);
  }
  while (!isTerminal(ctx, s)) apply(ctx, s, 0);
  return score(ctx, s);
}

// plans: { ad: { moves, start } } (start: başlangıç tasarımı; yoksa senaryonunki). Dönen: her plan için skor dağılımı ve kaç dünyada en iyi olduğu.
export function robustness(scn, personas, plans, { segmentDim, calibration, worlds = 30, magnitude = 0.3, seed = 11, rng } = {}) {
  const rand = rng(seed);
  const names = Object.keys(plans);
  const scores = Object.fromEntries(names.map((n) => [n, []]));
  const wins = Object.fromEntries(names.map((n) => [n, 0]));
  for (let w = 0; w < worlds; w++) {
    const ctx = createContext(perturbScenario(scn, rand, magnitude), personas, { segmentDim, calibration });
    let bestName = null, bestVal = -Infinity;
    for (const n of names) {
      const v = replay(ctx, plans[n].moves, plans[n].start).total;
      scores[n].push(v);
      if (v > bestVal) { bestVal = v; bestName = n; }
    }
    wins[bestName]++;
  }
  const q = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
  return Object.fromEntries(names.map((n) => [n, {
    mean: scores[n].reduce((a, b) => a + b, 0) / worlds, p10: q(scores[n], 0.1), p90: q(scores[n], 0.9), winRate: wins[n] / worlds,
  }]));
}

// Statik bir tasarımı hamle dizisine çevirir (tasarım evresinde kolları ayarla, onayla, bekle).
export function movesForConfig(ctx, config) {
  const init = initialConfig(ctx.scn);
  const moves = [];
  for (const l of ctx.scn.levers) {
    if (config[l.id] === init[l.id]) continue;
    moves.push(ctx.actions.findIndex((a) => a.type === 'set' && a.lever === l.id && a.option === config[l.id]));
  }
  moves.push(0);
  return moves;
}

// ── Planı açıklama (ablasyon) ───────────────────────────────────────────────
// Her adım tek tek çıkarılıp plan yeniden oynatılır: skorun ne kadar düştüğü o adımın katkısı,
// segment desteğindeki değişim de adımın kime yaradığıdır. Tasarım adımları için ilgili kol
// senaryonun başlangıç seçeneğine döndürülür; zamanlı adımlar "bekle" ile değiştirilir.
export function explainPlan(ctx, moves, start = initialConfig(ctx.scn)) {
  const full = replay(ctx, moves, start);
  const init = initialConfig(ctx.scn);
  const rows = [];
  const add = (label, when, r) => rows.push({
    label, when, delta: full.total - r.total,
    segDelta: full.segs.map((v, k) => v - r.segs[k]),
  });
  for (const l of ctx.scn.levers) {
    if (start[l.id] === init[l.id]) continue;
    const opt = l.options.find((o) => o.id === start[l.id]);
    add(`${l.label} → ${opt?.label}`, 'tasarım', replay(ctx, moves, { ...start, [l.id]: init[l.id] }));
  }
  let design = true, t = 0;
  moves.forEach((m, idx) => {
    const a = ctx.actions[m];
    if (design) {
      if (a.type === 'noop') design = false;
      else add(a.label, 'tasarım', replay(ctx, moves.map((x, j) => (j === idx ? -1 : x)).filter((x) => x !== -1), start));
      return;
    }
    if (a.type !== 'noop') add(a.label, `${t + 1}. ${ctx.scn.unit}`, replay(ctx, moves.map((x, j) => (j === idx ? 0 : x)), start));
    t++;
  });
  return { full, rows };
}
