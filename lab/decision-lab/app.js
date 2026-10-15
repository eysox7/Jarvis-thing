// Karar Laboratuvarı — arayüz.
import { TEMPLATES, cloneScenario, initialConfig, validateScenario } from './scenarios.js';
import { syntheticPopulation, importFiles, dimensionsOf, TRAITS, TRAIT_RULES } from './population.js';
import * as M from './model.js';
import * as L from './llm.js';
import * as X from './matraix.js';
import * as ED from './editor.js';
import { rng } from '../core/rng.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => `${Math.round(v * 100)}%`;
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : '–');
const sig = (x) => 1 / (1 + Math.exp(-x));

// ── Durum (bu tarayıcıda saklanır) ──────────────────────────────────────────
const LS = 'decisionlab.v1';
let S = load() || {
  scenario: cloneScenario(TEMPLATES[0]),
  personas: syntheticPopulation(300),
  popSource: 'synthetic',
  segDim: 'age_bracket',
  calib: {},              // "senaryoId|segmentBoyutu" → { segmentAdı: düzeltme }
  fcConfig: null,
  az: null,               // son AlphaZero sonucu
  bestStatic: null,
  llmRows: [],
};
function load() { try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; } }
function save() { try { localStorage.setItem(LS, JSON.stringify(S)); } catch { /* kota dolu: yalnızca bellekte */ } }

const calibKey = () => `${S.scenario.id}|${S.segDim}`;
// Eski sürümler diziyle saklıyordu (segment sırasına bağlı, güvensiz); onları yok say.
const calibration = () => { const c = S.calib[calibKey()]; return { byLabel: c && !Array.isArray(c) ? c : {} }; };
let _ctx = null;
function ctx() {
  if (!_ctx) _ctx = M.createContext(S.scenario, S.personas, { segmentDim: S.segDim, calibration: calibration() });
  return _ctx;
}
function invalidate({ keepAz = false, keepAnswers = false } = {}) {
  _ctx = null;
  if (!keepAz) { S.az = null; S.bestStatic = null; }
  if (!keepAnswers) S.llmRows = [];
  save();
}

// ── Sekmeler ────────────────────────────────────────────────────────────────
const RENDER = {};
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  for (const x of $('tabs').children) x.classList.toggle('on', x === b);
  for (const s of document.querySelectorAll('main > section')) s.classList.toggle('on', s.id === b.dataset.tab);
  RENDER[b.dataset.tab]?.();
  try { sessionStorage.setItem('decisionlab.tab', b.dataset.tab); } catch {}
});
function header() {
  $('hdrScn').textContent = `${S.scenario.domain === 'policy' ? 'Kamu politikası' : 'Pazarlama'} · ${S.scenario.title} · ${S.personas.length} persona`;
  document.querySelectorAll('.unit').forEach((n) => (n.textContent = S.scenario.unit || 'adım'));
}

// ── Ortak çizimler ──────────────────────────────────────────────────────────
function bars(el, labels, values, marks = null) {
  el.innerHTML = labels.map((l, k) => `
    <div class="bar"><span title="${esc(l)}">${esc(l)}</span>
      <div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, values[k] * 100))}%"></div>
      ${marks ? `<div class="mark" style="left:${Math.max(0, Math.min(100, marks[k] * 100))}%"></div>` : ''}</div>
      <span class="val">${pct(values[k])}</span></div>`).join('');
}

function spark(el, seriesList, { min = 0, max = 1 } = {}) {
  const W = 600, H = 120, P = 6;
  const colors = ['var(--accent)', 'var(--warn)', 'var(--ok)'];
  const all = seriesList.flatMap((s) => s.data);
  if (!all.length) { el.innerHTML = ''; return; }
  const lo = Math.min(min, ...all), hi = Math.max(max, ...all);
  const len = Math.max(...seriesList.map((s) => s.data.length));
  const x = (i) => P + (i / Math.max(1, len - 1)) * (W - 2 * P);
  const y = (v) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  el.innerHTML = seriesList.map((s, k) => `<polyline fill="none" stroke="${colors[k % 3]}" stroke-width="2.5" vector-effect="non-scaling-stroke" points="${s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>`).join('')
    + seriesList.map((s, k) => `<text x="${W - P}" y="${14 + k * 14}" text-anchor="end" font-size="12" fill="${colors[k % 3]}">${esc(s.label)}</text>`).join('');
}

