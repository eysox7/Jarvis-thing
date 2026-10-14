// Karar tahmin motoru: kuram-temelli çok terimli logit, persona nüfusu üzerinde.
// Aynı fayda yapısı üç kaynaktan beslenir:
//   1) kuram öncülleri (veri yokken)          → domains.js `onsel`
//   2) kurumun verisinden öğrenilmiş katsayılar → estimate.js `fit` sonucu (model.theta, model.asc)
//   3) kampanya/iletişim etkisi                 → kitle motoru (audience/engine.js), kişi başı
// Saf JS; tarayıcıda ve node'da çalışır.

import { samplePopulation, features, DIMENSIONS } from '../audience/personas.js';
import { predict as audiencePredict } from '../audience/engine.js';
import { DECISION_DOMAINS, ILETISIM, GECMIS, ILETISIM_TERIMLERI, isAbstain, SILIKON, SOSYAL_TERIMLERI } from './domains.js';
import { ensureComm } from './communication.js';
import { rng } from '../audience/personas.js';
import { socialStructure, diffuse } from './social.js';
import { lensOf, MERCEK_MEKANIZMA, describeLens } from './lens.js';

const r3 = (x) => Math.round(x * 1000) / 1000;
/** Kişi alanı → demografik anahtar. Sürekli sayılar (algı, tehdit, borç…) 0.25'lik dilimlere ayrılır. */
export const demoKey = (k, v) => k + '=' + (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 4) / 4 : v);
const pct = (x) => Math.round(x * 1000) / 10;
const num01 = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.max(0, Math.min(1, +v)) : d);

/** Seçim tanımını doğrular ve motorun kullanacağı biçime getirir. */
export function resolveChoice(spec = {}) {
  const domain = DECISION_DOMAINS[spec.alan || spec.domain];
  if (!domain) throw new Error(`bilinmeyen karar alanı: ${spec.alan || spec.domain}. Kullanılabilir: ${Object.keys(DECISION_DOMAINS).join(', ')}`);
  const alts = (spec.secenekler || spec.alternatives || []).map((a, i) => ({ ...a, id: String(a.id ?? a.ad ?? `s${i + 1}`), ad: a.ad || String(a.id ?? `Seçenek ${i + 1}`) }));
  if (alts.length < 2) throw new Error('en az 2 seçenek gerekli');
  if (new Set(alts.map((a) => a.id)).size !== alts.length) throw new Error('seçenek kimlikleri benzersiz olmalı');
  const ctx = { ...(spec.baglam || spec.context || {}) };
  if (domain.hazirla) Object.assign(ctx, domain.hazirla(alts, ctx));
  // Serbest (kuramsız) özellik terimleri: kuramın kapsamadığı ölçülmüş özellikler için veriden öğrenilen
  // doğrusal katsayı (öncül 0, gevşek). spec.serbest = {özellik: ölçek} — bütünleşik model kuramsız modeli kapsar.
  const free = Object.entries(spec.serbest || {}).map(([k, sc]) => ({ id: 'serbest_' + k, ad: k + ' (serbest)', kuram: 'veriden öğrenilen doğrusal etki', onsel: 0, sigma: 2,
    z: (f, p, a) => (a[k] === undefined || a[k] === null ? 0 : (Number(a[k]) || 0) / (Number(sc) || 1)) }));
  const base = [...domain.terimler, ...free, ...ILETISIM_TERIMLERI, ...SOSYAL_TERIMLERI, ILETISIM, GECMIS, SILIKON];
  // İletişim merceği terimleri (lens.js): mekanizma başına öğrenilebilir sapma; öncül = taban terimin öncülü
  const lens = domain.id === 'siyaset' && ctx.mercek !== 0 && ctx.mercek !== '0'
    ? base.filter((t) => MERCEK_MEKANIZMA[t.id]).map((t) => ({ id: 'mercek_' + t.id, ad: 'İletişim merceği: ' + t.ad, kuram: MERCEK_MEKANIZMA[t.id], onsel: t.onsel, sigma: 0.75, mercekOf: t.id, z: () => 0 }))
    : [];
  const terms = [...base, ...lens];
  return { domain, alts, ctx, terms };
}

