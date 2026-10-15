// AlphaZero'nun iki başlı ağı: ortak gövde → policy (eylem olasılıkları) + value (beklenen sonuç).
// Saf JS, bağımlılıksız. Küçük boyutlar için yeterince hızlı (CPU, tek iş parçacığı).
//
// Kayıp (AlphaZero makalesindeki gibi):  L = (z - v)² − πᵀ log p + c‖θ‖²

import { rng } from './rng.js';

export class Net {
  constructor({ input, hidden = [128, 64], actions, seed = 1 } = {}) {
    this.shape = { input, hidden, actions };
    const rand = rng(seed);
    const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
    const layer = (nin, nout) => ({
      nin, nout,
      W: Float64Array.from({ length: nin * nout }, () => gauss() * Math.sqrt(2 / nin)),   // He
      b: new Float64Array(nout),
    });
    this.trunk = [];
    let prev = input;
    for (const h of hidden) { this.trunk.push(layer(prev, h)); prev = h; }
    this.policy = layer(prev, actions);
    this.value = layer(prev, 1);
    // Çıkış katmanlarını küçük başlat: başta tekdüze policy, ~0 value.
    for (const L of [this.policy, this.value]) L.W.forEach((_, i) => (L.W[i] *= 0.1));
    this.layers = [...this.trunk, this.policy, this.value];
    this.adam = this.layers.map((L) => ({
      mW: new Float64Array(L.W.length), vW: new Float64Array(L.W.length),
      mb: new Float64Array(L.b.length), vb: new Float64Array(L.b.length),
    }));
    this.steps = 0;
  }

  // İleri geçiş. mask: legal eylemler (boolean dizisi); illegal olanlar 0 olasılık alır.
  predict(x, mask = null) {
    const { acts } = this.#forward(x);
    const h = acts[acts.length - 1];
    const logits = affine(this.policy, h);
    const v = Math.tanh(affine(this.value, h)[0]);
    return { p: softmax(logits, mask), v };
  }

  #forward(x) {
    const acts = [x];
    let h = x;
    for (const L of this.trunk) {
      h = affine(L, h);
      for (let i = 0; i < h.length; i++) if (h[i] < 0) h[i] = 0;   // ReLU
      acts.push(h);
    }
    return { acts };
  }

  // Bir mini-batch üzerinde tek Adam adımı.
  // batch: [{ x, pi, z, mask }]. Dönen değer: ortalama { loss, vLoss, pLoss }.
  train(batch, { lr = 1e-3, l2 = 1e-4, beta1 = 0.9, beta2 = 0.999, eps = 1e-8 } = {}) {
    const grads = this.layers.map((L) => ({ W: new Float64Array(L.W.length), b: new Float64Array(L.b.length) }));
    const gi = (L) => grads[this.layers.indexOf(L)];
    let vLoss = 0, pLoss = 0;

    for (const { x, pi, z, mask } of batch) {
      const { acts } = this.#forward(x);
      const h = acts[acts.length - 1];
      const p = softmax(affine(this.policy, h), mask);
      const v = Math.tanh(affine(this.value, h)[0]);

      vLoss += (z - v) ** 2;
      for (let a = 0; a < p.length; a++) if (pi[a] > 0) pLoss -= pi[a] * Math.log(p[a] + 1e-12);

      // Çıkış gradyanları.
      const dLogits = new Float64Array(p.length);
      for (let a = 0; a < p.length; a++) dLogits[a] = (mask && !mask[a]) ? 0 : p[a] - pi[a];
      const dV = [-2 * (z - v) * (1 - v * v)];

      const dh = new Float64Array(h.length);
      backAffine(this.policy, h, dLogits, gi(this.policy), dh);
      backAffine(this.value, h, dV, gi(this.value), dh);

      // Gövdede geri yayılım.
      let delta = dh;
      for (let l = this.trunk.length - 1; l >= 0; l--) {
        const L = this.trunk[l];
        const out = acts[l + 1];
        for (let i = 0; i < delta.length; i++) if (out[i] <= 0) delta[i] = 0;   // ReLU türevi
        const dPrev = l > 0 ? new Float64Array(L.nin) : null;
        backAffine(L, acts[l], delta, gi(L), dPrev);
        delta = dPrev;
      }
    }

    // Adam güncellemesi (+ L2).
    const n = batch.length;
    this.steps++;
    const bc1 = 1 - beta1 ** this.steps, bc2 = 1 - beta2 ** this.steps;
    this.layers.forEach((L, li) => {
      const g = grads[li], m = this.adam[li];
      const upd = (P, G, M, V, decay) => {
        for (let i = 0; i < P.length; i++) {
          const gr = G[i] / n + (decay ? l2 * P[i] : 0);
          M[i] = beta1 * M[i] + (1 - beta1) * gr;
          V[i] = beta2 * V[i] + (1 - beta2) * gr * gr;
          P[i] -= (lr * (M[i] / bc1)) / (Math.sqrt(V[i] / bc2) + eps);
        }
      };
      upd(L.W, g.W, m.mW, m.vW, true);
      upd(L.b, g.b, m.mb, m.vb, false);
    });
    return { vLoss: vLoss / n, pLoss: pLoss / n, loss: (vLoss + pLoss) / n };
  }

  toJSON() {
    return {
      shape: this.shape,
      layers: this.layers.map((L) => ({ nin: L.nin, nout: L.nout, W: Array.from(L.W, r6), b: Array.from(L.b, r6) })),
    };
  }

  static fromJSON(j) {
    const net = new Net({ ...j.shape });
    net.layers.forEach((L, i) => { L.W.set(j.layers[i].W); L.b.set(j.layers[i].b); });
    return net;
  }

  copy() { return Net.fromJSON(this.toJSON()); }
}

const r6 = (v) => Math.round(v * 1e6) / 1e6;

function affine(L, x) {
  const out = new Float64Array(L.nout);
  for (let o = 0; o < L.nout; o++) {
    let s = L.b[o];
    const row = o * L.nin;
    for (let i = 0; i < L.nin; i++) s += L.W[row + i] * x[i];
    out[o] = s;
  }
  return out;
}

// dOut → parametre gradyanları (g'ye eklenir) ve girdi gradyanı (dIn'e eklenir).
function backAffine(L, x, dOut, g, dIn) {
  for (let o = 0; o < L.nout; o++) {
    const d = dOut[o];
    if (d === 0) continue;
    const row = o * L.nin;
    g.b[o] += d;
    for (let i = 0; i < L.nin; i++) {
      g.W[row + i] += d * x[i];
      if (dIn) dIn[i] += d * L.W[row + i];
    }
  }
}

export function softmax(logits, mask = null) {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if ((!mask || mask[i]) && logits[i] > max) max = logits[i];
  const p = new Float64Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    if (mask && !mask[i]) continue;
    p[i] = Math.exp(logits[i] - max);
    sum += p[i];
  }
  for (let i = 0; i < p.length; i++) p[i] /= sum || 1;
  return p;
}
