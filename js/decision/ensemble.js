// Topluluk (ensemble) tahmini: birbirinden bağımsız hata yapan yöntemleri birleştirmek tek
// başına en iyisinden daha isabetlidir — ama yalnızca ağırlıklar görülmemiş veride öğrenilirse.
// Bileşenler:
//   ogrenilmis — kurum verisinden öğrenilmiş bütünleşik model (kuram + iletişim kuramları + demografi)
//   silikon    — dil modeline personaları canlandırtarak seçim sordurma ("silicon sampling",
//                Argyle vd. 2023: LLM persona yanıtları alt grup oy dağılımlarını yeniden üretebilir)
// Ağırlıklar: doğrulama gözlemlerinde log-kaybı en aza indiren olasılık karışımı (doğrusal havuz).

import { describePersona } from '../audience/survey.js';
import { extractJson } from '../util.js';
import { resolveChoice, rowProbabilities } from './model.js';
import { scoreProbs } from './estimate.js';

const r3 = (x) => Math.round(x * 1000) / 1000;

/** Bir model için satır başı olasılık vektörleri. */
export const modelProbs = (spec, model, rows) => rowProbabilities(spec, model, rows);

const SYSTEM = `Sen bir karar simülasyonusun. Her persona İÇİN o kişi olsaydın seçeneklerden hangisini seçeceğini canlandır.
Kişinin değerlerini, gelirini, ideolojisini, alışkanlıklarını ve kurumlara güvenini ciddiye al; klişe ve sosyal beğenirlik yanlılığından kaçın.
Her persona için seçeneklere OLASILIK ver (toplamı 1). YALNIZCA şu JSON'u döndür:
{"yanitlar":[{"no":1,"olasiliklar":{"<seçenek_id>":0.0}}]}`;

function brief(resolved) {
  return `Karar türü: ${resolved.domain.ad}\nBağlam: ${JSON.stringify(Object.fromEntries(Object.entries(resolved.ctx).filter(([k]) => !k.startsWith('fiyat_medyan') && k !== 'iletisim')))}\nSEÇENEKLER:\n`
    + resolved.alts.map((a) => `- ${a.id}: ${a.ad} ${JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k]) => !['id', 'ad'].includes(k))))}`).join('\n');
}

/**
 * Silikon örneklem: verilen personalar (veya veri satırları) için LLM'den seçim olasılıkları.
 * @param {Array<{p}>} people  persona taşıyan nesneler
 * @param {Function} chat      async (system, user) → metin
 */
export async function siliconProbs(spec, people, chat, { batch = 6 } = {}) {
  if (typeof chat !== 'function') throw new Error('silikon örneklem için model bağlantısı gerekli');
  const resolved = resolveChoice(spec);
  const ids = resolved.alts.map((a) => a.id);
  const out = new Array(people.length).fill(null);
  for (let i = 0; i < people.length; i += batch) {
    const part = people.slice(i, i + batch);
    const user = brief(resolved) + '\n\nPERSONALAR:\n' + part.map((x, j) => `${j + 1}. ${describePersona(x.p)}`).join('\n');
    const parsed = extractJson(await chat(SYSTEM, user));
    const list = Array.isArray(parsed?.yanitlar) ? parsed.yanitlar : [];
    part.forEach((_, j) => {
      const a = list.find((r) => Number(r.no) === j + 1) || list[j];
      if (!a || typeof a.olasiliklar !== 'object') return;
      // Sıfır olasılık log-kaybı patlatır; %2 düzleştirme
      let P = ids.map((id) => Math.max(0, Number(a.olasiliklar[id]) || 0));
      const s = P.reduce((x, y) => x + y, 0);
      if (!(s > 0)) return;
      P = P.map((q) => 0.98 * (q / s) + 0.02 / ids.length);
      out[i + j] = P;
    });
  }
  return out;
}

/**
 * Silikon olasılıklarını kişilere bağlar (görünmez p.__silikon) → 'silikon' fayda terimi kullanır.
 * Önbellek (cache: {anahtar: P}) ve anahtar(row) verilirse aynı kişi için dil modeli yeniden çağrılmaz.
 */
export async function attachSilicon(spec, rows, chat, o = {}) {
  const ids = resolveChoice(spec).alts.map((a) => a.id);
  const key = o.anahtar || null, cache = o.cache || null;
  const todo = rows.filter((r) => !(key && cache && cache[key(r)]));
  if (todo.length) {
    const P = await siliconProbs(spec, todo, chat, o);
    todo.forEach((r, i) => { if (P[i] && key && cache) cache[key(r)] = P[i]; else if (P[i]) r.__P = P[i]; });
  }
  let n = 0;
  for (const r of rows) {
    const P = (key && cache && cache[key(r)]) || r.__P;
    if (!P) continue;
    Object.defineProperty(r.p, '__silikon', { value: Object.fromEntries(ids.map((id, j) => [id, P[j]])), enumerable: false, configurable: true, writable: true });
    n++;
  }
  return n;
}

/** Doğrusal havuz ağırlıkları: simplex üzerinde ızgara araması ile en düşük log-kayıp. */
export function stackWeights(components, ys, ws) {
  const M = components.length;
  const step = M <= 2 ? 0.02 : 0.05;
  const grid = [];
  const rec = (left, acc) => {
    if (acc.length === M - 1) { grid.push([...acc, Math.round(left * 1000) / 1000]); return; }
    for (let v = 0; v <= left + 1e-9; v += step) rec(left - v, [...acc, Math.round(v * 1000) / 1000]);
  };
  rec(1, []);
  let best = null;
  for (const w of grid) {
    let ll = 0, W = 0;
    for (let i = 0; i < ys.length; i++) {
      if (ys[i] === undefined || components.some((c) => !c[i])) continue;
      let p = 0; for (let m = 0; m < M; m++) p += w[m] * components[m][i][ys[i]];
      ll -= (ws?.[i] ?? 1) * Math.log(Math.max(1e-12, p)); W += ws?.[i] ?? 1;
    }
    if (!best || ll / W < best.ll) best = { w, ll: ll / W };
  }
  return { agirliklar: best.w, log_kayip: r3(best.ll) };
}

