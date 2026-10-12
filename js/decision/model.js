// Karar tahmin motoru: kuram-temelli çok terimli logit, persona nüfusu üzerinde.
// Aynı fayda yapısı üç kaynaktan beslenir:
//   1) kuram öncülleri (veri yokken)          → domains.js `onsel`
//   2) kurumun verisinden öğrenilmiş katsayılar → estimate.js `fit` sonucu (model.theta, model.asc)
//   3) kampanya/iletişim etkisi                 → kitle motoru (audience/engine.js), kişi başı
// Saf JS; tarayıcıda ve node'da çalışır.

import { samplePopulation, features, DIMENSIONS } from '../audience/personas.js';
import { predict as audiencePredict } from '../audience/engine.js';
import { DECISION_DOMAINS, ILETISIM } from './domains.js';

const r3 = (x) => Math.round(x * 1000) / 1000;
const pct = (x) => Math.round(x * 1000) / 10;

/** Seçim tanımını doğrular ve motorun kullanacağı biçime getirir. */
export function resolveChoice(spec = {}) {
  const domain = DECISION_DOMAINS[spec.alan || spec.domain];
  if (!domain) throw new Error(`bilinmeyen karar alanı: ${spec.alan || spec.domain}. Kullanılabilir: ${Object.keys(DECISION_DOMAINS).join(', ')}`);
  const alts = (spec.secenekler || spec.alternatives || []).map((a, i) => ({ ...a, id: String(a.id ?? a.ad ?? `s${i + 1}`), ad: a.ad || String(a.id ?? `Seçenek ${i + 1}`) }));
  if (alts.length < 2) throw new Error('en az 2 seçenek gerekli');
  if (new Set(alts.map((a) => a.id)).size !== alts.length) throw new Error('seçenek kimlikleri benzersiz olmalı');
  const ctx = { ...(spec.baglam || spec.context || {}) };
  if (domain.hazirla) Object.assign(ctx, domain.hazirla(alts, ctx));
  const terms = [...domain.terimler, ILETISIM];
  return { domain, alts, ctx, terms };
}

/** Katsayılar: kuram öncülü ← öğrenilmiş model ← açık geçersiz kılma. */
export function coefficients(resolved, model = {}, overrides = {}) {
  const theta = {};
  for (const t of resolved.terms) theta[t.id] = t.onsel;
  Object.assign(theta, model.theta || {}, overrides.theta || {});
  const asc = {};
  for (const a of resolved.alts) asc[a.id] = Number.isFinite(+a.asc) ? +a.asc : 0;
  Object.assign(asc, model.asc || {}, overrides.asc || {});
  // Veriden öğrenilmiş seçeneğe özgü demografik etkiler: demo[altId]['boyut=değer'] = katsayı
  return { theta, asc, demo: model.demo || null };
}

/** Seçeneğe özgü demografik etki toplamı (öğrenilmiş modelde). */
export function demoUtility(demo, altId, p) {
  const d = demo && demo[altId];
  if (!d) return 0;
  let v = 0;
  for (const k in p) { const c = d[k + '=' + p[k]]; if (c) v += c; }
  return v;
}

/** Tek kişi için seçenek faydaları ve olasılıklar. zs: terim × seçenek özellik matrisi (yeniden kullanım için). */
export function personProbs(resolved, coef, f, p, i = 0, zs = null) {
  const { alts, terms, ctx } = resolved;
  const V = new Array(alts.length);
  for (let j = 0; j < alts.length; j++) {
    let v = (coef.asc[alts[j].id] || 0) + (coef.demo ? demoUtility(coef.demo, alts[j].id, p) : 0);
    for (let k = 0; k < terms.length; k++) {
      const z = zs ? zs[k][j] : terms[k].z(f, p, alts[j], ctx, i);
      v += (coef.theta[terms[k].id] || 0) * z;
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
export function zMatrix(resolved, f, p, i = 0) {
  return resolved.terms.map((t) => resolved.alts.map((a) => t.z(f, p, a, resolved.ctx, i)));
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
 * Bir karar durumunda nüfusun seçimlerini tahmin eder.
 * @param {object} spec  {alan, secenekler, baglam, kampanya?}
 * @param {object} opts  {n, seed, target, marginals, model, segmentBy, explain, theta, asc}
 */
export function predictChoice(spec, opts = {}) {
  const resolved = resolveChoice(spec);
  const coef = coefficients(resolved, opts.model, { theta: opts.theta, asc: opts.asc });
  const n = Math.max(50, Math.min(Math.round(opts.n || 2000), 20000));
  const popOpts = { n, seed: opts.seed ?? 42, target: opts.target, marginals: opts.marginals };
  const pop = samplePopulation(popOpts);
  if (!pop.length) throw new Error('hedef kitleye uyan persona örneklenemedi');
  resolved.ctx.iletisim = campaignEffects(resolved, spec.kampanya, popOpts);

  const J = resolved.alts.length;
  const people = pop.map((p, i) => {
    const f = features(p);
    const zs = zMatrix(resolved, f, p, i);
    return { p, f, zs, P: personProbs(resolved, coef, f, p, i, zs).P };
  });

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
    kaynak: opts.model?.kaynak || (opts.model?.theta ? 'veriden öğrenilmiş model' : 'kuram öncülleri (kalibre edilmemiş)'),
    dogrulama: opts.model?.cv ? { isabet_yuzde: opts.model.cv.isabet_yuzde, log_kayip: opts.model.cv.log_kayip, temel_isabet_yuzde: opts.model.cv.cogunluk_isabet_yuzde } : undefined,
  };
  const order = resolved.alts.map((a, j) => [a.id, shares[j]]).sort((x, y) => y[1] - x[1]);
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
          for (let q = 0; q < resolved.terms.length; q++) if (q !== k) v += (coef.theta[resolved.terms[q].id] || 0) * x.zs[q][j];
          return v;
        });
        const m = Math.max(...V), e = V.map((v) => Math.exp(v - m)), sum = e.reduce((a, b) => a + b, 0);
        s += e[wi] / sum;
      }
      return { terim: t.id, ad: t.ad, kuram: t.kuram, katsayi: r3(coef.theta[t.id]), kazanan_payina_etki_puan: r3((shares[wi] - s) / N * 100) };
    }).filter(Boolean).filter((x) => Math.abs(x.kazanan_payina_etki_puan) >= 0.05)
      .sort((a, b) => Math.abs(b.kazanan_payina_etki_puan) - Math.abs(a.kazanan_payina_etki_puan));
  }
  if (opts.keepPeople) result._people = people;
  return result;
}

/** Ne olur? Bir seçeneğin özelliklerini değiştirip payların nasıl kaydığını gösterir. */
export function whatIf(spec, changes, opts = {}) {
  const base = predictChoice(spec, { ...opts, explain: false });
  const changed = {
    ...spec,
    baglam: { ...(spec.baglam || {}), ...(changes.baglam || {}) },
    secenekler: (spec.secenekler || []).map((a) => {
      const id = String(a.id ?? a.ad);
      return changes.secenekler?.[id] ? { ...a, ...changes.secenekler[id] } : a;
    }),
    kampanya: changes.kampanya ?? spec.kampanya,
  };
  const after = predictChoice(changed, { ...opts, explain: false });
  return {
    once: base.paylar, sonra: after.paylar,
    degisim_puan: Object.fromEntries(Object.keys(base.paylar).map((k) => [k, r3(after.paylar[k] - base.paylar[k])])),
    kazanan_once: base.kazanan, kazanan_sonra: after.kazanan,
  };
}