/** Katsayılar: kuram öncülü ← öğrenilmiş model ← açık geçersiz kılma. */
// Kuram ölçeği: bireysel veri yokken sabitler toplam paylara (seçim sonucu, pazar payı) oturtulduğunda
// öncüller kişi düzeyindeki etkiyi abartır (gürültü, terimler arası örtüşme). ANES 2016'da seçilen
// ölçek (0,4), görülmemiş 2020 seçiminde log-kaybı 1,12 → 0,83'e, isabeti 67,0 → 68,3'e taşıdı.
// calibrateShares bunu model.kuram_olcegi olarak koyar; öğrenilmiş modelde (model.theta) uygulanmaz.
export const KURAM_OLCEGI = 0.4;
export function coefficients(resolved, model = {}, overrides = {}) {
  const theta = {};
  const k = model.theta ? 1 : Number.isFinite(+resolved.ctx?.kuram_olcegi) ? +resolved.ctx.kuram_olcegi : Number.isFinite(+model.kuram_olcegi) ? +model.kuram_olcegi : 1;
  for (const t of resolved.terms) theta[t.id] = t.onsel * k;
  Object.assign(theta, model.theta || {}, overrides.theta || {});
  const asc = {};
  for (const a of resolved.alts) asc[a.id] = Number.isFinite(+a.asc) ? +a.asc : 0;
  Object.assign(asc, model.asc || {}, overrides.asc || {});
  // Veriden öğrenilmiş seçeneğe özgü demografik etkiler: demo[altId]['boyut=değer'] = katsayı
  // ve kuram terimi × demografi etkileşimleri: etk[terimId]['boyut=değer'] = katsayı sapması
  return { theta, asc, demo: model.demo || null, etk: model.etk || null };
}

/** Kişiye özgü kuram katsayısı: θ_k + Σ etkileşim sapmaları (öğrenilmiş modelde). */
export function thetaFor(coef, termId, p) {
  let t = coef.theta[termId] || 0;
  const e = coef.etk && coef.etk[termId];
  if (e) for (const k in p) { if (p[k] !== null && typeof p[k] === 'object') continue; const c = e[demoKey(k, p[k])]; if (c) t += c; }
  return t;
}

/**
 * Gizli sınıf modelinde her sınıfın katsayıları ve payı; tek sınıflı modelde tek öğe.
 * model.asc üst düzeyde bir kalibrasyon düzeltmesi olarak tüm sınıflara eklenir.
 */
export function classCoefs(resolved, model = {}, overrides = {}) {
  if (!model?.siniflar?.length) return [{ pay: 1, coef: coefficients(resolved, model, overrides) }];
  return model.siniflar.map((c) => {
    const coef = coefficients(resolved, c, overrides);
    for (const [id, v] of Object.entries(model.asc || {})) coef.asc[id] = (coef.asc[id] || 0) + v;
    return { pay: c.pay, coef };
  });
}

/** Satır başı seçim olasılıkları (satıra özgü seçenek seti ve gizli sınıflar dahil). */
export function rowProbabilities(spec, model, rows) {
  const resolved = resolveChoice(spec);
  const cls = classCoefs(resolved, model || {});
  const altIndex = Object.fromEntries(resolved.alts.map((a, j) => [a.id, j]));
  ensureComm(resolved, rows.map((r) => r.p));
  return rows.map((r, i) => {
    const f = features(r.p);
    const { r: rr, mask } = rowResolved(resolved, r);
    const zs = zMatrix(rr, f, r.p, i);
    const P = new Array(resolved.alts.length).fill(0);
    for (const { pay, coef } of cls) {
      const V = rr.alts.map((a, j) => {
        let v = (coef.asc[a.id] || 0) + (coef.demo ? demoUtility(coef.demo, a.id, r.p) : 0);
        rr.terms.forEach((t, k) => { v += (coef.etk ? thetaFor(coef, t.id, r.p) : coef.theta[t.id] || 0) * zs[k][j]; });
        return mask && !mask[j] ? -Infinity : v;
      });
      const m = Math.max(...V), e = V.map((v) => Math.exp(v - m)), s = e.reduce((a, b) => a + b, 0);
      e.forEach((v, j) => { P[j] += pay * v / s; });
    }
    return { P, y: altIndex[r.secim], w: r.w ?? 1 };
  });
}

