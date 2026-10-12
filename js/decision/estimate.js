// Veriden öğrenme: kuram öncüllü MAP (maksimum sonsal) çok terimli logit.
//   log p(θ | veri) = Σ_i w_i log P(seçim_i | persona_i; θ)  −  Σ_k (θ_k − μ_k)² / 2σ_k²
// μ_k = kuramın öngördüğü katsayı (domains.js `onsel`). Veri azken model kurama yaslanır,
// veri çoğaldıkça veri baskın gelir. Kuram terimlerinin yanında seçeneğe özgü demografik
// etkiler (ör. "18-24 yaş B partisine fazladan eğilimli") sıfır merkezli sıkı öncülle öğrenilir:
// kuramın açıklayamadığı düzenliliği yakalar ama az veride aşırı uyum yapmaz.
// Doğruluk iddiası ancak görülmemiş veride ölçülürse anlamlıdır: crossValidate k-katlı
// isabet, log-kayıp, Brier ve kalibrasyon hatası (ECE) raporlar ve iki temel modelle kıyaslar.

import { features, DIMENSIONS, rng } from '../audience/personas.js';
import { resolveChoice, coefficients, zMatrix, predictChoice, rowResolved, rowProbabilities } from './model.js';

const r3 = (x) => Math.round(x * 1000) / 1000;
const pct = (x) => Math.round(x * 1000) / 10;

/** Satırlara z matrislerini önceden hesaplar (öğrenme döngüsünde tekrar hesaplanmasın). */
function precompute(resolved, rows) {
  const altIndex = Object.fromEntries(resolved.alts.map((a, j) => [a.id, j]));
  return rows.map((r, i) => {
    const f = features(r.p);
    const { r: rr, mask } = rowResolved(resolved, r);
    return { p: r.p, y: altIndex[r.secim], w: r.w ?? 1, mask, zs: zMatrix(rr, f, r.p, i), keys: Object.entries(r.p).map(([k, v]) => k + '=' + v) };
  }).filter((x) => x.y !== undefined && (!x.mask || x.mask[x.y]));
}

/**
 * @param {object} spec  seçim tanımı
 * @param {Array} rows   prepareRows çıktısı (veya simulateDataset)
 * @param {object} o     {kuramGuveni=1 (σ_θ), demoSigma=0.5, demografik=true, iters=350, lr=0.05}
 */
