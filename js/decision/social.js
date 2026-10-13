// Nüfus düzeyinde sosyal yapı ve sosyal yayılma. Bireysel karar modeli tek başına "atomize birey"
// varsayar; burada sentetik nüfus haneler, tartışma ağları ve topluluklar halinde örülür ve bir
// müdahalenin (kampanya, fiyat, aday değişimi) etkisi bu bağlar üzerinden yayılır.
//   hane     : eş eşleşmesi, eğitim/yaş/dindarlık/ideoloji homogamisi (Alford vd. 2011);
//              hane içi bulaşma (Nickerson 2008: doğrudan etkinin ~%60'ı diğer üyeye geçer)
//   ağ       : homofili tartışma ağı (McPherson, Smith-Lovin & Cook 2001), kanaat önderleri ve
//              bilişsel ihtiyacı yüksekler daha çok bağlı (Katz & Lazarsfeld 1955, iki aşamalı akış)
//   topluluk : yerleşim/bölge hücresi; etki topluluğa gömülü kişide güçlü (Huckfeldt & Sprague 1995)
// Fayda katkısı, öğrenilmiş/öncül aile, ag, topluluk katsayılarıyla ve TABAN senaryoya göre sapma
// olarak girer: müdahale yokken tahmin değişmez (bireysel model çevrenin bileşimini zaten taşır),
// müdahale varsa bağlar onu çoğaltır (sosyal çarpan, Glaeser, Sacerdote & Scheinkman 2003).

import { rng } from '../audience/personas.js';

const AGE = { '18-24': 0, '25-34': 1, '35-44': 2, '45-54': 3, '55-64': 4, '65+': 5 };
const MARRIED = [0.15, 0.5, 0.7, 0.72, 0.7, 0.55];   // yaşa göre evli/birlikte yaşayan oranı (yaklaşık)

/** pop: personalar, f: özellikleri (features). Döner {es, ag, grup, gom}. */
export function socialStructure(pop, f, seed = 42) {
  const n = pop.length, r = rng((seed * 7919 + 11) >>> 0);
  const age = pop.map((p) => AGE[p.yas] ?? 2);
  const grupAd = pop.map((p) => String(p.bolge ?? '') + '|' + String(p.yerlesim ?? ''));
  const ids = [...new Set(grupAd)], grup = grupAd.map((g) => ids.indexOf(g));
  const dist = (i, j) => 2 * Math.abs(f[i].ideoloji - f[j].ideoloji) + Math.abs(f[i].egitim - f[j].egitim)
    + Math.abs(f[i].dindarlik - f[j].dindarlik) + Math.abs(age[i] - age[j]) / 2.5;
  const gumbel = () => -Math.log(-Math.log(r() || 1e-12));
  const byGroup = ids.map(() => []);
  grup.forEach((g, i) => byGroup[g].push(i));
  const draw = (i) => { const G = byGroup[grup[i]]; return r() < 0.75 ? G[Math.floor(r() * G.length)] : Math.floor(r() * n); };

  // Hane: önce kim evli belirlenir; evliler aynı yerleşimde, karşı cinsten en benzer adayla eşleşir
  const es = new Int32Array(n).fill(-1);
  const evli = age.map((a) => r() < MARRIED[a]);
  for (const i of [...Array(n).keys()].sort(() => r() - 0.5)) {
    if (es[i] >= 0 || !evli[i]) continue;
    let best = -1, bs = -Infinity;
    for (let c = 0; c < 30; c++) {
      const G = byGroup[grup[i]], j = G[Math.floor(r() * G.length)];
      if (j === i || !evli[j] || es[j] >= 0 || pop[j].cinsiyet === pop[i].cinsiyet) continue;
      const s = -1.5 * dist(i, j) + gumbel();
      if (s > bs) { bs = s; best = j; }
    }
    if (best >= 0) { es[i] = best; es[best] = i; }
  }
  // Tartışma ağı: 3–9 bağ, homofiliyle seçilir
  const ag = pop.map((p, i) => {
    const k = 3 + 3 * f[i].nfc + 3 * f[i].leader;
    const cand = [];
    for (let c = 0; c < 40; c++) { const j = draw(i); if (j !== i && j !== es[i]) cand.push([j, -1.2 * dist(i, j) + gumbel()]); }
    return [...new Set(cand.sort((a, b) => b[1] - a[1]).map((x) => x[0]))].slice(0, k);
  });
  const gom = f.map((x) => 0.6 + 0.8 * (0.4 * (1 - x.yerlesim) + 0.3 * x.yas + 0.3 * x.dindarlik));
  return { es, ag, grup, ngrup: ids.length, gom };
}

const groupMeans = (P, net, J) => {
  const s = Array.from({ length: net.ngrup }, () => new Array(J).fill(0)), c = new Array(net.ngrup).fill(0);
  P.forEach((q, i) => { c[net.grup[i]]++; for (let j = 0; j < J; j++) s[net.grup[i]][j] += q[j]; });
  return s.map((v, g) => v.map((x) => x / Math.max(1, c[g])));
};
const nbrMean = (P, list, J) => { const m = new Array(J).fill(0); for (const k of list) for (let j = 0; j < J; j++) m[j] += P[k][j] / list.length; return m; };

/**
 * Sosyal yayılma (ortalama alan dengesi). P0: bireysel model olasılıkları (müdahaleli),
 * R: taban senaryo olasılıkları (müdahalesiz), th: {aile, ag, topluluk} katsayıları.
 * Kesitsel katsayılar homofiliyi (benzerin benzeri seçmesi) de taşır; nedensel pay `nedensellik`
 * (Aral, Muchnik & Sundararajan 2009: görünen bulaşmanın >%50'si homofili). Kazanç 0.8'i aşarsa
 * (devrilme/kaçak denge) ölçeklenir: tek, kararlı denge.
 */
export function diffuse(P0, R, net, th0, { tur = 15, sonum = 0.5, nedensellik = 0.4 } = {}) {
  const gain = 0.25 * nedensellik * (Math.abs(th0.aile) + Math.abs(th0.ag) + 1.4 * Math.abs(th0.topluluk));
  const k = nedensellik * Math.min(1, 0.8 / Math.max(1e-9, gain));
  const th = { aile: k * th0.aile, ag: k * th0.ag, topluluk: k * th0.topluluk };
  const J = P0[0].length, L0 = P0.map((q) => q.map((x) => Math.log(Math.max(1e-12, x))));
  const Rn = R.map((_, i) => (net.ag[i].length ? nbrMean(R, net.ag[i], J) : null));
  const Rg = groupMeans(R, net, J);
  let P = P0.map((q) => q.slice());
  for (let t = 0; t < tur; t++) {
    const Cg = groupMeans(P, net, J);
    P = P.map((q, i) => {
      const V = L0[i].slice();
      const e = net.es[i];
      const nm = Rn[i] ? nbrMean(P, net.ag[i], J) : null;
      for (let j = 0; j < J; j++) {
        if (e >= 0) V[j] += th.aile * (P[e][j] - R[e][j]);
        if (nm) V[j] += th.ag * (nm[j] - Rn[i][j]);
        const g = net.grup[i];
        V[j] += th.topluluk * net.gom[i] * (Cg[g][j] - Rg[g][j]);   // sapmada doğrusal (log kazancı patlatır)
      }
      const m = Math.max(...V), ex = V.map((v) => Math.exp(v - m)), s = ex.reduce((a, b) => a + b, 0);
      return ex.map((x, j) => (1 - sonum) * (x / s) + sonum * q[j]);
    });
  }
  return P;
}
