// AlphaZero döngüsü: self-play → deneyim tamponu → ağ eğitimi → arena (kapı bekçisi).
//
// Self-play'de her hamle MCTS ile seçilir; MCTS'nin ziyaret dağılımı (π) policy başının,
// oyun sonucu (z) value başının hedefidir. Arama ağı iyileştirir, iyi ağ aramayı iyileştirir.

import * as env from './env.js';
import { Node, search, pick, normalize } from './mcts.js';
import { rng } from './sim.js';
import * as S from './sim.js';

export const ENV = {
  clone: env.clone, apply: env.apply, isTerminal: env.isTerminal,
  legalMask: env.legalMask, encode: env.encode, outcome: env.outcome,
};

// Tek bir self-play oyunu. Dönen: { examples: [{x, pi, mask, z}], z, cost, base, moves, summary }
export function playGame(net, { seed, pool, nAgents, sims = 24, explore = true, tempMoves = 3 } = {}) {
  const rand = rng(seed * 7919 + 13);
  const start = env.initialState(seed, { pool, nAgents });
  const base = env.baselineCost(start);
  let root = new Node(start);
  const examples = [];
  let move = 0;

  while (!env.isTerminal(root.state)) {
    const visits = search(root, {
      env: ENV, net, base, sims, rand,
      noise: explore ? { alpha: 0.3, frac: 0.25 } : null,
    });
    examples.push({ x: Array.from(env.encode(root.state)), pi: Array.from(normalize(visits)), mask: env.legalMask(root.state) });
    const a = pick(visits, explore && move < tempMoves ? 1 : 0, rand);
    const child = root.children.get(a);
    if (!child.state) child.state = env.apply(env.clone(root.state), a);
    root = child;       // alt ağacı yeniden kullan
    move++;
  }

  const z = env.outcome(root.state, base);
  for (const e of examples) e.z = z;
  return {
    examples, z, base,
    cost: env.cost(root.state),
    moves: root.state.moves.slice(),
    summary: S.summary(root.state.world),
  };
}

// Basit kural tabanlı kıyas: ilk karar anında ana giriş dışındaki tüm kapılara
// gerekçeli anons. ("Bir güvenlik görevlisi ne yapardı?")
export function ruleBaseline(seed, { pool, nAgents } = {}) {
  const s = env.initialState(seed, { pool, nAgents });
  const base = env.baselineCost(s);
  const plan = [];
  for (let e = 1; e < env.hallExits().length; e++) plan.push(env.ACTIONS.findIndex((a) => a.type === 'announce' && a.exit === e && a.kind === 'reasoned'));
  // Her karar aralığında bir anons; plan bitince bekle.
  let i = 0;
  while (!env.isTerminal(s)) env.apply(s, plan[i++] ?? 0);
  return { cost: env.cost(s), base, z: env.outcome(s, base), moves: s.moves, summary: S.summary(s.world) };
}

// Deneyim tamponu: son `capacity` örnek.
export class Replay {
  constructor(capacity = 4000) { this.capacity = capacity; this.items = []; }
  add(list) {
    this.items.push(...list);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }
  sample(n, rand) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(this.items[Math.floor(rand() * this.items.length)]);
    return out;
  }
}

export function trainNet(net, replay, { steps = 200, batch = 64, lr = 1e-3, seed = 1 } = {}) {
  const rand = rng(seed);
  let agg = { loss: 0, vLoss: 0, pLoss: 0 };
  for (let s = 0; s < steps; s++) {
    const b = replay.sample(batch, rand);
    const r = net.train(b, { lr });
    agg.loss += r.loss; agg.vLoss += r.vLoss; agg.pLoss += r.pLoss;
  }
  for (const k in agg) agg[k] /= steps;
  return agg;
}

// Arena: sabit tohumlarda, keşifsiz (açgözlü) MCTS ile oynayıp ortalama maliyeti ölçer.
export function evaluate(net, seeds, { pool, nAgents, sims = 24 } = {}) {
  const games = seeds.map((seed) => playGame(net, { seed, pool, nAgents, sims, explore: false }));
  const mean = (f) => games.reduce((s, g) => s + f(g), 0) / games.length;
  return { cost: mean((g) => g.cost), base: mean((g) => g.base), z: mean((g) => g.z), games };
}
