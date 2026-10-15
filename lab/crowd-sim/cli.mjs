#!/usr/bin/env node
// AlphaZero × MatrAIx tahliye ajanı — komut satırı.
//
//   node cli.mjs train   [--iters 8] [--games 8] [--sims 16] [--agents 200] [--params persona-params.json]
//   node cli.mjs compare [--model models/best.json] [--seeds 6] [--sims 24] [--params ...]
//   node cli.mjs plan    [--model models/best.json] [--seed 1] [--sims 24] [--params ...]
//
// --params: matraix/calibrate.py çıktısı. Verilmezse yerleşik (sentetik) personalar kullanılır.

import { Worker } from 'node:worker_threads';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Net } from '../core/nn.js';
import * as env from './env.js';
import { Replay, trainNet, ruleBaseline } from './alphazero.js';
import { poolFromPersonas, poolFromCalibration } from './personas.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] || 'help';
const num = (k, d) => (args[k] != null ? Number(args[k]) : d);

const pool = args.params
  ? poolFromCalibration(JSON.parse(readFileSync(args.params, 'utf8')))
  : poolFromPersonas();
const poolSource = args.params ? `MatrAIx kalibrasyonu (${args.params})` : 'yerleşik sentetik personalar';
const nAgents = num('agents', 200);
const modelsDir = args.out || join(HERE, 'models');

if (cmd === 'train') await train();
else if (cmd === 'compare') await compare();
else if (cmd === 'plan') await plan();
else {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).join('\n'));
}

// ── Eğitim ──────────────────────────────────────────────────────────────────
async function train() {
  const iters = num('iters', 8), games = num('games', 8), sims = num('sims', 16);
  mkdirSync(modelsDir, { recursive: true });
  const bestPath = join(modelsDir, 'best.json');
  const logPath = join(modelsDir, 'train-log.jsonl');

  let best = existsSync(bestPath) && !args.fresh
    ? Net.fromJSON(JSON.parse(readFileSync(bestPath, 'utf8')))
    : freshNet();
  let net = best.copy();
  const replay = new Replay(num('buffer', 4000));
  const arenaSeeds = [9001, 9002, 9003, 9004];
  let seedBase = num('seed', 1) * 100000 + Date.now() % 100000;

  console.log(`Personalar: ${poolSource} (${pool.length} tip), ${nAgents} kişi, ${sims} MCTS simülasyonu/hamle`);
  let bestScore = (await parallel(best, arenaSeeds, { sims, explore: false })).reduce((s, g) => s + g.cost, 0) / arenaSeeds.length;
  console.log(`Başlangıç arena maliyeti: ${bestScore.toFixed(1)}`);

  for (let it = 1; it <= iters; it++) {
    const t0 = Date.now();
    const seeds = Array.from({ length: games }, () => seedBase++);
    const played = await parallel(net, seeds, { sims, explore: true });
    for (const g of played) replay.add(g.examples);
    const meanZ = played.reduce((s, g) => s + g.z, 0) / played.length;

    const loss = trainNet(net, replay, { steps: num('steps', 150), batch: 64, lr: num('lr', 1e-3), seed: it });

    const arena = await parallel(net, arenaSeeds, { sims, explore: false });
    const score = arena.reduce((s, g) => s + g.cost, 0) / arena.length;
    const accepted = score <= bestScore;
    if (accepted) { best = net.copy(); bestScore = score; writeFileSync(bestPath, JSON.stringify(best.toJSON())); }
    else net = best.copy();   // reddedilen ağ geri alınır (AlphaGo Zero kapı bekçisi)

    const row = {
      it, at: new Date().toISOString(), secs: Math.round((Date.now() - t0) / 1000),
      selfPlayZ: +meanZ.toFixed(3), buffer: replay.items.length,
      loss: +loss.loss.toFixed(4), vLoss: +loss.vLoss.toFixed(4), pLoss: +loss.pLoss.toFixed(4),
      arenaCost: +score.toFixed(2), bestCost: +bestScore.toFixed(2), accepted, sims, games, nAgents, pool: poolSource,
    };
    appendFileSync(logPath, JSON.stringify(row) + '\n');
    console.log(`#${it} ${row.secs}sn  self-play z=${row.selfPlayZ}  kayıp=${row.loss} (v ${row.vLoss}, p ${row.pLoss})  arena=${row.arenaCost}  en iyi=${row.bestCost} ${accepted ? '✔ kabul' : '✖ ret'}`);
  }
}