function kpis(el, items) {
  el.innerHTML = items.map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${esc(l)}</span></div>`).join('');
}

const PART_LABELS = {
  impact: 'Etkinlik (dönem ort.)', support: 'Destek', minSegment: 'En düşük segment', polarization: 'Kutuplaşma (−)',
  revenue: 'Gelir', adoption: 'Benimseme', satisfaction: 'Memnuniyet', churn: 'Bırakma (−)', overspend: 'Bütçe aşımı (−)',
};
const metricName = () => (S.scenario.domain === 'policy' ? 'Destek' : 'Benimseme');

function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── Senaryo ─────────────────────────────────────────────────────────────────
$('tplSel').innerHTML = TEMPLATES.map((t) => `<option value="${t.id}">${t.domain === 'policy' ? 'Politika' : 'Pazarlama'}: ${esc(t.title)}</option>`).join('');
$('traitList').textContent = Object.keys(TRAITS).join(', ');
$('tplLoad').onclick = () => {
  S.scenario = cloneScenario(TEMPLATES.find((t) => t.id === $('tplSel').value));
  S.fcConfig = null;
  invalidate();
  RENDER.scenario();
};
RENDER.scenario = () => {
  header();
  const scn = S.scenario;
  $('tplSel').value = TEMPLATES.some((t) => t.id === scn.id) ? scn.id : TEMPLATES[0].id;
  $('scnSummary').textContent = `${scn.summary} Ufuk: ${scn.horizon} ${scn.unit}. Bütçe: ${scn.budget} birim.`;
  ED.render($('scnEditor'), scn);
  $('scnObjective').innerHTML = Object.entries(scn.objective).map(([k, v]) => `
    <div><label class="f">${esc(PART_LABELS[k] || k)}: <b id="ov-${k}">${v.toFixed(2)}</b></label>
    <input type="range" min="0" max="1" step="0.05" value="${v}" data-k="${k}" style="width:100%"></div>`).join('');
  $('scnObjective').querySelectorAll('input[type=range]').forEach((r) => {
    r.oninput = () => { $(`ov-${r.dataset.k}`).textContent = Number(r.value).toFixed(2); };
    r.onchange = () => { S.scenario.objective[r.dataset.k] = Number(r.value); invalidate(); };
  });
  $('scnJson').value = JSON.stringify(scn, null, 2);
  $('scnErr').textContent = '';
};
ED.bind($('scnEditor'), () => S.scenario, (structural) => {
  S.fcConfig = null;
  invalidate();
  header();
  const errs = validateScenario(S.scenario);
  $('scnErr').textContent = errs.join(' · ');
  if (structural) RENDER.scenario();
  else { $('scnJson').value = JSON.stringify(S.scenario, null, 2); $('scnSummary').textContent = `${S.scenario.summary} Ufuk: ${S.scenario.horizon} ${S.scenario.unit}. Bütçe: ${S.scenario.budget} birim.`; }
});
for (const [id, domain] of [['newPolicy', 'policy'], ['newMarketing', 'marketing']]) {
  $(id).onclick = () => { S.scenario = ED.blankScenario(domain); S.fcConfig = null; invalidate(); RENDER.scenario(); };
}
$('scnApply').onclick = () => {
  try {
    const s = JSON.parse($('scnJson').value);
    const errs = validateScenario(s);
    if (errs.length) { $('scnErr').textContent = errs.join(' · '); return; }
    s.id = s.id || 'custom';
    S.scenario = s; S.fcConfig = null;
    invalidate();
    RENDER.scenario();
  } catch (e) { $('scnErr').textContent = 'JSON hatası: ' + e.message; }
};
$('scnDownload').onclick = () => download(`${S.scenario.id}.json`, JSON.stringify(S.scenario, null, 2), 'application/json');

// ── Nüfus ───────────────────────────────────────────────────────────────────
$('popSynth').onclick = () => {
  S.personas = syntheticPopulation(300); S.popSource = 'synthetic';
  if (!S.personas.some((p) => p.dims[S.segDim])) S.segDim = 'age_bracket';
  invalidate(); RENDER.population();
};
$('popFiles').onchange = async (e) => {
  const files = await Promise.all([...e.target.files].map(async (f) => ({ name: f.name, text: await f.text() })));
  const { personas, errors } = importFiles(files);
  if (personas.length) {
    S.personas = personas; S.popSource = 'matraix';
    const dims = dimensionsOf(personas);
    if (!personas.some((p) => p.dims[S.segDim])) S.segDim = dims[0]?.dim || 'age_bracket';
    invalidate();
  }
  RENDER.population();
  $('popInfo').insertAdjacentHTML('beforeend', `<p class="small ${errors.length ? 'warn' : 'ok'}">${personas.length} persona içe aktarıldı.${errors.length ? ' Hatalar: ' + esc(errors.slice(0, 5).join(' · ')) : ''}</p>`);
  e.target.value = '';
};
$('segDim').onchange = () => { S.segDim = $('segDim').value; invalidate({ keepAz: false }); RENDER.population(); };

RENDER.population = () => {
  header();
  const src = S.popSource === 'synthetic'
    ? '<span class="warn">Sentetik örnek nüfus</span> — gerçek veri değil; sistemi denemek içindir.'
    : '<span class="ok">MatrAIx personaları</span>';
  $('popInfo').innerHTML = `<b>${S.personas.length}</b> persona · ${src}`;
  const dims = dimensionsOf(S.personas);
  $('segDim').innerHTML = dims.map((d) => `<option value="${esc(d.dim)}" ${d.dim === S.segDim ? 'selected' : ''}>${esc(d.dim)} (${d.n})</option>`).join('');

  const c = ctx();
  const K = c.seg.labels.length;
  const tk = Object.keys(TRAITS);
  const sums = Array.from({ length: K }, () => Object.fromEntries(tk.map((k) => [k, 0])));
  const counts = new Array(K).fill(0);
  S.personas.forEach((p, i) => { const k = c.seg.index[i]; counts[k]++; for (const t of tk) sums[k][t] += c.T[t][i]; });
  const cell = (v) => `<td class="num" style="color:${v > 0.15 ? 'var(--ok)' : v < -0.15 ? 'var(--err)' : 'inherit'}">${v.toFixed(2)}</td>`;
  const bias = c.segBias;
  $('segTable').innerHTML = `<tr><th>Segment</th><th class="num">Kişi</th>${tk.map((t) => `<th class="num" title="${esc(TRAITS[t])}">${esc(TRAITS[t].split(' ')[0])}</th>`).join('')}<th class="num">Kalibr.</th></tr>`
    + c.seg.labels.map((l, k) => `<tr><td>${esc(l)}</td><td class="num">${counts[k]}</td>${tk.map((t) => cell(counts[k] ? sums[k][t] / counts[k] : 0)).join('')}<td class="num">${bias[k] ? bias[k].toFixed(2) : '–'}</td></tr>`).join('');
  $('ruleTable').innerHTML = '<tr><th>Boyut</th><th>Değer içerir</th><th>Etki</th></tr>'
    + TRAIT_RULES.map(([d, n, fx]) => `<tr><td class="mono">${esc(d)}</td><td class="mono">${esc(n)}</td><td class="small">${Object.entries(fx).map(([k, v]) => `${esc(TRAITS[k])} ${v > 0 ? '+' : ''}${v}`).join(', ')}</td></tr>`).join('');
};

// ── Tahmin ──────────────────────────────────────────────────────────────────
RENDER.forecast = () => {
  header();
  const scn = S.scenario, c = ctx();
  const init = initialConfig(scn);
  if (!S.fcConfig || scn.levers.some((l) => !l.options.some((o) => o.id === S.fcConfig[l.id]))) S.fcConfig = { ...init };
  $('fcLevers').innerHTML = scn.levers.map((l) => `
    <div class="lever"><b>${esc(l.label)}</b><div class="opts">${l.options.map((o) => `<button class="chip ${S.fcConfig[l.id] === o.id ? 'on' : ''}" data-l="${l.id}" data-o="${o.id}">${esc(o.label)}</button>`).join('')}</div></div>`).join('')
    + '<div class="row"><button class="btn" id="fcReset">Başlangıç tasarımına dön</button></div>';
  $('fcLevers').querySelectorAll('button.chip').forEach((b) => { b.onclick = () => { S.fcConfig[b.dataset.l] = b.dataset.o; save(); RENDER.forecast(); }; });
  $('fcReset').onclick = () => { S.fcConfig = { ...init }; save(); RENDER.forecast(); };

  const r = M.forecast(c, S.fcConfig);
  const r0 = M.forecast(c, init);
  kpis($('fcKpis'), [
    [f3(r.total), `Hedef skoru (başlangıç ${f3(r0.total)})`],
    [pct(r.final), `${metricName()} — dönem sonu`],
    [pct(Math.min(...r.segs)), 'En düşük segment'],
    ...Object.entries(r.parts).filter(([k]) => k !== 'overspend' || r.parts.overspend > 0).map(([k, v]) => [v.toFixed(2), PART_LABELS[k] || k]),
  ]);
  bars($('fcBars'), c.seg.labels, r.segs, r0.segs);
  spark($('fcSpark'), [{ label: 'seçili', data: r.state.series }, { label: 'başlangıç', data: r0.state.series }]);

  // Neden: segment başına her kararın (seçili seçeneğin) ortalama fayda katkısı.
  const K = c.seg.labels.length;
  const rows = c.seg.labels.map((lab, k) => {
    const idx = []; c.seg.index.forEach((s, i) => { if (s === k) idx.push(i); });
    const cells = scn.levers.map((l) => {
      const arr = c.contrib[l.id][S.fcConfig[l.id]];
      const v = idx.reduce((a, i) => a + arr[i], 0) / Math.max(1, idx.length);
      return `<td class="num" style="color:${v > 0.1 ? 'var(--ok)' : v < -0.1 ? 'var(--err)' : 'inherit'}">${v > 0 ? '+' : ''}${v.toFixed(2)}</td>`;
    });
    return `<tr><td>${esc(lab)}</td>${cells.join('')}<td class="num">${pct(r.segs[k])}</td></tr>`;
  });
  $('fcWhy').innerHTML = `<tr><th>Segment</th>${scn.levers.map((l) => `<th class="num">${esc(l.label)}</th>`).join('')}<th class="num">${metricName()}</th></tr>` + rows.join('')
    + `<tr><td colspan="${scn.levers.length + 2}" class="small muted">Pozitif: o karar bu segmentte desteği/benimsemeyi artırıyor. ${K} segment, boyut: ${esc(S.segDim)}.</td></tr>`;
};

// ── Strateji ────────────────────────────────────────────────────────────────
let worker = null;
$('azStart').onclick = () => {
  if (worker) worker.terminate();
  const opts = { iters: +$('azIters').value, games: +$('azGames').value, sims: +$('azSims').value, seed: 1 };
  worker = new Worker(new URL('./az-worker.js', import.meta.url), { type: 'module' });
  S.az = { history: [], running: true }; save();
  $('azStart').disabled = true; $('azStop').disabled = false;
  $('azStatus').textContent = 'Kıyas için tüm statik tasarımlar deneniyor…';
  worker.onmessage = ({ data }) => {
    if (data.type === 'static') { S.bestStatic = data; $('azStatus').textContent = data.approx ? `${data.combos} kombinasyon kaba kuvvet için çok fazla; koordinat yükselişiyle iyi bir başlangıç tasarımı bulundu. Self-play başladı…` : `${data.combos} statik tasarım denendi. Self-play başladı…`; }
    else if (data.type === 'progress') {
      S.az = { ...S.az, ...data, history: [...S.az.history, { it: data.it, score: data.score, best: data.best, z: data.selfPlayZ, loss: data.loss, accepted: data.accepted }] };
      $('azStatus').textContent = `İterasyon ${data.it}/${opts.iters} — en iyi skor ${f3(data.best)} (çıkış noktası: en iyi statik tasarım, ${f3(data.base)}).`;
    } else if (data.type === 'done') { stop('Tamamlandı. Sağlamlık testi otomatik çalıştırıldı (aşağıda).'); $('rbRun').click(); }
    save();
    RENDER.strategy();
  };
  worker.onerror = (e) => stop('Hata: ' + e.message);
  worker.postMessage({ scenario: S.scenario, personas: S.personas, segmentDim: S.segDim, calibration: calibration(), opts });
  RENDER.strategy();
};
$('azStop').onclick = () => stop('Durduruldu. Şimdiye kadarki en iyi plan geçerli.');
function stop(msg) {
  worker?.terminate(); worker = null;
  if (S.az) S.az.running = false;
  $('azStart').disabled = false; $('azStop').disabled = true;
  $('azStatus').textContent = msg;
  save(); RENDER.strategy();
}
$('rbRun').onclick = () => {
  const c = ctx();
  const plans = { 'Başlangıç tasarımı': { moves: [0] } };
  if (S.bestStatic?.config) plans['En iyi statik tasarım'] = { moves: [0], start: S.bestStatic.config };
  if (S.az?.moves) plans['AlphaZero planı'] = { moves: S.az.moves, start: S.az.start };
  const res = M.robustness(S.scenario, S.personas, plans, {
    segmentDim: S.segDim, calibration: calibration(),
    worlds: Math.max(5, Math.min(300, +$('rbN').value)), magnitude: +$('rbMag').value, rng,
  });
  $('rbTable').innerHTML = '<tr><th>Plan</th><th class="num">Ortalama</th><th class="num">Kötü durum (%10)</th><th class="num">İyi durum (%90)</th><th class="num">En iyi olduğu dünyalar</th></tr>'
    + Object.entries(res).map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">${f3(v.mean)}</td><td class="num">${f3(v.p10)}</td><td class="num">${f3(v.p90)}</td><td class="num">${pct(v.winRate)}</td></tr>`).join('');
};
$('azToForecast').onclick = () => { if (S.az?.config) { S.fcConfig = { ...S.az.config }; save(); document.querySelector('nav button[data-tab=forecast]').click(); } };
$('azToValidate').onclick = () => { document.querySelector('nav button[data-tab=validate]').click(); $('vCfg').value = 'az'; };