export function fitChoiceModel(spec, rows, o = {}) {
  const resolved = resolveChoice(spec);
  const data = precompute(resolved, rows);
  if (data.length < 10) throw new Error('öğrenme için en az 10 geçerli gözlem gerekli');
  const J = resolved.alts.length;
  const terms = resolved.terms.filter((t) => t.id !== 'iletisim');
  const K = terms.length;
  const tIdx = terms.map((t) => resolved.terms.indexOf(t));
  const prior = coefficients(resolved, o.baslangic || {});
  const sigT = o.kuramGuveni ?? 1.0, sigA = 3, sigD = o.demoSigma ?? 0.5;

  // Parametre vektörü: [θ_1..θ_K, ASC_1..ASC_{J-1}, demo...]
  const demoKeys = [];
  if (o.demografik !== false) {
    const seen = new Set(data.flatMap((d) => d.keys));
    for (const k of seen) demoKeys.push(k);
  }
  const D = demoKeys.length, dIdx = Object.fromEntries(demoKeys.map((k, i) => [k, i]));
  const nP = K + (J - 1) + (J - 1) * D;
  const mu = new Float64Array(nP), sig = new Float64Array(nP).fill(sigD);
  terms.forEach((t, k) => { mu[k] = prior.theta[t.id] ?? t.onsel; sig[k] = sigT; });
  for (let j = 1; j < J; j++) sig[K + j - 1] = sigA;
  const x = Float64Array.from(mu);
  const ascOf = (j) => (j === 0 ? 0 : x[K + j - 1]);
  const demoOf = (j, di) => (j === 0 ? 0 : x[K + (J - 1) + (j - 1) * D + di]);
  const di = data.map((d) => d.keys.map((k) => dIdx[k]).filter((v) => v !== undefined));

  const W = data.reduce((s, d) => s + d.w, 0);
  const V = new Float64Array(J), P = new Float64Array(J);
  const probs = (d, i) => {
    for (let j = 0; j < J; j++) {
      let v = ascOf(j);
      for (const q of di[i]) v += demoOf(j, q);
      for (let k = 0; k < K; k++) v += x[k] * d.zs[tIdx[k]][j];
      V[j] = d.mask && !d.mask[j] ? -Infinity : v;
    }
    let m = -Infinity; for (let j = 0; j < J; j++) if (V[j] > m) m = V[j];
    let s = 0; for (let j = 0; j < J; j++) { P[j] = Math.exp(V[j] - m); s += P[j]; }
    for (let j = 0; j < J; j++) P[j] /= s;
    return P;
  };

  // Adam ile MAP (tam yığın, analitik gradyan); gradyan/ölçek W ile normalize
  const g = new Float64Array(nP), m1 = new Float64Array(nP), m2 = new Float64Array(nP);
  const iters = o.iters ?? 350, lr = o.lr ?? 0.05;
  let ll = 0;
  for (let it = 1; it <= iters; it++) {
    g.fill(0); ll = 0;
    data.forEach((d, i) => {
      probs(d, i);
      ll += d.w * Math.log(Math.max(1e-12, P[d.y]));
      for (let k = 0; k < K; k++) {
        const z = d.zs[tIdx[k]];
        let zbar = 0; for (let j = 0; j < J; j++) zbar += P[j] * z[j];
        g[k] += d.w * (z[d.y] - zbar);
      }
      for (let j = 1; j < J; j++) {
        const r = d.w * ((d.y === j ? 1 : 0) - P[j]);
        g[K + j - 1] += r;
        const base = K + (J - 1) + (j - 1) * D;
        for (const q of di[i]) g[base + q] += r;
      }
    });
    let gn = 0;
    for (let q = 0; q < nP; q++) {
      g[q] = g[q] / W - (x[q] - mu[q]) / (sig[q] * sig[q]) / W;
      gn += g[q] * g[q];
      m1[q] = 0.9 * m1[q] + 0.1 * g[q];
      m2[q] = 0.999 * m2[q] + 0.001 * g[q] * g[q];
      x[q] += lr * (m1[q] / (1 - 0.9 ** it)) / (Math.sqrt(m2[q] / (1 - 0.999 ** it)) + 1e-8);
    }
    if (Math.sqrt(gn) < 1e-5) break;
  }

  // Yaklaşık standart hatalar: Fisher bilgisinin köşegeni + öncül hassasiyeti
  const info = new Float64Array(K);
  data.forEach((d, i) => {
    probs(d, i);
    for (let k = 0; k < K; k++) {
      const z = d.zs[tIdx[k]];
      let zbar = 0; for (let j = 0; j < J; j++) zbar += P[j] * z[j];
      let v = 0; for (let j = 0; j < J; j++) v += P[j] * (z[j] - zbar) ** 2;
      info[k] += d.w * v;
    }
  });

  const theta = {}, kuramlar = [];
  terms.forEach((t, k) => {
    theta[t.id] = r3(x[k]);
    const se = 1 / Math.sqrt(info[k] + 1 / (sigT * sigT));
    const dataShare = info[k] / (info[k] + 1 / (sigT * sigT));
    kuramlar.push({ terim: t.id, ad: t.ad, kuram: t.kuram, onsel: t.onsel, ogrenilen: r3(x[k]), std_hata: r3(se),
      veri_payi_yuzde: Math.round(dataShare * 100), destek: x[k] / se > 2 ? 'veri kuramı destekliyor' : x[k] / se < -2 ? 'veri TERS yönde' : 'belirsiz' });
  });
  const asc = Object.fromEntries(resolved.alts.map((a, j) => [a.id, r3(ascOf(j))]));
  let demo = null;
  if (D) {
    demo = {};
    for (let j = 1; j < J; j++) {
      const m = {};
      demoKeys.forEach((k, q) => { const v = demoOf(j, q); if (Math.abs(v) > 0.02) m[k] = r3(v); });
      demo[resolved.alts[j].id] = m;
    }
  }
  return {
    alan: resolved.domain.id, kaynak: `veriden öğrenilmiş (${data.length} gözlem, kuram öncüllü MAP)`,
    theta, asc, demo, n: data.length, log_olabilirlik: r3(ll),
    kuramlar: kuramlar.sort((a, b) => Math.abs(b.ogrenilen) - Math.abs(a.ogrenilen)),
  };
}

