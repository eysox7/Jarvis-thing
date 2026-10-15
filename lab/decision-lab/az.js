// AlphaZero: karar senaryosunda self-play → eğitim → arena.
// Tarayıcıda Web Worker içinde (az-worker.js) veya Node'da çalışır.

import { Net } from '../core/nn.js';
import { Node, search, pick, normalize } from '../core/mcts.js';
import { rng } from '../core/rng.js';
import * as M from './model.js';

// Tek oyun. explore=false: gürültüsüz, en çok ziyaret edilen hamle (değerlendirme/plan).
export function playGame(ctx, env, net, { sims = 64, explore = true, rand = Math.random, base, tempMoves = 4 } = {}) {
  let root = new Node(M.initialState(ctx, undefined, { design: true }));
  const examples = [];
  let move = 0;
  while (!env.isTerminal(root.state)) {
    const visits = search(root, { env, net, base, sims, rand, noise: explore ? { alpha: 0.5, frac: 0.25 } : null });
    examples.push({ x: Array.from(env.encode(root.state)), pi: Array.from(normalize(visits)), mask: env.legalMask(root.state) });
    const a = pick(visits, explore && move < tempMoves ? 1 : 0, rand);
    const child = root.children.get(a);
    if (!child.state) child.state = env.apply(env.clone(root.state), a);
    root = child;
    move++;
  }
  const z = env.outcome(root.state, base);
  for (const e of examples) e.z = z;
  return { examples, z, final: root.state, result: M.score(ctx, root.state) };
}

// Eğitim döngüsü. onProgress({ it, ... }) her iterasyonda çağrılır; shouldStop() true dönerse durur.
export function train(ctx, { iters = 20, games = 6, sims = 48, steps = 120, batch = 64, lr = 2e-3, seed = 1, onProgress = () => {}, shouldStop = () => false } = {}) {
  const env = M.makeEnv(ctx);
  const start = M.initialState(ctx, undefined, { design: true });
  const base = M.baselineScore(ctx, start);
  const rand = rng(seed);

  let net = new Net({ input: M.inputSize(ctx), actions: ctx.actions.length, hidden: [64, 64], seed });
  net.policy.b[0] = 1.5;     // başlangıçta "bekle/onayla" biraz daha olası (eylemlerin çoğu müdahale)
  let best = net.copy();
  let bestRun = playGame(ctx, env, best, { sims, explore: false, base });
  const buffer = [];
  const history = [];

  for (let it = 1; it <= iters && !shouldStop(); it++) {
    let zSum = 0;
    for (let g = 0; g < games; g++) {
      const r = playGame(ctx, env, net, { sims, explore: true, rand, base });
      buffer.push(...r.examples);
      zSum += r.z;
    }
    if (buffer.length > 3000) buffer.splice(0, buffer.length - 3000);

    let loss = 0;
    for (let k = 0; k < steps; k++) {
      const b = Array.from({ length: Math.min(batch, buffer.length) }, () => buffer[Math.floor(rand() * buffer.length)]);
      loss += net.train(b, { lr }).loss;
    }

    const run = playGame(ctx, env, net, { sims, explore: false, base });
    const accepted = run.result.total >= bestRun.result.total;
    if (accepted) { best = net.copy(); bestRun = run; } else net = best.copy();

    const row = {
      it, selfPlayZ: zSum / games, loss: loss / steps, score: run.result.total,
      best: bestRun.result.total, base, accepted,
    };
    history.push(row);
    onProgress({ ...row, moves: bestRun.final.moves.slice(), plan: M.describeMoves(ctx, bestRun.final.moves), parts: bestRun.result.parts, segs: bestRun.result.segs, series: bestRun.final.series, config: bestRun.final.config });
  }
  return { net: best, run: bestRun, base, history };
}