RENDER.strategy = () => {
  header();
  const c = ctx(), az = S.az, st = S.bestStatic;
  const r0 = M.forecast(c, initialConfig(S.scenario));
  kpis($('azKpis'), [
    [f3(r0.total), 'Başlangıç tasarımı, eylemsiz'],
    [st ? f3(st.total) : '–', st?.approx ? 'İyi statik tasarım (yaklaşık)' : 'En iyi statik tasarım (kaba kuvvet)'],
    [az?.best != null ? f3(az.best) : '–', 'AlphaZero planı'],
    [az?.segs ? pct(Math.min(...az.segs)) : '–', 'AlphaZero: en düşük segment'],
  ]);
  if (az?.plan) {
    $('azPlan').innerHTML = az.plan.map((p) => `<li><span class="t">${p.phase === 'design' ? 'tasarım' : `${p.t + 1}. ${esc(S.scenario.unit)}`}</span><span>${esc(p.label)}</span></li>`).join('')
      + (az.parts ? `<li><span class="t">sonuç</span><span class="small">${Object.entries(az.parts).map(([k, v]) => `${esc(PART_LABELS[k] || k)} ${v.toFixed(2)}`).join(' · ')}</span></li>` : '');
    bars($('azBars'), c.seg.labels, az.segs, r0.segs);
  }
  if (az?.moves && !az.running) {
    const ex = M.explainPlan(c, az.moves, az.start);
    const cell = (v) => `<td class="num" style="color:${v > 0.03 ? 'var(--ok)' : v < -0.03 ? 'var(--err)' : 'inherit'}">${v > 0 ? '+' : ''}${Math.round(v * 100)}</td>`;
    $('azWhy').innerHTML = `<tr><th>Ne zaman</th><th>Adım</th><th class="num">Katkı</th>${c.seg.labels.map((l) => `<th class="num">${esc(l)}</th>`).join('')}</tr>`
      + ex.rows.sort((a, b) => b.delta - a.delta).map((x) => `<tr><td class="muted">${esc(x.when)}</td><td>${esc(x.label)}</td><td class="num"><b>${x.delta >= 0 ? '+' : ''}${x.delta.toFixed(3)}</b></td>${x.segDelta.map(cell).join('')}</tr>`).join('')
      + (ex.rows.length ? '' : '<tr><td class="muted">Plan, başlangıç tasarımını değiştirmiyor.</td></tr>');
  }
  $('azToForecast').disabled = !az?.config; $('azToValidate').disabled = !az?.config; $('rbRun').disabled = !az?.moves;
  if (az?.stale && !az.running) $('azStatus').innerHTML = '<span class="warn">Bu plan model kalibre edilmeden önce bulundu; yeniden çalıştır.</span>';
  const h = az?.history || [];
  spark($('azSpark'), [{ label: 'en iyi skor', data: h.map((x) => x.best) }, { label: 'arena', data: h.map((x) => x.score) }], { min: Math.min(r0.total, ...h.map((x) => x.score)), max: Math.max(r0.total, ...h.map((x) => x.best)) });
  $('azHist').innerHTML = h.length ? '<tr><th>#</th><th class="num">self-play z</th><th class="num">kayıp</th><th class="num">arena</th><th class="num">en iyi</th><th></th></tr>'
    + h.slice(-12).reverse().map((x) => `<tr><td>${x.it}</td><td class="num">${x.z.toFixed(2)}</td><td class="num">${x.loss.toFixed(3)}</td><td class="num">${f3(x.score)}</td><td class="num">${f3(x.best)}</td><td>${x.accepted ? '<span class="ok">✔</span>' : '<span class="muted">✖</span>'}</td></tr>`).join('') : '';
};