/** Bir modelin satırlar üzerindeki tahmin olasılıkları. */
const rowProbs = (spec, model, rows) => rowProbabilities(spec, model, rows);

/** Tahmin kalitesi ölçütleri. */
export function scoreProbs(list) {
  let W = 0, hit = 0, ll = 0, brier = 0;
  const bins = Array.from({ length: 10 }, () => ({ w: 0, conf: 0, acc: 0 }));
  for (const { P, y, w } of list) {
    if (y === undefined) continue;
    W += w;
    let best = 0; for (let j = 1; j < P.length; j++) if (P[j] > P[best]) best = j;
    if (best === y) hit += w;
    ll -= w * Math.log(Math.max(1e-12, P[y]));
    brier += w * P.reduce((s, q, j) => s + (q - (j === y ? 1 : 0)) ** 2, 0);
    const b = bins[Math.min(9, Math.floor(P[best] * 10))];
    b.w += w; b.conf += w * P[best]; b.acc += w * (best === y ? 1 : 0);
  }
  const ece = bins.reduce((s, b) => s + (b.w ? Math.abs(b.acc / b.w - b.conf / b.w) * b.w : 0), 0) / W;
  return { isabet_yuzde: pct(hit / W), log_kayip: r3(ll / W), brier: r3(brier / W), kalibrasyon_hatasi_ece: r3(ece) };
}

/**
 * k-katlı çapraz doğrulama. Üç modeli kıyaslar:
 *   kuram  — yalnızca kuram öncülleri (veri kullanmadan)
 *   cogunluk — herkese en sık seçeneği tahmin eden saf temel çizgi
 *   ogrenilmis — kuram öncüllü MAP + demografik etkiler (bu sistemin önerdiği model)
 */
export function crossValidate(spec, rows, o = {}) {
  const k = Math.max(2, Math.min(o.k || 5, 10));
  const r = rng(o.seed ?? 11);
  // Katlar kişi düzeyinde (panel verisinde aynı kişinin satırları eğitim ve testte birlikte olmasın)
  const gid = rows.map((row, i) => row.kisi ?? '#' + i);
  const uniq = [...new Set(gid)];
  for (let i = uniq.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [uniq[i], uniq[j]] = [uniq[j], uniq[i]]; }
  const foldOf = new Map(uniq.map((g, q) => [g, q % k]));
  const learned = [], theory = [], major = [];
  for (let f = 0; f < k; f++) {
    const testI = new Set(rows.map((_, i) => i).filter((i) => foldOf.get(gid[i]) === f));
    const train = rows.filter((_, q) => !testI.has(q)), test = rows.filter((_, q) => testI.has(q));
    const C = Number(o.siniflar) || 1;
    const model = C > 1 ? fitLatentClass(spec, train, { ...o, C }) : fitChoiceModel(spec, train, { ...o, iters: o.iters ?? 250 });
    learned.push(...rowProbs(spec, model, test));
    theory.push(...rowProbs(spec, {}, test));
    const counts = {};
    for (const t of train) counts[t.secim] = (counts[t.secim] || 0) + t.w;
    const alts = resolveChoice(spec).alts, tot = train.reduce((s, t) => s + t.w, 0);
    const Pm = alts.map((a) => (counts[a.id] || 0.5) / tot);
    const altIndex = Object.fromEntries(alts.map((a, j) => [a.id, j]));
    major.push(...test.map((t) => ({ P: Pm, y: altIndex[t.secim], w: t.w })));
  }
  const L = scoreProbs(learned), Tm = scoreProbs(theory), M = scoreProbs(major);
  return {
    kat: k, gozlem: rows.length,
    ...L,
    kuram_isabet_yuzde: Tm.isabet_yuzde, kuram_log_kayip: Tm.log_kayip,
    cogunluk_isabet_yuzde: M.isabet_yuzde, cogunluk_log_kayip: M.log_kayip,
    kazanc: `isabet ${L.isabet_yuzde}% (kuram ${Tm.isabet_yuzde}%, çoğunluk ${M.isabet_yuzde}%); log-kayıp ${L.log_kayip} (kuram ${Tm.log_kayip}, çoğunluk ${M.log_kayip})`,
  };
}