/** Seçeneğe özgü demografik etki toplamı (öğrenilmiş modelde). */
export function demoUtility(demo, altId, p) {
  const d = demo && demo[altId];
  if (!d) return 0;
  let v = 0;
  for (const k in p) { if (p[k] !== null && typeof p[k] === 'object') continue; const c = d[demoKey(k, p[k])]; if (c) v += c; }
  return v;
}

/** Tek kişi için seçenek faydaları ve olasılıklar. zs: terim × seçenek özellik matrisi (yeniden kullanım için). */
export function personProbs(resolved, coef, f, p, i = 0, zs = null) {
  const { alts, terms } = resolved;
  if (!zs) zs = zMatrix(resolved, f, p, i);
  const V = new Array(alts.length);
  for (let j = 0; j < alts.length; j++) {
    let v = (coef.asc[alts[j].id] || 0) + (coef.demo ? demoUtility(coef.demo, alts[j].id, p) : 0);
    for (let k = 0; k < terms.length; k++) {
      const z = zs[k][j];
      v += (coef.etk ? thetaFor(coef, terms[k].id, p) : coef.theta[terms[k].id] || 0) * z;
    }
    V[j] = v;
  }
  const m = Math.max(...V);
  const e = V.map((v) => Math.exp(v - m));
  const s = e.reduce((x, y) => x + y, 0);
  return { V, P: e.map((x) => x / s) };
}

/**
 * Satıra özgü seçenek seti: conjoint ve satış verisinde her gözlemde fiyat/özellik ve
 * bulunurluk değişir. row.ozel = {altId: {özellik: değer}}, row.yok = [altId] (bulunmayan).
 * Döner: {resolved', mask} — mask[j] = false olan seçenek o satırda seçilemez.
 */
export function rowResolved(resolved, row) {
  if (!row || (!row.ozel && !row.yok)) return { r: resolved, mask: null };
  const alts = resolved.alts.map((a) => (row.ozel && row.ozel[a.id] ? { ...a, ...row.ozel[a.id] } : a));
  const ctx = { ...resolved.ctx };
  if (resolved.domain.hazirla) Object.assign(ctx, resolved.domain.hazirla(alts, ctx));
  const mask = row.yok ? alts.map((a) => !row.yok.includes(a.id)) : null;
  return { r: { ...resolved, alts, ctx }, mask };
}

/** Kişi için z matrisi (terim × seçenek). Tahmin ve öğrenme ortak kullanır. */
// Her terim iletişim merceğinden geçer (lens.js): kişinin iletişim ortamı terimin girdisini belirler
// (gündem → eksen ağırlıkları, medya diyeti → maruziyet); ağırlığındaki kişiler arası fark (öncelikleme,
// ELM, pekiştirme, iki aşamalı akış, Hall) ayrı mercek terimi olarak girer: z = (g_k − 1) · z_k.
export function zMatrix(resolved, f, p, i = 0) {
  const L = p ? lensOf(resolved, f, p) : null;
  if (p) Object.defineProperty(p, '__mercek', { value: L, enumerable: false, configurable: true, writable: true });
  const raw = {};
  return resolved.terms.map((t) => {
    if (t.mercekOf) { const zb = raw[t.mercekOf], g = L?.g[t.mercekOf]; return zb && g !== undefined ? zb.map((z) => (g - 1) * z) : resolved.alts.map(() => 0); }
    return (raw[t.id] = resolved.alts.map((a) => t.z(f, p, a, resolved.ctx, i)));
  });
}

/** Kitle motorundan kampanya etkisini kişi başı fayda katkısına çevirir (aynı nüfus sırası). */
function campaignEffects(resolved, kampanya, popOpts) {
  if (!kampanya) return null;
  const list = Array.isArray(kampanya) ? kampanya : [kampanya];
  const out = {};
  for (const k of list) {
    const target = String(k.secenek ?? k.alternative ?? '');
    if (!resolved.alts.some((a) => a.id === target)) throw new Error(`kampanyanın hedef seçeneği yok: ${target}`);
    const r = audiencePredict(k.mesaj || k.message || {}, { ...popOpts, bootstrap: 0, keepPeople: true, lens: k.mercek });
    const eff = r._people.map(({ out: o }) => o.exposed * o.attend * o.attitude);
    out[target] = out[target] ? out[target].map((v, i) => v + eff[i]) : eff;
  }
  return out;
}