// ── Doğrulama ───────────────────────────────────────────────────────────────
function configChoices() {
  const out = [{ id: 'initial', label: 'Başlangıç tasarımı', config: initialConfig(S.scenario) }];
  if (S.fcConfig) out.push({ id: 'forecast', label: 'Tahmin sekmesindeki seçim', config: S.fcConfig });
  if (S.bestStatic?.config) out.push({ id: 'static', label: 'En iyi statik tasarım', config: S.bestStatic.config });
  if (S.az?.config) out.push({ id: 'az', label: 'AlphaZero planının tasarımı', config: S.az.config });
  return out;
}

// Modelin "tam bilgilenmiş" tahmini (LLM'e sorulan soruyla aynı koşul): σ(1.5·U)
function modelProb(c, config, i) {
  const s = M.initialState(c, config);
  return sig(1.5 * M.utility(c, s, i));
}

let askAbort = null;
$('vAsk').onclick = async () => {
  if (askAbort) { askAbort.abort(); return; }
  const c = ctx();
  const choice = configChoices().find((x) => x.id === $('vCfg').value);
  const idx = L.samplePersonas(S.personas, c.seg, Math.max(1, +$('vPer').value));
  askAbort = new AbortController();
  $('vAsk').textContent = 'Durdur';
  S.llmRows = [];
  let done = 0, failed = 0;
  const queue = idx.slice();
  const workerFn = async () => {
    while (queue.length && !askAbort.signal.aborted) {
      const i = queue.shift();
      const p = S.personas[i];
      try {
        const ans = await L.askPersona(p, S.scenario, choice.config, { signal: askAbort.signal });
        S.llmRows.push({ i, seg: c.seg.index[i], name: p.name, score: ans.score, reason: ans.reason, llm: L.LIKERT_P[ans.score], model: modelProb(c, choice.config, i), cfg: choice.id });
      } catch (e) {
        if (e.name === 'AbortError') break;
        failed++;
        $('vStatus').innerHTML = `<span class="err">${esc(e.message)}</span>`;
        if (/bağlantı yok|API/.test(e.message) && !S.llmRows.length) { queue.length = 0; break; }
      }
      done++;
      $('vStatus').textContent = `${done}/${idx.length} persona soruldu${failed ? `, ${failed} hata` : ''}…`;
      renderLlm();
    }
  };
  await Promise.all([workerFn(), workerFn(), workerFn()]);
  askAbort = null;
  $('vAsk').textContent = 'Sor';
  if (S.llmRows.length) $('vStatus').textContent = `${S.llmRows.length} cevap alındı (${choice.label}).`;
  save(); renderLlm();
};