/**
 * Gizli sınıf çok terimli logit (EM). Demografinin açıklamadığı tercih tiplerini yakalar
 * (ör. aynı demografide "fiyat odaklı" ve "marka odaklı" tüketiciler; "sadık" ve "salınan"
 * seçmenler). Her sınıf aynı kuram öncüllerine çekilir; sınıf payları veriden öğrenilir.
 */
export function fitLatentClass(spec, rows, o = {}) {
  const C = Math.max(2, Math.min(Number(o.C) || 2, 4));
  const r = rng(o.seed ?? 21);
  const N = rows.length;
  // Başlangıç (simetriyi kırmak için): kişileri, seçimlerinin en çok ayrıştırdığı kuram terimine
  // göre (seçilen − ortalama z) sıralayıp C dilime böl; dilimlere yumuşak atama.
  const res0 = resolveChoice(spec);
  const groups0 = new Map();
  rows.forEach((row, i) => { const g = row.kisi ?? '#' + i; if (!groups0.has(g)) groups0.set(g, []); groups0.get(g).push(i); });
  const pre = rows.map((row, i) => { const { r: rr } = rowResolved(res0, row); return zMatrix(rr, features(row.p), row.p, i); });
  const altIdx = Object.fromEntries(res0.alts.map((a, j) => [a.id, j]));
  const score = res0.terms.map((_, k) => [...groups0.values()].map((idx) => idx.reduce((s, i) => { const z = pre[i][k]; const m = z.reduce((a, b) => a + b, 0) / z.length; return s + z[altIdx[rows[i].secim]] - m; }, 0) / idx.length));
  const variance = score.map((v) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return v.reduce((a, b) => a + (b - m) ** 2, 0); });
  const kBest = variance.indexOf(Math.max(...variance));
  const order = [...groups0.keys()].map((g, q) => [g, score[kBest][q] + 1e-6 * r()]).sort((a, b) => a[1] - b[1]);
  const sliceOf = new Map(order.map(([g], q) => [g, Math.min(C - 1, Math.floor((q / order.length) * C))]));
  let resp = rows.map((row, i) => { const c0 = sliceOf.get(row.kisi ?? '#' + i); return Array.from({ length: C }, (_, c) => (c === c0 ? 0.8 : 0.2 / (C - 1))); });
  let classes = [], pay = Array(C).fill(1 / C), ll = 0;
  for (let em = 0; em < (o.emIters || 6); em++) {
    classes = Array.from({ length: C }, (_, c) => fitChoiceModel(spec, rows.map((row, i) => ({ ...row, w: (row.w ?? 1) * resp[i][c] })), { ...o, iters: o.iters ?? 150, demoSigma: o.demoSigma ?? 0.3 }));
    pay = Array.from({ length: C }, (_, c) => resp.reduce((s, q) => s + q[c], 0) / N);
    // E adımı kişi düzeyinde: aynı kişinin tüm seçimleri sınıf olabilirliğine birlikte katkı verir
    const loglik = classes.map((m) => rowProbabilities(spec, m, rows).map((x) => Math.log(Math.max(1e-12, x.P[x.y]))));
    const groups = new Map();
    rows.forEach((row, i) => { const g = row.kisi ?? '#' + i; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(i); });
    ll = 0;
    resp = new Array(N);
    for (const idx of groups.values()) {
      const lv = pay.map((p, c) => Math.log(Math.max(1e-12, p)) + idx.reduce((s, i) => s + loglik[c][i] * (rows[i].w ?? 1), 0));
      const m = Math.max(...lv), e = lv.map((v) => Math.exp(v - m)), s = e.reduce((a, b) => a + b, 0);
      ll += m + Math.log(s);
      const q = e.map((v) => v / s);
      for (const i of idx) resp[i] = q;
    }
  }
  const siniflar = classes.map((m, c) => ({ pay: r3(pay[c]), theta: m.theta, asc: m.asc, demo: m.demo }));
  // Okunur etiket: sınıfın öncülden en çok ayrıştığı terim
  const res = resolveChoice(spec);
  siniflar.forEach((cl) => {
    const dev = res.terms.filter((t) => cl.theta[t.id] !== undefined).map((t) => [t, cl.theta[t.id] - t.onsel]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
    cl.etiket = dev ? `${dev[1] > 0 ? 'güçlü' : 'zayıf'} ${dev[0].ad.toLocaleLowerCase('tr')}` : '';
  });
  return { alan: res.domain.id, kaynak: `veriden öğrenilmiş gizli sınıf modeli (${C} sınıf, ${N} gözlem)`, siniflar, n: N, log_olabilirlik: r3(ll), kuramlar: classes.reduce((a, b, c) => (pay[c] > pay[classes.indexOf(a)] ? b : a)).kuramlar };
}

