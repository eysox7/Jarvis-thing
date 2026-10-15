// Kalabalık tahliye simülatörü — Helbing'in "social force" modelinin sade bir uygulaması.
//
// Tasarım ilkeleri:
//  - Bağımlılık yok, hem tarayıcıda hem Node'da çalışır (ES modülü).
//  - Deterministik: aynı tohum (seed) aynı sonucu verir. MCTS ve testler buna dayanır.
//  - Durum düz nesnelerden oluşur; clone() ile ucuzca kopyalanır (MCTS ileri sarma için).
//
// Birimler: metre, saniye, metre/saniye.

// ── Tohumlu rastgele sayı üreteci (mulberry32) ──────────────────────────────
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Model sabitleri (Helbing, Farkas & Vicsek 2000 değerlerine yakın).
export const PARAMS = {
  dt: 0.05,          // zaman adımı (s)
  tau: 0.5,          // hızlanma gevşeme süresi (s)
  A: 2000,           // sosyal itme şiddeti (N)
  B: 0.08,           // sosyal itme menzili (m)
  k: 1.2e5,          // gövde sıkışma katsayısı (kg/s²)
  kappa: 2.4e5,      // kayma sürtünmesi katsayısı (kg/(m·s))
  mass: 80,          // kg
  maxSpeed: 3.0,     // m/s, fiziksel üst sınır
  interactRange: 2.0,// bu mesafenin ötesindeki komşular yok sayılır (m)
  cell: 1.0,         // yoğunluk ızgarası hücre boyu (m)
  dangerDensity: 5,  // kişi/m²; bunun üstü ezilme riski sayılır
};

// ── Dünya kurulumu ──────────────────────────────────────────────────────────
// Dikdörtgen oda; çıkışlar duvarlardaki boşluklardır.
// exit: { id, side: 'left'|'right'|'top'|'bottom', center, width, open }
export function createWorld({ width = 30, height = 20, exits, agents = [], seed = 1 } = {}) {
  const world = {
    t: 0,
    width,
    height,
    exits: (exits || defaultExits(width, height)).map((e, i) => ({ id: i, open: true, ...e })),
    agents: [],
    evacuated: [],     // { id, t, exit }
    nextId: 0,
    seed,
    rngState: seed >>> 0,
    stats: { maxDensity: 0, dangerTime: 0, steps: 0 },
  };
  for (const a of agents) addAgent(world, a);
  return world;
}

export function defaultExits(width, height) {
  return [
    { side: 'left', center: height / 2, width: 1.2 },
    { side: 'right', center: height / 2, width: 1.2 },
  ];
}

export function addAgent(world, { x, y, vx = 0, vy = 0, radius = 0.25, speed = 1.34, target = null, persona = null } = {}) {
  const agent = {
    id: world.nextId++,
    x, y, vx, vy,
    radius,
    speed,           // istenen hız v0 (m/s)
    target,          // hedef çıkış id'si; null ise en yakın açık çıkış
    persona,         // persona adı (adım 2'de doldurulur)
  };
  world.agents.push(agent);
  return agent;
}

// Odaya rastgele, birbirine girmeyen ajanlar yerleştirir.
export function populate(world, n, { margin = 1, region = null, make = () => ({}) } = {}) {
  const rand = worldRand(world);
  const r = region || { x0: margin, y0: margin, x1: world.width - margin, y1: world.height - margin };
  let tries = 0;
  while (n > 0 && tries < n * 200) {
    tries++;
    const x = r.x0 + rand() * (r.x1 - r.x0);
    const y = r.y0 + rand() * (r.y1 - r.y0);
    if (world.agents.some((a) => (a.x - x) ** 2 + (a.y - y) ** 2 < 0.55 ** 2)) continue;
    addAgent(world, { x, y, ...make(rand) });
    n--;
  }
  return world;
}