function renderLlm() {
  const c = ctx();
  const rows = S.llmRows || [];
  $('vCalib').disabled = !rows.length;
  if (!rows.length) { $('vTable').innerHTML = ''; $('vAnswers').innerHTML = ''; return; }
  $('vTable').innerHTML = '<tr><th>Segment</th><th class="num">n</th><th class="num">LLM</th><th class="num">Model</th><th class="num">Fark</th></tr>'
    + c.seg.labels.map((l, k) => {
      const r = rows.filter((x) => x.seg === k);
      if (!r.length) return '';
      const a = r.reduce((s, x) => s + x.llm, 0) / r.length, m = r.reduce((s, x) => s + x.model, 0) / r.length;
      const g = a - m;
      return `<tr><td>${esc(l)}</td><td class="num">${r.length}</td><td class="num">${pct(a)}</td><td class="num">${pct(m)}</td><td class="num ${Math.abs(g) > 0.2 ? 'warn' : ''}">${g > 0 ? '+' : ''}${Math.round(g * 100)}</td></tr>`;
    }).join('');
  $('vAnswers').innerHTML = rows.map((x) => `<div class="answer"><div class="who">${esc(x.name)} · ${esc(c.seg.labels[x.seg])} · puan ${x.score}/5 · model ${pct(x.model)}</div>${esc(x.reason)}</div>`).join('');
}