/**
 * Nüfus personalarına önceki seçimi atar: önceki sonuç paylarıyla (ör. geçen seçim) tutarlı,
 * ama kimin neyi seçmiş olduğu kişinin kuram/model olasılığıyla orantılı (iteratif oransal uyum).
 * Önceki paylarda bugün olmayan seçenekler (kapanan parti, eski marka) etiket olarak kalır.
 */
function assignPast(resolved, coef, pop, prevShares, seed = 42) {
  const labels = Object.keys(prevShares);
  const tot = labels.reduce((s, k) => s + Number(prevShares[k] || 0), 0);
  if (!(tot > 0)) return;
  const target = labels.map((k) => Number(prevShares[k]) / tot);
  const noPast = { ...coef, theta: { ...coef.theta, gecmis: 0 } };
  const base = pop.map((p, i) => {
    const P = personProbs(resolved, noPast, features(p), p, i).P;   // p.onceki henüz atanmadı
    return labels.map((k) => { const j = resolved.alts.findIndex((a) => a.id === k); return j >= 0 ? P[j] + 0.02 : 0.1; });
  });
  const mult = labels.map(() => 1);
  for (let it = 0; it < 30; it++) {
    const cur = labels.map(() => 0);
    for (const b of base) { const s = b.reduce((acc, v, q) => acc + v * mult[q], 0); b.forEach((v, q) => { cur[q] += (v * mult[q]) / s; }); }
    labels.forEach((_, q) => { mult[q] *= target[q] / Math.max(1e-9, cur[q] / pop.length); });
  }
  const r = rng((seed * 131 + 7) >>> 0);
  pop.forEach((p, i) => {
    const w = base[i].map((v, q) => v * mult[q]);
    let u = r() * w.reduce((a, b) => a + b, 0), q = 0;
    while (q < w.length - 1 && (u -= w[q]) > 0) q++;
    p.onceki = labels[q];
  });
}

/**
 * Bir karar durumunda nüfusun seçimlerini tahmin eder.
 * @param {object} spec  {alan, secenekler, baglam, kampanya?}
 * @param {object} opts  {n, seed, target, marginals, model, segmentBy, explain, theta, asc}
 */
