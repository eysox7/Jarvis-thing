// Tahliyeyi AlphaZero'nun oynayabileceği bir "oyuna" çevirir.
//
// Tek oyunculu, deterministik bir oyun: hamle = her DECISION saniyede bir müdahale
// (hiçbir şey yapma / bir çıkışı anonsla göster / bir çıkışı aç-kapa).
// Simülasyon ilerledikçe kalabalık tepki verir; oyun herkes çıkınca ya da süre dolunca biter.
// Sonuç (z) "hiçbir şey yapmamaya göre ne kadar iyi?" sorusunun [-1, 1] aralığındaki cevabıdır.

import * as S from './sim.js';
import { poolFromPersonas, sampler } from './personas.js';

export const DECISION = 5;      // iki karar arası saniye
export const MAX_TIME = 180;    // bu süre sonunda kalanlar ağır cezalı
export const KINDS = ['calm', 'urgent', 'reasoned'];

// Konser salonu: herkes sol ana kapıdan girdi (alışkanlık), sahne sağda.
// Alışkanlık tek başına bırakılırsa ana kapıda yığılma olur; diğer çıkışlar boş kalır.
export function hallExits() {
  return [
    { side: 'left', center: 10, width: 1.6, name: 'Ana giriş' },
    { side: 'right', center: 5, width: 1.2, name: 'Sahne yanı' },
    { side: 'bottom', center: 20, width: 1.2, name: 'Acil çıkış (güney)' },
    { side: 'top', center: 12, width: 1.0, name: 'Acil çıkış (kuzey)' },
  ];
}

// Eylem listesi sabittir; sinir ağının policy başı bu sırayla çıktı verir.
export const ACTIONS = (() => {
  const list = [{ type: 'noop' }];
  const nExits = hallExits().length;
  for (let e = 0; e < nExits; e++) for (const kind of KINDS) list.push({ type: 'announce', exit: e, kind });
  for (let e = 0; e < nExits; e++) list.push({ type: 'toggle', exit: e });
  return list;
})();

export function describe(a) {
  const exits = hallExits();
  if (a.type === 'noop') return 'bekle';
  if (a.type === 'announce') return `anons (${a.kind}) → ${exits[a.exit].name}`;
  return `aç/kapa → ${exits[a.exit].name}`;
}

// ── Senaryo ─────────────────────────────────────────────────────────────────
export function initialState(seed, { pool = poolFromPersonas(), nAgents = 200 } = {}) {
  const world = S.createWorld({ width: 30, height: 20, exits: hallExits(), seed, homeExit: 0 });
  // Kalabalık sahnenin önünde (sağ yarı) yoğun, salonun geri kalanında seyrek.
  const make = sampler(pool);
  S.populate(world, Math.round(nAgents * 0.75), { region: { x0: 15, y0: 2, x1: 28, y1: 18 }, make });
  S.populate(world, nAgents - Math.round(nAgents * 0.75), { region: { x0: 3, y0: 2, x1: 15, y1: 18 }, make });
  return { world, moves: [], n0: world.agents.length };
}

export function clone(state) {
  return { world: S.clone(state.world), moves: state.moves.slice(), n0: state.n0 };
}

export function isTerminal(state) {
  return state.world.agents.length === 0 || state.world.t >= MAX_TIME;
}

export function legalMask(state) {
  const w = state.world;
  const openCount = w.exits.filter((e) => e.open).length;
  return ACTIONS.map((a) => {
    if (a.type === 'noop') return true;
    const e = w.exits[a.exit];
    // "Ana giriş tıkalı, X'i kullanın" gerekçesi ana girişin kendisi için anlamsızdır.
    if (a.type === 'announce') return e.open && !(a.kind === 'reasoned' && a.exit === w.homeExit);
    // Kapatma: en az bir çıkış açık kalmalı.
    return !e.open || openCount > 1;
  });
}

// Eylemi uygular ve DECISION saniye ilerletir. Durumu yerinde değiştirir.
export function apply(state, actionIndex) {
  const a = ACTIONS[actionIndex];
  const w = state.world;
  if (a.type === 'announce') S.announce(w, a.exit, a.kind);
  else if (a.type === 'toggle') S.setExit(w, a.exit, !w.exits[a.exit].open);
  state.moves.push(actionIndex);
  const until = Math.min(w.t + DECISION, MAX_TIME);
  while (w.agents.length > 0 && w.t < until - 1e-9) S.step(w);
  return state;
}

// ── Maliyet ve sonuç ────────────────────────────────────────────────────────
// Düşük maliyet iyi. Ortalama çıkış süresi + son kişinin çıkışı + tehlikeli yoğunlukta
// geçen süre (ağır) + içeride kalanlar (çok ağır) + gereksiz müdahale (hafif).
export function cost(state) {
  const w = state.world;
  const times = w.evacuated.map((e) => e.t);
  const remaining = w.agents.length;
  const meanExit = (times.reduce((s, v) => s + v, 0) + remaining * MAX_TIME * 1.5) / Math.max(1, state.n0);
  const lastExit = remaining ? MAX_TIME * 1.5 : Math.max(0, ...times);
  const interventions = state.moves.filter((m) => ACTIONS[m].type !== 'noop').length;
  return meanExit + 0.5 * lastExit + 10 * w.stats.dangerTime + 1.5 * interventions;
}

// Hiç müdahale etmeden oynanan oyunun maliyeti: kıyas noktası.
export function baselineCost(state) {
  const s = clone(state);
  while (!isTerminal(s)) apply(s, 0);
  return cost(s);
}

export function outcome(state, base) {
  return Math.tanh((base - cost(state)) / (0.35 * base));
}

// ── Durum kodlama (sinir ağı girdisi) ───────────────────────────────────────
export const GRID_W = 15, GRID_H = 10;
export const INPUT_SIZE = GRID_W * GRID_H + hallExits().length * 5 + 3;

export function encode(state) {
  const w = state.world;
  const x = new Float32Array(INPUT_SIZE);
  const cw = w.width / GRID_W, ch = w.height / GRID_H;
  for (const a of w.agents) {
    const cx = Math.min(GRID_W - 1, Math.floor(a.x / cw));
    const cy = Math.min(GRID_H - 1, Math.floor(a.y / ch));
    x[cy * GRID_W + cx] += 1 / (cw * ch * 4);   // ~4 kişi/m² → 1.0
  }
  let o = GRID_W * GRID_H;
  const n = Math.max(1, w.agents.length);
  for (const e of w.exits) {
    const { mid } = S.exitGeometry(w, e);
    let near = 0, heading = 0;
    for (const a of w.agents) {
      if ((a.x - mid[0]) ** 2 + (a.y - mid[1]) ** 2 < 16) near++;
      if (a.cur === e.id) heading++;
    }
    const lastAnn = [...w.announcements].reverse().find((r) => r.exit === e.id);
    x[o++] = e.open ? 1 : 0;
    x[o++] = near / 20;
    x[o++] = heading / n;
    x[o++] = lastAnn ? Math.exp(-(w.t - lastAnn.t) / 20) : 0;
    x[o++] = w.evacuated.filter((r) => r.exit === e.id).length / state.n0;
  }
  x[o++] = w.agents.length / state.n0;
  x[o++] = w.t / MAX_TIME;
  x[o++] = w.agents.filter((a) => w.t >= a.delay).length / n;
  return x;
}