function freshNet() {
  const net = new Net({ input: env.INPUT_SIZE, actions: env.ACTIONS.length, seed: 1 });
  // 17 eylemin 16'sı müdahale: tekdüze bir öncel, aramayı rastgele anons yağmuruna iter.
  // Başlangıçta "bekle" (eylem 0) olasılığı ~%40 olsun; gerisini self-play öğrensin.
  net.policy.b[0] = 2.5;
  return net;
}

// ── Karşılaştırma ───────────────────────────────────────────────────────────
async function compare() {
  const model = loadModel();
  const seeds = Array.from({ length: num('seeds', 6) }, (_, i) => 5001 + i);
  const az = await parallel(model, seeds, { sims: num('sims', 24), explore: false });
  const rows = seeds.map((seed, i) => {
    const rule = ruleBaseline(seed, { pool, nAgents });
    return { seed, base: az[i].base, rule: rule.cost, az: az[i].cost, azLast: az[i].summary.lastExit, ruleLast: rule.summary.lastExit, azDanger: az[i].summary.dangerTime, ruleDanger: rule.summary.dangerTime };
  });
  const mean = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
  console.log(`Personalar: ${poolSource}\n`);
  console.log('tohum   müdahalesiz   kural    AlphaZero');
  for (const r of rows) console.log(`${String(r.seed).padEnd(8)}${r.base.toFixed(1).padStart(10)}${r.rule.toFixed(1).padStart(9)}${r.az.toFixed(1).padStart(12)}`);
  console.log(`ortalama${mean('base').toFixed(1).padStart(10)}${mean('rule').toFixed(1).padStart(9)}${mean('az').toFixed(1).padStart(12)}`);
  console.log(`\nSon kişinin çıkışı (sn): kural ${mean('ruleLast').toFixed(1)}, AlphaZero ${mean('azLast').toFixed(1)}`);
  console.log(`Tehlikeli yoğunluk süresi (sn): kural ${mean('ruleDanger').toFixed(2)}, AlphaZero ${mean('azDanger').toFixed(2)}`);
  if (args.json) writeFileSync(args.json, JSON.stringify({ pool: poolSource, rows }, null, 2));
}

// ── Tek bir planı göster ────────────────────────────────────────────────────
async function plan() {
  const model = loadModel();
  const [g] = await parallel(model, [num('seed', 1)], { sims: num('sims', 24), explore: false });
  console.log(`Müdahalesiz maliyet ${g.base.toFixed(1)} → AlphaZero ${g.cost.toFixed(1)} (z=${g.z.toFixed(2)})`);
  g.moves.forEach((m, i) => { if (env.ACTIONS[m].type !== 'noop') console.log(`  t=${String(i * env.DECISION).padStart(3)} sn  ${env.describe(env.ACTIONS[m])}`); });
  console.log('Özet:', JSON.stringify(g.summary));
  if (args.json) writeFileSync(args.json, JSON.stringify({ seed: num('seed', 1), pool: poolSource, ...g, examples: undefined, actions: g.moves.map((m) => env.describe(env.ACTIONS[m])) }, null, 2));
}

// ── Yardımcılar ─────────────────────────────────────────────────────────────
function loadModel() {
  const p = args.model || join(modelsDir, 'best.json');
  if (!existsSync(p)) { console.error(`Model yok: ${p}. Önce: node cli.mjs train`); process.exit(1); }
  return Net.fromJSON(JSON.parse(readFileSync(p, 'utf8')));
}

// Tohumları çekirdeklere bölüp oyunları paralel oynatır; sonuçları tohum sırasıyla döndürür.
async function parallel(net, seeds, { sims, explore }) {
  const workers = Math.max(1, Math.min(num('workers', cpus().length), seeds.length));
  const chunks = Array.from({ length: workers }, () => []);
  seeds.forEach((s, i) => chunks[i % workers].push(s));
  const netJSON = net.toJSON();
  const parts = await Promise.all(chunks.map((chunk) => new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.mjs', import.meta.url), {
      workerData: { netJSON, seeds: chunk, pool, nAgents, sims, explore },
    });
    w.once('message', resolve);
    w.once('error', reject);
  })));
  const out = new Array(seeds.length);
  chunks.forEach((chunk, w) => chunk.forEach((_, j) => { out[w + j * workers] = parts[w][j]; }));
  return out;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v == null || v.startsWith('--')) out[k] = true;
      else { out[k] = v; i++; }
    } else out._.push(a);
  }
  return out;
}
