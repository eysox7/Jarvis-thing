// AlphaZero tarzı Monte Carlo Ağaç Araması (PUCT).
//
//   seç:     a* = argmax  Q(s,a) + c · P(s,a) · √N(s) / (1 + N(s,a))
//   genişlet: yaprakta ağ çağrılır → öncel P ve değer v (rollout yok; AlphaZero'daki gibi)
//   geri yay: yol boyunca W += v, N += 1
//
// Tek oyunculu ve deterministik olduğundan değer işareti çevrilmez.
// Ortam arayüzü: { clone, apply, isTerminal, legalMask, encode, outcome }

export class Node {
  constructor(state, prior = 0) {
    this.state = state;
    this.prior = prior;
    this.N = 0;
    this.W = 0;
    this.children = null;  // Map<action, Node>; null = genişletilmedi
    this.P = null;
    this.v = 0;            // ağın bu düğüm için tahmini
  }
  get Q() { return this.N ? this.W / this.N : this.v; }
}

export function search(root, { env, net, base, sims = 32, cpuct = 1.5, noise = null, rand = Math.random }) {
  if (!root.children) expand(root, env, net, base);
  if (noise && root.P) addNoise(root, noise, rand);

  for (let s = 0; s < sims; s++) {
    const path = [root];
    let node = root;
    // Seçim
    while (node.children && !env.isTerminal(node.state)) {
      const a = select(node, cpuct);
      let child = node.children.get(a);
      if (!child.state) {
        child.state = env.apply(env.clone(node.state), a);
      }
      node = child;
      path.push(node);
      if (!node.children) break;
    }
    // Genişletme / değerlendirme
    const v = node.children ? node.v : expand(node, env, net, base);
    // Geri yayılım
    for (const n of path) { n.N++; n.W += v; }
  }

  const visits = new Float64Array(root.P.length);
  for (const [a, c] of root.children) visits[a] = c.N;
  return visits;
}

function expand(node, env, net, base) {
  if (env.isTerminal(node.state)) {
    node.v = env.outcome(node.state, base);
    node.children = new Map();
    node.P = new Float64Array(0);
    return node.v;
  }
  const mask = env.legalMask(node.state);
  const { p, v } = net.predict(env.encode(node.state), mask);
  node.P = p;
  node.v = v;
  node.children = new Map();
  for (let a = 0; a < p.length; a++) if (mask[a]) node.children.set(a, new Node(null, p[a]));
  return v;
}

function select(node, cpuct) {
  const sqrtN = Math.sqrt(Math.max(1, node.N));
  let best = -1, bestU = -Infinity;
  for (const [a, c] of node.children) {
    // Ziyaret edilmemiş çocuk için Q yerine ebeveynin değeri (FPU) kullanılır.
    const q = c.N ? c.W / c.N : node.Q - 0.1;
    const u = q + cpuct * c.prior * sqrtN / (1 + c.N);
    if (u > bestU) { bestU = u; best = a; }
  }
  return best;
}

function addNoise(root, { alpha = 0.3, frac = 0.25 }, rand) {
  const acts = [...root.children.keys()];
  const g = acts.map(() => gamma(alpha, rand));
  const sum = g.reduce((s, v) => s + v, 0) || 1;
  acts.forEach((a, i) => {
    const c = root.children.get(a);
    c.prior = (1 - frac) * c.prior + frac * (g[i] / sum);
  });
}

// Marsaglia–Tsang; alpha < 1 için güçlendirme hilesiyle.
function gamma(alpha, rand) {
  if (alpha < 1) return gamma(alpha + 1, rand) * Math.pow(rand() || 1e-12, 1 / alpha);
  const d = alpha - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      x = Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

// Ziyaret sayılarından hamle seç. temp→0: en çok ziyaret edilen.
export function pick(visits, temp, rand = Math.random) {
  if (temp < 1e-3) {
    let best = 0;
    for (let a = 1; a < visits.length; a++) if (visits[a] > visits[best]) best = a;
    return best;
  }
  const w = Array.from(visits, (n) => n ** (1 / temp));
  const sum = w.reduce((s, v) => s + v, 0);
  let r = rand() * sum;
  for (let a = 0; a < w.length; a++) { r -= w[a]; if (r <= 0 && w[a] > 0) return a; }
  return w.findIndex((v) => v > 0);
}

export function normalize(visits) {
  const sum = visits.reduce((s, v) => s + v, 0) || 1;
  return Float64Array.from(visits, (v) => v / sum);
}