export function predictChoice(spec, opts = {}) {
  const resolved = resolveChoice(spec);
  const cls = classCoefs(resolved, opts.model, { theta: opts.theta, asc: opts.asc });
  // Açıklama ve geçmiş atama için baskın sınıf (tek sınıflı modelde modelin kendisi)
  const coef = cls.reduce((a, b) => (b.pay > a.pay ? b : a)).coef;
  const n = Math.max(50, Math.min(Math.round(opts.n || 2000), 20000));
  const popOpts = { n, seed: opts.seed ?? 42, target: opts.target, marginals: opts.marginals };
  const pop = samplePopulation(popOpts);
  if (!pop.length) throw new Error('hedef kitleye uyan persona örneklenemedi');
  resolved.ctx.iletisim = campaignEffects(resolved, spec.kampanya, popOpts);
  ensureComm(resolved, pop);
  if (resolved.ctx.onceki_paylar) assignPast(resolved, coef, pop, resolved.ctx.onceki_paylar, popOpts.seed);

  const J = resolved.alts.length;
  const people = pop.map((p, i) => {
    const f = features(p);
    const zs = zMatrix(resolved, f, p, i);
    if (cls.length === 1) return { p, f, zs, P: personProbs(resolved, coef, f, p, i, zs).P };
    const P = new Array(resolved.alts.length).fill(0);
    for (const c of cls) personProbs(resolved, c.coef, f, p, i, zs).P.forEach((q, j) => { P[j] += c.pay * q; });
    return { p, f, zs, P };
  });
  const direct = new Array(J).fill(0);
  for (const x of people) for (let j = 0; j < J; j++) direct[j] += x.P[j];
  const sosyal = socialSpread(spec, opts, resolved, cls, coef, people, popOpts.seed);

  const shares = new Array(J).fill(0), firsts = new Array(J).fill(0);
  let entropy = 0;
  for (const x of people) {
    let best = 0;
    for (let j = 0; j < J; j++) { shares[j] += x.P[j]; if (x.P[j] > x.P[best]) best = j; }
    firsts[best]++;
    entropy -= x.P.reduce((s, q) => s + (q > 0 ? q * Math.log(q) : 0), 0) / Math.log(J);
  }
  const N = people.length;
  const result = {
    alan: resolved.domain.ad, n: N,
    paylar: Object.fromEntries(resolved.alts.map((a, j) => [a.id, pct(shares[j] / N)])),
    en_olasi_secim_yuzde: Object.fromEntries(resolved.alts.map((a, j) => [a.id, pct(firsts[j] / N)])),
    kararsizlik: r3(entropy / N),
    kaynak: opts.model?.kaynak || (opts.model?.theta || opts.model?.siniflar ? 'veriden öğrenilmiş model' : 'kuram öncülleri (kalibre edilmemiş)'),
    gizli_siniflar: opts.model?.siniflar ? opts.model.siniflar.map((c) => ({ pay_yuzde: pct(c.pay), etiket: c.etiket })) : undefined,
    dogrulama: opts.model?.cv ? { isabet_yuzde: opts.model.cv.isabet_yuzde, log_kayip: opts.model.cv.log_kayip, temel_isabet_yuzde: opts.model.cv.cogunluk_isabet_yuzde } : undefined,
  };
  // Seçim tahmini biçimi: katılım ve geçerli oy payları (çekimser hariç)
  const abst = resolved.alts.map((a, j) => (isAbstain(a) ? j : -1)).filter((j) => j >= 0);
  if (sosyal) result.sosyal_yayilim = {
    ...sosyal,
    dogrudan_paylar: Object.fromEntries(resolved.alts.map((a, j) => [a.id, pct(direct[j] / N)])),
  };
  if (resolved.domain.id === 'siyaset' && abst.length) {
    const absShare = abst.reduce((s, j) => s + shares[j], 0) / N;
    result.katilim_yuzde = pct(1 - absShare);
    result.gecerli_oy_paylari = Object.fromEntries(resolved.alts.map((a, j) => [a, j]).filter(([, j]) => !abst.includes(j)).map(([a, j]) => [a.id, pct(shares[j] / N / Math.max(1e-9, 1 - absShare))]));
  }
  const order = resolved.alts.map((a, j) => [a.id, shares[j]]).filter(([id]) => !(result.gecerli_oy_paylari && !(id in result.gecerli_oy_paylari))).sort((x, y) => y[1] - x[1]);
  result.kazanan = order[0][0];
  result.fark_puan = r3((order[0][1] - order[1][1]) / N * 100);

  for (const k of [].concat(opts.segmentBy || []).filter((d) => DIMENSIONS[d])) {
    const g = {};
    for (const x of people) (g[x.p[k]] ||= []).push(x.P);
    (result.segmentler ||= {})[k] = Object.fromEntries(Object.entries(g).map(([v, arr]) => [v, {
      n: arr.length,
      ...Object.fromEntries(resolved.alts.map((a, j) => [a.id, pct(arr.reduce((s, P) => s + P[j], 0) / arr.length)])),
    }]));
  }

  // Açıklama: her terim kapatılınca kazanan seçeneğin payı ne kadar değişir (karşı-olgusal)
  if (opts.explain !== false) {
    const wi = resolved.alts.findIndex((a) => a.id === result.kazanan);
    result.terim_etkileri = resolved.terms.map((t, k) => {
      if (!coef.theta[t.id]) return null;
      let s = 0;
      for (const x of people) {
        const V = resolved.alts.map((a, j) => {
          let v = (coef.asc[a.id] || 0) + (coef.demo ? demoUtility(coef.demo, a.id, x.p) : 0);
          for (let q = 0; q < resolved.terms.length; q++) if (q !== k) v += (coef.etk ? thetaFor(coef, resolved.terms[q].id, x.p) : coef.theta[resolved.terms[q].id] || 0) * x.zs[q][j];
          return v;
        });
        const m = Math.max(...V), e = V.map((v) => Math.exp(v - m)), sum = e.reduce((a, b) => a + b, 0);
        s += e[wi] / sum;
      }
      return { terim: t.id, ad: t.ad, kuram: t.kuram, katsayi: r3(coef.theta[t.id]), kazanan_payina_etki_puan: r3((direct[wi] - s) / N * 100) };
    }).filter(Boolean).filter((x) => Math.abs(x.kazanan_payina_etki_puan) >= 0.05)
      .sort((a, b) => Math.abs(b.kazanan_payina_etki_puan) - Math.abs(a.kazanan_payina_etki_puan));
  }
  // Tahmin aralığı (%90): öğrenilmiş modelde parametre belirsizliği; anketle kalibre modelde anket hata payı
  if (opts.aralik !== false && !opts._icCekilis) {
    const band = shareInterval(spec, opts, resolved);
    if (band) result.pay_araligi_90 = band;
  }
  if (opts.keepPeople) result._people = people;
  return result;
}