/**
 * Doğrulama satırlarında bileşenleri değerlendirip topluluk ağırlıklarını öğrenir.
 * @param {object} comps  {ad: model | 'silikon'} — 'silikon' için o.chat gerekli
 */
export async function buildEnsemble(spec, rows, comps, o = {}) {
  const names = Object.keys(comps);
  const probs = {};
  for (const n of names) {
    if (comps[n] === 'silikon') {
      const sp = await siliconProbs(spec, rows, o.chat, o);
      probs[n] = sp;
    } else probs[n] = modelProbs(spec, comps[n], rows).map((x) => x.P);
  }
  const altIndex = Object.fromEntries(resolveChoice(spec).alts.map((a, j) => [a.id, j]));
  const ys = rows.map((r) => altIndex[r.secim]);
  const ws = rows.map((r) => r.w ?? 1);
  const stack = stackWeights(names.map((n) => probs[n]), ys, ws);
  const each = Object.fromEntries(names.map((n) => [n, scoreProbs(rows.map((r, i) => (probs[n][i] ? { P: probs[n][i], y: ys[i], w: ws[i] } : null)).filter(Boolean))]));
  const mix = rows.map((r, i) => {
    if (names.some((n) => !probs[n][i])) return null;
    const P = probs[names[0]][i].map((_, j) => names.reduce((s, n, m) => s + stack.agirliklar[m] * probs[n][i][j], 0));
    return { P, y: ys[i], w: ws[i] };
  }).filter(Boolean);
  return {
    bilesenler: names, agirliklar: Object.fromEntries(names.map((n, m) => [n, stack.agirliklar[m]])),
    bilesen_basarimi: each, topluluk_basarimi: scoreProbs(mix),
    modeller: Object.fromEntries(names.filter((n) => comps[n] !== 'silikon').map((n) => [n, comps[n]])),
  };
}

/** Topluluk ile nüfus payı: model bileşenleri persona nüfusunda, silikon bileşen panel paylarıyla. */
export function mixShares(componentShares, weights) {
  const names = Object.keys(weights).filter((n) => componentShares[n]);
  const tot = names.reduce((s, n) => s + weights[n], 0) || 1;
  const ids = Object.keys(componentShares[names[0]]);
  return Object.fromEntries(ids.map((id) => [id, Math.round(names.reduce((s, n) => s + weights[n] * componentShares[n][id], 0) / tot * 10) / 10]));
}

/**
 * Silikon ikinci görüş: nüfustan tabakalı küçük bir panel dil modeline sorulur; panel payları
 * aynı personalar için modelin tahminiyle kıyaslanır. Veri yokken "sağduyu" kontrolü sağlar;
 * ayrışma büyükse kuram varsayımları ya da seçenek tanımı gözden geçirilmeli.
 */
export async function siliconSecondOpinion(spec, model, chat, o = {}) {
  const { samplePopulation } = await import('../audience/personas.js');
  const resolved = resolveChoice(spec);
  const k = Math.max(6, Math.min(Number(o.k) || 18, 48));
  // İdeolojiye (siyaset) ya da gelire (diğer) göre tabakalı panel
  const by = resolved.domain.id === 'siyaset' ? 'ideoloji' : 'gelir';
  const pool = samplePopulation({ n: k * 8, seed: o.seed ?? 9 });
  const groups = {};
  for (const p of pool) (groups[p[by]] ||= []).push(p);
  const lists = Object.values(groups), panel = [];
  for (let i = 0; panel.length < k; i++) for (const l of lists) if (l[i] && panel.length < k) panel.push({ p: l[i] });
  const sp = await siliconProbs(spec, panel, chat, o);
  const mp = rowProbabilities(spec, model || {}, panel.map((x) => ({ ...x, secim: resolved.alts[0].id })));
  const ok = sp.map((P, i) => (P ? i : -1)).filter((i) => i >= 0);
  if (!ok.length) throw new Error('dil modeli panel yanıtını beklenen biçimde vermedi');
  const avg = (get) => Object.fromEntries(resolved.alts.map((a, j) => [a.id, Math.round(ok.reduce((s, i) => s + get(i)[j], 0) / ok.length * 1000) / 10]));
  const silikon = avg((i) => sp[i]), modelP = avg((i) => mp[i].P);
  const tv = Math.round(resolved.alts.reduce((s, a) => s + Math.abs(silikon[a.id] - modelP[a.id]), 0) / 2 * 10) / 10;
  return {
    panel: ok.length, tabaka: by, silikon_paylari: silikon, ayni_paneldeki_model_paylari: modelP,
    ayrisma_puan: tv,
    yorum: tv < 8 ? 'model ile dil modeli sağduyusu büyük ölçüde uyuşuyor' : tv < 18 ? 'kısmi ayrışma — seçenek tanımını ve bağlamı kontrol et' : 'belirgin ayrışma — kuram varsayımları ya da seçenek özellikleri bu bağlama uymuyor olabilir; veriyle öğrenmeden karar verme',
  };
}
