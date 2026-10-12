// Kurum verisiyle kalibrasyon. Kuramlar yönü verir; büyüklüğü kurumun kendi geçmişi belirler.
// Girdi: geçmiş kampanyalar ve gözlenen sonuçları (anket, erişim ölçümü, dönüşüm…).
// Çıktı: {weights, intercepts, fit} — predict(..., {calibration}) ile kullanılır.
// Yöntem: düzenlileştirilmiş koordinat inişi. Kuram ağırlıkları 1'den (kuramsal ön kabul)
// uzaklaştıkça cezalandırılır; az veriyle aşırı uyumu ve kuramı "silmeyi" engeller.

import { predict } from './engine.js';
import { THEORIES, lensWeights } from './theories.js';

/** Gözlem anahtarı → ilgili sabit terim ve hata ölçeği (yüzde ölçeği 0..100, tutum -1..1). */
const METRICS = {
  erisim_yuzde: { icpt: 'exp', scale: 100 },
  olumlu_yuzde: { icpt: 'shift', scale: 100 },
  ortalama_tutum: { icpt: 'shift', scale: 1 },
  paylasim_yuzde: { icpt: 'share', scale: 100 },
  benimseme_yuzde: { icpt: 'adopt', scale: 100 },
};
export const CALIBRATION_METRICS = Object.keys(METRICS);

function loss(obs, cal, n, lambda) {
  let err = 0, cnt = 0;
  for (const o of obs) {
    const r = predict(o.message, { ...o.opts, n, bootstrap: 0, calibration: cal }).sonuc;
    for (const [k, v] of Object.entries(o.observed)) {
      const e = (r[k] - v) / METRICS[k].scale;
      err += e * e; cnt++;
    }
  }
  let reg = 0;
  for (const w of Object.values(cal.weights)) reg += (w - 1) ** 2;
  return { mse: err / Math.max(1, cnt), total: err / Math.max(1, cnt) + lambda * reg / 1000 };
}

/**
 * @param {Array<{message, opts?, observed}>} observations
 * @param {object} o  {n=300, rounds=3, lambda=1, lens, tuneWeights=true}
 */
export function calibrate(observations, o = {}) {
  if (!Array.isArray(observations) || !observations.length) throw new Error('en az bir gözlem gerekli');
  const obs = observations.map((x, i) => {
    const observed = {};
    for (const [k, v] of Object.entries(x.observed || x.gozlenen || {})) {
      if (!METRICS[k]) throw new Error(`gözlem ${i + 1}: bilinmeyen metrik ${k}. Kullanılabilir: ${CALIBRATION_METRICS.join(', ')}`);
      if (!Number.isFinite(+v)) throw new Error(`gözlem ${i + 1}: ${k} sayı olmalı`);
      observed[k] = +v;
    }
    if (!Object.keys(observed).length) throw new Error(`gözlem ${i + 1}: gözlenen değer yok`);
    return { message: x.message || x.mesaj, opts: { lens: o.lens, ...(x.opts || {}), target: x.target || x.hedef }, observed };
  });

  const n = o.n || 300, rounds = o.rounds || 3, lambda = o.lambda ?? 1;
  const used = new Set(obs.flatMap((x) => Object.keys(x.observed).map((k) => METRICS[k].icpt)));
  const active = lensWeights(o.lens);   // kapalı mercekteki kuramlar ayarlanmaz
  const cal = { weights: Object.fromEntries(THEORIES.filter((t) => !t.core && active[t.id]).map((t) => [t.id, 1])), intercepts: { exp: 0, shift: 0, share: 0, adopt: 0 } };
  const before = loss(obs, cal, n, lambda);
  let best = before.total;

  // Az gözlemde yalnızca sabit terimleri oynat (serbestlik derecesi gözlemi aşmasın).
  const nObs = obs.reduce((s, x) => s + Object.keys(x.observed).length, 0);
  const tuneWeights = o.tuneWeights ?? nObs >= 4;
  const params = [
    ...[...used].map((k) => ({ get: () => cal.intercepts[k], set: (v) => { cal.intercepts[k] = v; }, step: 0.8, lo: -4, hi: 4 })),
    ...(tuneWeights ? Object.keys(cal.weights).map((k) => ({ get: () => cal.weights[k], set: (v) => { cal.weights[k] = v; }, step: 0.5, lo: 0, hi: 2.5 })) : []),
  ];

  for (let round = 0; round < rounds; round++) {
    for (const p of params) {
      for (const dir of [1, -1]) {
        let improved = true;
        while (improved) {
          improved = false;
          const cur = p.get();
          const next = Math.max(p.lo, Math.min(p.hi, cur + dir * p.step));
          if (next === cur) break;
          p.set(next);
          const l = loss(obs, cal, n, lambda).total;
          if (l < best - 1e-6) { best = l; improved = true; } else p.set(cur);
        }
      }
      p.step /= 1.6;
    }
  }

  const after = loss(obs, cal, n, lambda);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  for (const k in cal.weights) cal.weights[k] = r3(cal.weights[k]);
  for (const k in cal.intercepts) cal.intercepts[k] = r3(cal.intercepts[k]);
  const moved = Object.entries(cal.weights).filter(([, w]) => Math.abs(w - 1) > 0.05).map(([k, w]) => ({ kuram: k, agirlik: w }));
  return {
    ...cal,
    fit: {
      gozlem: obs.length, olcum: nObs, agirliklar_ayarlandi: tuneWeights,
      once_rmse: r3(Math.sqrt(before.mse)), sonra_rmse: r3(Math.sqrt(after.mse)),
      degisen_kuramlar: moved,
      not: nObs < 4 ? 'Az veri: yalnızca sabit terimler ayarlandı; kuram ağırlıkları için en az 4 ölçüm girin.' : undefined,
    },
  };
}