/**
 * Tüm veriyle öğren + çapraz doğrula: kullanıcıya verilecek nihai model.
 * siniflar: 1 (varsayılan) | 2..4 | 'oto' → 1 ve 2 sınıf çapraz doğrulamayla kıyaslanır.
 */
export function learn(spec, rows, o = {}) {
  let C = o.siniflar === 'oto' ? (rows.length >= 300 ? 'oto' : 1) : Number(o.siniflar) || 1;
  let cv1, cv2;
  if (C === 'oto') {
    cv1 = crossValidate(spec, rows, { ...o, siniflar: 1, k: 3 });
    cv2 = crossValidate(spec, rows, { ...o, siniflar: 2, k: 3 });
    C = cv2.log_kayip < cv1.log_kayip - 0.005 ? 2 : 1;
  }
  const model = C > 1 ? fitLatentClass(spec, rows, { ...o, C }) : fitChoiceModel(spec, rows, o);
  if (o.cv !== false) model.cv = cv1 && cv2 ? (C === 1 ? cv1 : cv2) : crossValidate(spec, rows, { ...o, siniflar: C });
  if (cv1 && cv2) model.sinif_secimi = { tek_sinif_log_kayip: cv1.log_kayip, iki_sinif_log_kayip: cv2.log_kayip, secilen: C };
  return model;
}

/**
 * Bireysel veri yokken toplam paylara (anket sonucu, pazar payı, geçmiş seçim) kalibrasyon:
 * seçenek sabitleri, simüle paylar hedefe oturana kadar log-oran düzeltmesiyle ayarlanır.
 * Kişi düzeyindeki farklılaşmayı kuram terimleri taşımaya devam eder.
 */