$('vCalib').onclick = () => {
  const c = ctx();
  const fitted = L.fitSegBias(S.llmRows, c.seg.labels.length, Array.from(c.segBias));
  S.calib[calibKey()] = Object.fromEntries(c.seg.labels.map((l, k) => [l, fitted[k]]));
  invalidate({ keepAz: true, keepAnswers: true });
  if (S.az) S.az.stale = true;
  // Tablodaki "model" sütunu artık kalibre edilmiş modeli göstersin.
  const nc = ctx();
  const cfgOf = Object.fromEntries(configChoices().map((x) => [x.id, x.config]));
  for (const r of S.llmRows) if (cfgOf[r.cfg]) r.model = modelProb(nc, cfgOf[r.cfg], r.i);
  save();
  $('vStatus').textContent = 'Model kalibre edildi; tablodaki "Model" sütunu güncellendi. Strateji sekmesinde AlphaZero\'yu yeniden çalıştırman önerilir.';
  renderLlm();
};
$('vReset').onclick = () => {
  delete S.calib[calibKey()];
  invalidate({ keepAz: true, keepAnswers: true });
  if (S.az) S.az.stale = true;
  $('vStatus').textContent = 'Kalibrasyon sıfırlandı.';
  save();
};

$('mxExport').onclick = () => {
  const task = X.buildTask(S.scenario, configChoices());
  download(`${task.name}.sh`, X.taskScript(task));
  $('mxStatus').textContent = `${task.name}.sh indirildi. MatrAIx deposunun kökünde "bash ${task.name}.sh" ile görevi oluştur.`;
};
$('mxResults').onchange = async (e) => {
  const files = await Promise.all([...e.target.files]
    .filter((f) => /\.(json|ya?ml|toml|txt)$/i.test(f.name) && f.size < 2e6)
    .map(async (f) => ({ path: f.webkitRelativePath || f.name, text: await f.text() })));
  const results = X.readResults(files);
  const c = ctx();
  const choices = configChoices();
  const byId = new Map(S.personas.map((p, i) => [p.id, i]));
  let matched = 0;
  const rows = [];
  const table = choices.map((ch, k) => {
    const vals = results.map((r) => X.likertP(r.answers[`c${k}`])).filter((v) => v != null);
    let mp = 0;
    for (let i = 0; i < c.n; i++) mp += modelProb(c, ch.config, i);
    return { ch, n: vals.length, mx: vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length), model: mp / c.n };
  });
  for (const r of results) {
    const i = byId.get(r.personaId);
    if (i == null) continue;
    matched++;
    choices.forEach((ch, k) => { const v = X.likertP(r.answers[`c${k}`]); if (v != null) rows.push({ i, seg: c.seg.index[i], llm: v, model: modelProb(c, ch.config, i), name: S.personas[i].name, score: r.answers[`c${k}`], reason: `(MatrAIx) ${ch.label}`, cfg: ch.id }); });
  }
  $('mxTable').innerHTML = '<tr><th>Tasarım</th><th class="num">n</th><th class="num">MatrAIx</th><th class="num">Model (nüfus)</th></tr>'
    + table.map((t) => `<tr><td>${esc(t.ch.label)}</td><td class="num">${t.n}</td><td class="num">${t.n ? pct(t.mx) : '–'}</td><td class="num">${pct(t.model)}</td></tr>`).join('');
  $('mxStatus').textContent = `${results.length} anket sonucu okundu; ${matched} tanesi içe aktarılmış personalarla eşleşti.`
    + (matched ? ' Eşleşenler LLM tablosuna eklendi; "Modeli kalibre et" ile kullanabilirsin.' : ' Segment kalibrasyonu için aynı personaları Nüfus sekmesinden içe aktar.');
  if (rows.length) { S.llmRows = rows; save(); renderLlm(); }
  e.target.value = '';
};