/**
 * Sosyal yayılma: nüfusu hane + homofili ağı + topluluk olarak örer; müdahalenin (kampanya veya
 * whatIf değişikliği) bireysel etkisini bağlar üzerinden yayar. Taban: müdahalesiz senaryo
 * (opts.sosyalTaban ya da kampanyasız aynı tanım). Müdahale yoksa hiçbir şey değişmez.
 */
function socialSpread(spec, opts, resolved, cls, coef, people, seed) {
  if (opts.sosyal === false || resolved.ctx.sosyal_yayilim === false) return null;
  const taban = opts.sosyalTaban || (spec.kampanya ? { ...spec, kampanya: undefined } : null);
  if (!taban) return null;
  const th = { aile: coef.theta.aile || 0, ag: coef.theta.ag || 0, topluluk: coef.theta.topluluk || 0 };
  if (!th.aile && !th.ag && !th.topluluk) return null;
  const rr = resolveChoice(taban);
  if (rr.alts.map((a) => a.id).join('|') !== resolved.alts.map((a) => a.id).join('|')) return null;
  const pop = people.map((x) => x.p);
  rr.ctx.iletisim = campaignEffects(rr, taban.kampanya, { population: pop });
  ensureComm(rr, pop);
  const clsR = classCoefs(rr, opts.model, { theta: opts.theta, asc: opts.asc });
  const R = people.map((x, i) => {
    const zs = zMatrix(rr, x.f, x.p, i), P = new Array(rr.alts.length).fill(0);
    for (const c of clsR) personProbs(rr, c.coef, x.f, x.p, i, zs).P.forEach((q, j) => { P[j] += c.pay * q; });
    return P;
  });
  const net = socialStructure(pop, people.map((x) => x.f), seed);
  const P0 = people.map((x) => x.P), P = diffuse(P0, R, net, th, { nedensellik: num01(resolved.ctx.sosyal_nedensellik, 0.4) });
  people.forEach((x, i) => { x.P = P[i]; });
  // Sosyal çarpan: en çok değişen seçenekte toplam etki / doğrudan (bireysel) etki
  const mean = (M, j) => M.reduce((s, q) => s + q[j], 0) / M.length;
  const jj = resolved.alts.map((_, j) => j).sort((a, b) => Math.abs(mean(P0, b) - mean(R, b)) - Math.abs(mean(P0, a) - mean(R, a)))[0];
  const d0 = mean(P0, jj) - mean(R, jj);
  const hane = net.es.reduce((s, e) => s + (e >= 0 ? 1 : 0), 0) / pop.length;
  return { taban_paylar: Object.fromEntries(rr.alts.map((a, j) => [a.id, pct(mean(R, j))])),
    sosyal_carpan: Math.abs(d0) > 0.002 ? { secenek: resolved.alts[jj].id, carpan: r3((mean(P, jj) - mean(R, jj)) / d0) } : undefined,
    hane_icinde_yuzde: pct(hane), ortalama_ag_buyuklugu: r3(net.ag.reduce((s, a) => s + a.length, 0) / pop.length), katsayilar: { aile: r3(th.aile), ag: r3(th.ag), topluluk: r3(th.topluluk) } };
}

