// Plan testi sekmesi: kullanıcı kendi stratejisini yazar, sistem test eder.
//
// Plan = { id, name, scenarioId, start: { kol: seçenek }, steps: [eylem indeksi, adım başına] }.
// Eylemler senaryonun eylem listesinden seçilir (değişiklik yok / bir kararı değiştir / tek seferlik
// eylem); hepsi tüm nüfusa uygulanır. Yeni eylem ya da seçenek Senaryo sekmesinden eklenir.

import * as M from './model.js';
import { initialConfig } from './scenarios.js';
import { rng } from '../core/rng.js';

export function setupPlanTest(api) {
  const { $, esc, pct, f3, S, ctx, save, bars, spark, kpis, metricName, PART_LABELS, azPersonas, calibration } = api;
  let last = null;   // son test sonucu

  const plansHere = () => (S.plans ||= []).filter((p) => p.scenarioId === S.scenario.id);
  const current = () => plansHere().find((p) => p.id === S.planSel) || null;

  // Senaryo düzenlendiyse eski indeksler/seçenekler geçersiz olabilir: onar ve bildir.
  function sanitize(plan) {
    const c = ctx(), init = initialConfig(S.scenario);
    const fixes = [];
    for (const l of S.scenario.levers) {
      if (!l.options.some((o) => o.id === plan.start[l.id])) { plan.start[l.id] = init[l.id]; fixes.push(l.label); }
    }
    for (const k of Object.keys(plan.start)) if (!S.scenario.levers.some((l) => l.id === k)) delete plan.start[k];
    const H = S.scenario.horizon;
    plan.steps = Array.from({ length: H }, (_, t) => {
      const a = plan.steps[t] ?? 0;
      return a >= 0 && a < c.actions.length ? a : 0;
    });
    return fixes;
  }

  function newPlan(name, start = initialConfig(S.scenario), steps = []) {
    const p = { id: `plan-${Date.now().toString(36)}`, name, scenarioId: S.scenario.id, start: { ...start }, steps };
    sanitize(p);
    S.plans.push(p);
    S.planSel = p.id;
    save();
    return p;
  }

  // AlphaZero hamle dizisini plana çevirir: tasarım evresi başlangıç tasarımına, gerisi zaman çizelgesine.
  function fromAz() {
    if (!S.az?.moves) return null;
    const c = ctx();
    const start = { ...(S.az.start || initialConfig(S.scenario)) };
    let i = 0;
    for (; i < S.az.moves.length; i++) {
      const a = c.actions[S.az.moves[i]];
      if (a.type === 'noop') { i++; break; }
      if (a.type === 'set') start[a.lever] = a.option;
    }
    return newPlan('AlphaZero planı (kopya)', start, S.az.moves.slice(i));
  }

  function render() {
    const c = ctx(), scn = S.scenario;
    const plans = plansHere();
    if (!current() && plans.length) S.planSel = plans[0].id;
    const plan = current();
    $('ptSel').innerHTML = plans.length
      ? plans.map((p) => `<option value="${p.id}" ${p.id === S.planSel ? 'selected' : ''}>${esc(p.name)}</option>`).join('')
      : '<option value="">(henüz plan yok)</option>';
    $('ptAz').disabled = !S.az?.moves;
    $('ptEditor').style.display = plan ? '' : 'none';
    $('ptResults').style.display = plan && last?.planId === plan.id ? '' : 'none';
    if (!plan) return;

    const fixes = sanitize(plan);
    $('ptName').value = plan.name;
    $('ptFix').textContent = fixes.length ? `Senaryo değiştiği için şu kararlar başlangıç seçeneğine döndürüldü: ${fixes.join(', ')}` : '';
    $('ptDesign').innerHTML = scn.levers.map((l) => `
      <div class="grow"><label class="f">${esc(l.label)}</label>
        <select data-lever="${l.id}">${l.options.map((o) => `<option value="${o.id}" ${plan.start[l.id] === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`).join('');
    const opts = c.actions.map((a, k) => `<option value="${k}">${esc(a.type === 'noop' ? '—' : a.label)}</option>`).join('');
    $('ptSteps').innerHTML = plan.steps.map((a, t) => `
      <div class="row" style="margin:4px 0"><span class="muted small" style="width:64px">${t + 1}. ${esc(scn.unit)}</span>
        <select data-step="${t}" class="grow" style="min-width:0">${opts.replace(`value="${a}"`, `value="${a}" selected`)}</select></div>`).join('');
  }

  function showResult(plan, r) {
    const c = ctx();
    const r0 = M.forecast(c, initialConfig(S.scenario));
    kpis($('ptKpis'), [
      [f3(r.total), `Hedef skoru (başlangıç ${f3(r0.total)}${S.bestStatic ? `, en iyi statik ${f3(S.bestStatic.total)}` : ''}${S.az?.best != null ? `, AlphaZero ${f3(S.az.best)}` : ''})`],
      [pct(r.final), `${metricName()} — dönem sonu`],
      [pct(Math.min(...r.segs)), 'En düşük segment'],
      ...Object.entries(r.parts).filter(([k]) => k !== 'overspend' || r.parts.overspend > 0).map(([k, v]) => [v.toFixed(2), PART_LABELS[k] || k]),
      [r.crowd.herd.toFixed(2), 'Kitleleşme'],
      [r.crowd.split.toFixed(2), 'Kutuplaşma'],
    ]);
    const budget = S.scenario.budget || 0;
    const over = r.state.overspend > 0
      ? `<div class="note"><b>Bütçe aşıldı:</b> plan ${(budget + r.state.overspend).toFixed(1)} birim harcıyor, bütçe ${budget}. Skordaki büyük düşüşün nedeni bu olabilir; sürekli maliyetli seçenekleri (her ${esc(S.scenario.unit)} harcayanları) ya da tek seferlik eylemleri azalt.</div>`
      : `<p class="small muted">Harcama: ${(budget - r.state.budget).toFixed(1)} / ${budget} birim.</p>`;
    $('ptSkipped').innerHTML = over + (r.skipped.length
      ? `<div class="note"><b>Uygulanamayan ${r.skipped.length} adım</b> (yerine "değişiklik yok" kondu):<br>${r.skipped.map((s) => `${s.t + 1}. ${esc(S.scenario.unit)}: ${esc(s.label)} — ${esc(s.why)}`).join('<br>')}</div>`
      : '<p class="small ok">Planın bütün adımları uygulanabildi.</p>');
    bars($('ptBars'), c.seg.labels, r.segs, r0.segs);
    spark($('ptSpark'), [{ label: 'plan', data: r.state.series }, { label: 'başlangıç', data: r0.state.series }]);
    const ex = M.explainPlan(c, M.planMoves(plan), plan.start);
    const cell = (v) => `<td class="num" style="color:${v > 0.03 ? 'var(--ok)' : v < -0.03 ? 'var(--err)' : 'inherit'}">${v > 0 ? '+' : ''}${Math.round(v * 100)}</td>`;
    $('ptWhy').innerHTML = `<tr><th>Ne zaman</th><th>Adım</th><th class="num">Katkı</th>${c.seg.labels.map((l) => `<th class="num">${esc(l)}</th>`).join('')}</tr>`
      + (ex.rows.length
        ? ex.rows.sort((a, b) => b.delta - a.delta).map((x) => `<tr><td class="muted">${esc(x.when)}</td><td>${esc(x.label)}</td><td class="num"><b>${x.delta >= 0 ? '+' : ''}${x.delta.toFixed(3)}</b></td>${x.segDelta.map(cell).join('')}</tr>`).join('')
        : '<tr><td colspan="99" class="muted">Plan başlangıç tasarımını değiştirmiyor ve eylem içermiyor.</td></tr>')
      + '<tr><td colspan="99" class="small muted">Negatif katkı: o adım olmasa sonuç daha iyi olurdu; plandan çıkarmayı düşün.</td></tr>';
  }

  // ── Olaylar ──
  $('ptNew').onclick = () => { newPlan(`Plan ${plansHere().length + 1}`); last = null; render(); };
  $('ptAz').onclick = () => { if (fromAz()) { last = null; render(); } };
  $('ptSel').onchange = () => { S.planSel = $('ptSel').value; last = null; save(); render(); };
  $('ptDel').onclick = () => {
    const p = current();
    if (!p || !confirm(`"${p.name}" silinsin mi?`)) return;
    S.plans = S.plans.filter((x) => x !== p); S.planSel = null; last = null; save(); render();
  };
  $('ptName').onchange = () => { const p = current(); if (p) { p.name = $('ptName').value || p.name; save(); render(); } };
  $('ptDesign').onchange = (e) => { const p = current(); if (p && e.target.dataset.lever) { p.start[e.target.dataset.lever] = e.target.value; save(); } };
  $('ptSteps').onchange = (e) => { const p = current(); if (p && e.target.dataset.step) { p.steps[+e.target.dataset.step] = +e.target.value; save(); } };
  $('ptClear').onclick = () => { const p = current(); if (p) { p.steps = p.steps.map(() => 0); save(); render(); } };
  $('ptRun').onclick = () => {
    const p = current();
    if (!p) return;
    sanitize(p);
    const r = M.testPlan(ctx(), p);
    p.lastScore = r.total; save();
    last = { planId: p.id, r };
    $('ptResults').style.display = '';
    showResult(p, r);
  };

  // Bütün kayıtlı planlar + referanslar, bozulmuş dünyalarda karşılaştırılır.
  $('ptCompare').onclick = () => {
    const c = ctx();
    const plans = { 'Başlangıç tasarımı': { moves: [0] } };
    if (S.bestStatic?.config) plans['En iyi statik tasarım'] = { moves: [0], start: S.bestStatic.config };
    if (S.az?.moves) plans['AlphaZero planı'] = { moves: S.az.moves, start: S.az.start };
    for (const p of plansHere()) { sanitize(p); plans[`▸ ${p.name}`] = { moves: M.planMoves(p), start: p.start }; }
    const res = M.robustness(S.scenario, azPersonas(), plans, { segmentDim: S.segDim, calibration: calibration(), worlds: 40, magnitude: 0.3, rng });
    const base = Object.fromEntries(Object.entries(plans).map(([n, pl]) => [n, M.replay(c, pl.moves, pl.start)]));
    $('ptCmp').innerHTML = '<tr><th>Plan</th><th class="num">Skor</th><th class="num">En düşük segment</th><th class="num">Ortalama (bozulmuş)</th><th class="num">Kötü durum</th><th class="num">En iyi olduğu dünyalar</th></tr>'
      + Object.entries(res).sort((a, b) => b[1].mean - a[1].mean).map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">${f3(base[n].total)}</td><td class="num">${pct(Math.min(...base[n].segs))}</td><td class="num">${f3(v.mean)}</td><td class="num">${f3(v.p10)}</td><td class="num">${pct(v.winRate)}</td></tr>`).join('')
      + '<tr><td colspan="6" class="small muted">▸ senin planların. Bozulmuş: seçenek etkileri ±%30 rastgele değiştirilmiş 40 alternatif dünyada.</td></tr>';
  };

  return { render };
}