RENDER.validate = () => {
  header();
  const conns = L.connections();
  $('llmConn').innerHTML = conns.length
    ? `<span class="ok">Bağlantı:</span> ${conns.map((p) => esc(`${p.name || p.provider} (${p.model})`)).join(' → ')}`
    : '<span class="warn">Kayıtlı API bağlantısı yok.</span> <a href="../../index.html">N.E.X.U.S.</a> → API sekmesinden bir bağlantı ekle (ör. ücretsiz Gemini veya Groq).';
  const choices = configChoices();
  const prev = $('vCfg').value;
  $('vCfg').innerHTML = choices.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('');
  if (choices.some((c) => c.id === prev)) $('vCfg').value = prev;
  renderLlm();
};

// ── Başlat ──────────────────────────────────────────────────────────────────
// Rehber ilk ziyarette açık gelir; sonra kullanıcının bıraktığı gibi kalır.
try {
  const g = $('guide');
  g.open = localStorage.getItem('decisionlab.guide') !== 'closed';
  g.addEventListener('toggle', () => { try { localStorage.setItem('decisionlab.guide', g.open ? 'open' : 'closed'); } catch {} });
} catch {}
if (S.az?.running) S.az.running = false;   // sayfa yenilendiyse eğitim durmuştur
const startTab = (() => { try { return sessionStorage.getItem('decisionlab.tab'); } catch { return null; } })();
RENDER.scenario();
if (startTab && startTab !== 'scenario') document.querySelector(`nav button[data-tab=${startTab}]`)?.click();