// Dünya içindeki rastgelelik de klonla birlikte kopyalanmalı; bu yüzden durum dünyada tutulur.
function worldRand(world) {
  return () => {
    world.rngState = (world.rngState + 0x6d2b79f5) >>> 0;
    let t = world.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export { worldRand };

export function clone(world) {
  return {
    ...world,
    exits: world.exits.map((e) => ({ ...e })),
    agents: world.agents.map((a) => ({ ...a })),
    evacuated: world.evacuated.slice(),
    stats: { ...world.stats },
  };
}

// ── Geometri ────────────────────────────────────────────────────────────────
// Çıkışın iki uç noktası ve odanın dışındaki "hedef" noktası.
export function exitGeometry(world, exit) {
  const h = exit.width / 2;
  switch (exit.side) {
    case 'left':   return { a: [0, exit.center - h], b: [0, exit.center + h], mid: [0, exit.center], out: [-1, 0] };
    case 'right':  return { a: [world.width, exit.center - h], b: [world.width, exit.center + h], mid: [world.width, exit.center], out: [1, 0] };
    case 'top':    return { a: [exit.center - h, 0], b: [exit.center + h, 0], mid: [exit.center, 0], out: [0, -1] };
    case 'bottom': return { a: [exit.center - h, world.height], b: [exit.center + h, world.height], mid: [exit.center, world.height], out: [0, 1] };
    default: throw new Error('bilinmeyen çıkış kenarı: ' + exit.side);
  }
}

// Bir noktanın, kapalı çıkışlar dahil duvarın hangi kısmına en yakın olduğunu bulur.
// Dört kenar için: açık bir çıkışın aralığındaysa o kenar duvar sayılmaz.
function wallPoints(world, x, y) {
  const pts = [];
  const sides = [
    { side: 'left', px: 0, py: y, along: y },
    { side: 'right', px: world.width, py: y, along: y },
    { side: 'top', px: x, py: 0, along: x },
    { side: 'bottom', px: x, py: world.height, along: x },
  ];
  for (const s of sides) {
    const gap = world.exits.find((e) => e.open && e.side === s.side && Math.abs(s.along - e.center) < e.width / 2);
    if (gap) {
      // Boşluğun içindeyiz; kapı pervazları (uç noktalar) yine de iter.
      const g = exitGeometry(world, gap);
      pts.push(g.a, g.b);
    } else {
      pts.push([s.px, s.py]);
    }
  }
  return pts;
}

// ── Hedef seçimi ────────────────────────────────────────────────────────────
export function chooseExit(world, agent) {
  if (agent.target != null) {
    const e = world.exits[agent.target];
    if (e && e.open) return e;
  }
  let best = null, bestD = Infinity;
  for (const e of world.exits) {
    if (!e.open) continue;
    const { mid } = exitGeometry(world, e);
    const d = Math.hypot(agent.x - mid[0], agent.y - mid[1]);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// Ajanın gitmek istediği nokta: çıkışın ağzı, ama kapı genişliği içinde
// ajana en yakın noktaya yönelir (herkes tam ortaya yığılmasın diye).
function waypoint(world, agent, exit) {
  const g = exitGeometry(world, exit);
  const inset = Math.max(0, exit.width / 2 - agent.radius);
  if (exit.side === 'left' || exit.side === 'right') {
    const y = clamp(agent.y, exit.center - inset, exit.center + inset);
    return [g.mid[0] + g.out[0] * 1.0, y];
  }
  const x = clamp(agent.x, exit.center - inset, exit.center + inset);
  return [x, g.mid[1] + g.out[1] * 1.0];
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── Tek adım ────────────────────────────────────────────────────────────────
export function step(world, P = PARAMS) {
  const { dt } = P;
  const agents = world.agents;
  const n = agents.length;
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);

  // Komşu araması için kaba ızgara.
  const grid = new Map();
  const key = (cx, cy) => cx * 100003 + cy;
  for (let i = 0; i < n; i++) {
    const a = agents[i];
    const k = key(Math.floor(a.x / P.interactRange), Math.floor(a.y / P.interactRange));
    let bucket = grid.get(k);
    if (!bucket) grid.set(k, (bucket = []));
    bucket.push(i);
  }

  for (let i = 0; i < n; i++) {
    const a = agents[i];
    const exit = chooseExit(world, a);

    // 1) Sürüş kuvveti: istenen hıza doğru hızlan.
    if (exit) {
      const [tx, ty] = waypoint(world, a, exit);
      const dx = tx - a.x, dy = ty - a.y;
      const d = Math.hypot(dx, dy) || 1e-9;
      const v0 = a.speed;
      fx[i] += P.mass * ((v0 * dx) / d - a.vx) / P.tau;
      fy[i] += P.mass * ((v0 * dy) / d - a.vy) / P.tau;
    } else {
      // Açık çıkış yok: yavaşla ve bekle.
      fx[i] += (P.mass * -a.vx) / P.tau;
      fy[i] += (P.mass * -a.vy) / P.tau;
    }

    // 2) Ajan-ajan etkileşimi.
    const cx = Math.floor(a.x / P.interactRange), cy = Math.floor(a.y / P.interactRange);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const bucket = grid.get(key(cx + ox, cy + oy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;          // her çifti bir kez hesapla
          const b = agents[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d = Math.hypot(dx, dy) || 1e-9;
          if (d > P.interactRange) continue;
          const nx = dx / d, ny = dy / d;
          const rij = a.radius + b.radius;
          const overlap = rij - d;
          let f = P.A * Math.exp(overlap / P.B);
          let tfx = 0, tfy = 0;
          if (overlap > 0) {
            f += P.k * overlap;
            // Kayma sürtünmesi (teğet yönde).
            const tx = -ny, ty = nx;
            const dvt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
            tfx = P.kappa * overlap * dvt * tx;
            tfy = P.kappa * overlap * dvt * ty;
          }
          fx[i] += f * nx + tfx; fy[i] += f * ny + tfy;
          fx[j] -= f * nx + tfx; fy[j] -= f * ny + tfy;
        }
      }
    }

    // 3) Duvar etkileşimi.
    for (const [wx, wy] of wallPoints(world, a.x, a.y)) {
      const dx = a.x - wx, dy = a.y - wy;
      const d = Math.hypot(dx, dy) || 1e-9;
      if (d > 1.0) continue;
      const nx = dx / d, ny = dy / d;
      const overlap = a.radius - d;
      let f = P.A * Math.exp(overlap / P.B);
      if (overlap > 0) f += P.k * overlap;
      fx[i] += f * nx; fy[i] += f * ny;
    }
  }

  // Entegrasyon (yarı-örtük Euler) ve hız sınırı.
  for (let i = 0; i < n; i++) {
    const a = agents[i];
    a.vx += (fx[i] / P.mass) * dt;
    a.vy += (fy[i] / P.mass) * dt;
    const s = Math.hypot(a.vx, a.vy);
    if (s > P.maxSpeed) { a.vx *= P.maxSpeed / s; a.vy *= P.maxSpeed / s; }
    a.x += a.vx * dt;
    a.y += a.vy * dt;
  }

  world.t += dt;

  // Odadan çıkanları tahliye edilmiş say; açık bir kapının dışında değilse içeri geri it.
  const stay = [];
  for (const a of agents) {
    const outside = a.x < 0 || a.x > world.width || a.y < 0 || a.y > world.height;
    if (!outside) { stay.push(a); continue; }
    const via = world.exits.find((e) => e.open && passedThrough(world, a, e));
    if (via) {
      world.evacuated.push({ id: a.id, t: world.t, exit: via.id, persona: a.persona });
    } else {
      a.x = clamp(a.x, a.radius, world.width - a.radius);
      a.y = clamp(a.y, a.radius, world.height - a.radius);
      a.vx = 0; a.vy = 0;
      stay.push(a);
    }
  }
  world.agents = stay;

  // Yoğunluk istatistikleri.
  const dens = maxDensity(world, P);
  world.stats.maxDensity = Math.max(world.stats.maxDensity, dens);
  if (dens >= P.dangerDensity) world.stats.dangerTime += dt;
  world.stats.steps++;
  return world;
}

function passedThrough(world, a, e) {
  const tol = e.width / 2 + a.radius;
  switch (e.side) {
    case 'left': return a.x < 0 && Math.abs(a.y - e.center) < tol;
    case 'right': return a.x > world.width && Math.abs(a.y - e.center) < tol;
    case 'top': return a.y < 0 && Math.abs(a.x - e.center) < tol;
    case 'bottom': return a.y > world.height && Math.abs(a.x - e.center) < tol;
  }
  return false;
}

// ── Ölçümler ────────────────────────────────────────────────────────────────
// Hücre başına kişi sayısı / hücre alanı. En kalabalık hücrenin yoğunluğunu döndürür.
export function densityGrid(world, P = PARAMS) {
  const cols = Math.ceil(world.width / P.cell), rows = Math.ceil(world.height / P.cell);
  const g = new Float64Array(cols * rows);
  for (const a of world.agents) {
    const cx = clamp(Math.floor(a.x / P.cell), 0, cols - 1);
    const cy = clamp(Math.floor(a.y / P.cell), 0, rows - 1);
    g[cy * cols + cx] += 1 / (P.cell * P.cell);
  }
  return { cols, rows, g };
}

export function maxDensity(world, P = PARAMS) {
  const { g } = densityGrid(world, P);
  let m = 0;
  for (const v of g) if (v > m) m = v;
  return m;
}

// Simülasyonu bitene (herkes çıkana) ya da süre dolana kadar koşturur.
export function run(world, { maxTime = 300, onStep = null, P = PARAMS } = {}) {
  while (world.agents.length > 0 && world.t < maxTime) {
    step(world, P);
    if (onStep) onStep(world);
  }
  return summary(world);
}

export function summary(world) {
  const times = world.evacuated.map((e) => e.t);
  const perExit = {};
  for (const e of world.evacuated) perExit[e.exit] = (perExit[e.exit] || 0) + 1;
  return {
    t: round(world.t),
    evacuated: world.evacuated.length,
    remaining: world.agents.length,
    lastExit: times.length ? round(Math.max(...times)) : null,
    meanExit: times.length ? round(times.reduce((s, v) => s + v, 0) / times.length) : null,
    maxDensity: round(world.stats.maxDensity),
    dangerTime: round(world.stats.dangerTime),
    perExit,
  };
}

const round = (v) => Math.round(v * 100) / 100;