export function calibrateShares(spec, targets, o = {}) {
  const resolved = resolveChoice(spec);
  const tot = Object.values(targets).reduce((s, v) => s + Number(v), 0);
  if (!(tot > 0)) throw new Error('hedef paylar geçersiz');
  for (const id of Object.keys(targets)) if (!resolved.alts.some((a) => a.id === id)) throw new Error(`bilinmeyen seçenek: ${id}`);
  const model = { ...(o.model || {}), asc: { ...(o.model?.asc || {}) } };
  let last;
  for (let it = 0; it < (o.iters || 25); it++) {
    last = predictChoice(spec, { ...o, n: o.n || 1500, model, explain: false }).paylar;
    let maxErr = 0;
    for (const [id, t] of Object.entries(targets)) {
      const want = Math.max(0.05, (Number(t) / tot) * 100), have = Math.max(0.05, last[id]);
      model.asc[id] = (model.asc[id] || 0) + Math.log(want / have);
      maxErr = Math.max(maxErr, Math.abs(want - have));
    }
    if (maxErr < 0.2) break;
  }
  return { ...model, kaynak: (o.model?.kaynak ? o.model.kaynak + ' + ' : '') + 'toplam paylara kalibre', hedef: targets, son_paylar: last };
}

/**
 * Raking (iteratif oransal uyum): örneklem ağırlıklarını nüfus marjinallerine oturtur.
 * Çevrimiçi anketler genç/eğitimliyi fazla temsil eder; ham paylar yanlıdır. Model zaten
 * demografiye koşullu olduğundan nüfus tahmini persona nüfusu üzerinden (MRP mantığı) yapılır;
 * raking ham örneklem paylarını ve öğrenme ağırlıklarını düzeltmek içindir.
 */
export function rake(rows, marginals = {}, iters = 30) {
  const dims = Object.keys(DIMENSIONS).filter((d) => rows.some((r) => r.p[d]));
  const target = {};
  for (const d of dims) {
    const base = { ...DIMENSIONS[d].base, ...(marginals[d] || {}) };
    const present = new Set(rows.map((r) => r.p[d]).filter(Boolean));
    const tot = [...present].reduce((s, v) => s + (base[v] || 0), 0);
    if (tot > 0) target[d] = Object.fromEntries([...present].map((v) => [v, (base[v] || 0) / tot]));
  }
  const w = rows.map((r) => r.w ?? 1);
  for (let it = 0; it < iters; it++) {
    for (const d of Object.keys(target)) {
      const cur = {}; let tot = 0;
      rows.forEach((r, i) => { if (r.p[d]) { cur[r.p[d]] = (cur[r.p[d]] || 0) + w[i]; tot += w[i]; } });
      rows.forEach((r, i) => { const v = r.p[d]; if (v && cur[v]) w[i] *= (target[d][v] * tot) / cur[v]; });
    }
  }
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  const out = rows.map((r, i) => ({ ...r, w: w[i] / mean }));
  const deff = out.reduce((s, r) => s + r.w * r.w, 0) / out.length;   // Kish tasarım etkisi
  return { rows: out, etkin_orneklem: Math.round(out.length / deff), boyutlar: Object.keys(target) };
}

/** Ham, ağırlıklı ve model-tabanlı (nüfusa yeniden çerçevelenmiş) payları yan yana verir. */
export function shareDiagnostics(spec, rows, model, o = {}) {
  const alts = resolveChoice(spec).alts;
  const share = (rs) => { const t = rs.reduce((s, r) => s + (r.w ?? 1), 0); return Object.fromEntries(alts.map((a) => [a.id, pct(rs.filter((r) => r.secim === a.id).reduce((s, r) => s + (r.w ?? 1), 0) / t)])); };
  const raked = rake(rows, o.marginals);
  return {
    ham_orneklem: share(rows.map((r) => ({ ...r, w: 1 }))),
    agirlikli_orneklem: share(raked.rows),
    model_nufus: predictChoice(spec, { model, n: o.n || 2000, marginals: o.marginals, explain: false }).paylar,
    etkin_orneklem: raked.etkin_orneklem,
  };
}

export { DIMENSIONS };