/** Laplace yaklaşık sonsalından parametre çekip payları yeniden hesaplar → %5–95 aralık. */
function shareInterval(spec, opts, resolved) {
  const m = opts.model;
  if (m?.anket_birlesimi?.hata_payi_95) {
    const moe = m.anket_birlesimi.hata_payi_95, sh = m.anket_birlesimi.paylar;
    return Object.fromEntries(Object.keys(sh).map((k) => [k, [Math.max(0, Math.round((sh[k] - moe[k] * 0.84) * 10) / 10), Math.round((sh[k] + moe[k] * 0.84) * 10) / 10]]));
  }
  const se = m?.belirsizlik;
  if (!se || m.siniflar) return null;
  const r = rng(((opts.seed ?? 42) * 977 + 3) >>> 0);
  const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
  const draws = resolved.alts.map(() => []);
  const D = opts.cekilis || 24;
  for (let d = 0; d < D; d++) {
    const theta = Object.fromEntries(Object.entries(m.theta || {}).map(([k, v]) => [k, v + (se.theta_se?.[k] || 0) * gauss()]));
    const asc = Object.fromEntries(Object.entries(m.asc || {}).map(([k, v]) => [k, v + (se.asc_se?.[k] || 0) * gauss()]));
    const sh = predictChoice(spec, { ...opts, model: { ...m, theta, asc }, n: Math.min(opts.n || 2000, 600), explain: false, segmentBy: [], keepPeople: false, _icCekilis: true }).paylar;
    resolved.alts.forEach((a, j) => draws[j].push(sh[a.id]));
  }
  return Object.fromEntries(resolved.alts.map((a, j) => {
    const v = draws[j].sort((x, y) => x - y);
    return [a.id, [v[Math.floor(0.05 * (D - 1))], v[Math.ceil(0.95 * (D - 1))]]];
  }));
}

/** Ne olur? Bir seçeneğin özelliklerini değiştirip payların nasıl kaydığını gösterir. */
export function whatIf(spec, changes, opts = {}) {
  const base = predictChoice(spec, { ...opts, explain: false, aralik: false });
  const changed = {
    ...spec,
    baglam: { ...(spec.baglam || {}), ...(changes.baglam || {}) },
    secenekler: (spec.secenekler || []).map((a) => {
      const id = String(a.id ?? a.ad);
      return changes.secenekler?.[id] ? { ...a, ...changes.secenekler[id] } : a;
    }),
    kampanya: changes.kampanya ?? spec.kampanya,
  };
  const after = predictChoice(changed, { ...opts, explain: false, aralik: false, sosyalTaban: { ...spec, kampanya: undefined } });
  return {
    once: base.paylar, sonra: after.paylar,
    degisim_puan: Object.fromEntries(Object.keys(base.paylar).map((k) => [k, r3(after.paylar[k] - base.paylar[k])])),
    kazanan_once: base.kazanan, kazanan_sonra: after.kazanan,
  };
}

/**
 * Tek kişi tahmini: tanımlanan bir persona (eksik boyutlar nötr) için seçim olasılıkları ve
 * kararını en çok hangi kuram teriminin belirlediği (en olası seçeneğin ikinciye karşı fayda farkı).
 */
export function predictPerson(spec, persona, opts = {}) {
  const resolved = resolveChoice(spec);
  const p = { ...persona };
  ensureComm(resolved, [p]);
  const f = features(p);
  const cls = classCoefs(resolved, opts.model);
  const zs = zMatrix(resolved, f, p, 0);
  const P = new Array(resolved.alts.length).fill(0);
  for (const c of cls) personProbs(resolved, c.coef, f, p, 0, zs).P.forEach((q, j) => { P[j] += c.pay * q; });
  const order = P.map((q, j) => [j, q]).sort((a, b) => b[1] - a[1]);
  const [b, s] = [order[0][0], order[1][0]];
  const coef = cls.reduce((a, c) => (c.pay > a.pay ? c : a)).coef;
  const nedenler = resolved.terms.map((t, k) => {
    const th = coef.etk ? thetaFor(coef, t.id, p) : coef.theta[t.id] || 0;
    return { terim: t.ad, kuram: t.kuram, katki: r3(th * (zs[k][b] - zs[k][s])) };
  }).filter((x) => Math.abs(x.katki) >= 0.02).sort((a, c) => Math.abs(c.katki) - Math.abs(a.katki)).slice(0, 6);
  return {
    olasiliklar: Object.fromEntries(resolved.alts.map((a, j) => [a.id, pct(P[j])])),
    en_olasi: resolved.alts[b].id, ikinci: resolved.alts[s].id,
    neden: nedenler,
    iletisim_ortami: describeLens(p.__mercek),
    eksik_boyutlar: Object.keys(DIMENSIONS).filter((d) => p[d] === undefined),
    kaynak: opts.model?.kaynak || (opts.model?.theta || opts.model?.siniflar ? 'veriden öğrenilmiş model' : 'kuram öncülleri'),
  };
}
