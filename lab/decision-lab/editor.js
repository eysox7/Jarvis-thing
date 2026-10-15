// Form tabanlı senaryo düzenleyici: JSON bilmeden karar, seçenek, etki ve eylem tanımlamak için.
//
// Her alan data-path ile senaryodaki yerini gösterir ("levers.0.options.1.label").
// Değişiklikler tek bir dinleyiciyle senaryoya yazılır; yapı değişince (ekle/sil) yeniden çizilir.

import { TRAITS } from './population.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = (p) => `${p}${Math.random().toString(36).slice(2, 7)}`;

export const OBJECTIVES = {
  policy: { impact: 0.4, support: 0.35, minSegment: 0.25, polarization: 0.3 },
  marketing: { revenue: 0.45, adoption: 0.3, satisfaction: 0.25, churn: 0.3 },
};
const EVENT_KINDS = {
  policy: { information: 'Bilgilendirme (doğru bilgi yayar)', consultation: 'İstişare (sürece katılım)', evidence: 'Kanıt yayımlama (şüphecilere işler)' },
  marketing: { awareness: 'Bilinirlik (tanıtım)', trial: 'Deneme (ücretsiz deneme)', evidence: 'Kanıt yayımlama (bağımsız inceleme)' },
};

export function blankScenario(domain) {
  return {
    id: uid('custom-'), domain,
    title: domain === 'policy' ? 'Yeni politika' : 'Yeni ürün / kampanya',
    summary: '', question: domain === 'policy' ? 'Bu düzenlemeyi destekler misiniz?' : 'Bu ürünü kullanmaya başlar mıydınız?',
    unit: 'ay', horizon: 12, budget: 20,
    levers: [{
      id: 'l1', label: 'Karar 1', initial: 'a',
      options: [
        { id: 'a', label: 'Seçenek A', impact: 0.6, cost: 0, effect: { base: 0, traits: {} } },
        { id: 'b', label: 'Seçenek B', impact: 0.8, cost: 0, effect: { base: -0.2, traits: { price: -0.5 } } },
      ],
    }],
    events: [],
    objective: { ...OBJECTIVES[domain] },
  };
}

function get(obj, path) { return path.split('.').reduce((o, k) => o?.[k], obj); }
function set(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

function field(path, value, { type = 'text', label = '', step = 'any', width = '' } = {}) {
  return `<div ${width ? `style="flex:0 0 ${width}"` : 'class="grow"'}>${label ? `<label class="f">${esc(label)}</label>` : ''}
    <input type="${type}" data-path="${path}" data-type="${type}" value="${esc(value)}" ${type === 'number' ? `step="${step}"` : ''} style="width:100%"></div>`;
}

function optionHtml(l, li, o, oi) {
  const p = `levers.${li}.options.${oi}`;
  const used = Object.keys(o.effect.traits || {});
  const free = Object.keys(TRAITS).filter((t) => !used.includes(t));
  return `<div class="card" style="background:var(--bg-3);padding:10px;margin:8px 0">
    <div class="row">
      <label class="small" title="Başlangıç tasarımı"><input type="radio" name="init-${li}" data-act="initial" data-li="${li}" data-id="${esc(o.id)}" ${l.initial === o.id ? 'checked' : ''}> başlangıç</label>
      ${field(`${p}.label`, o.label, { label: 'Seçenek' })}
      <button class="btn small" data-act="del-opt" data-li="${li}" data-oi="${oi}" title="Seçeneği sil" ${l.options.length <= 2 ? 'disabled' : ''}>✕</button>
    </div>
    <div class="row" style="margin-top:6px">
      ${field(`${p}.impact`, o.impact ?? 1, { type: 'number', label: 'Amaca katkı (0-1)', step: '0.05', width: '130px' })}
      ${field(`${p}.cost`, o.cost ?? 0, { type: 'number', label: 'Bütçe / adım', step: '0.5', width: '110px' })}
      ${field(`${p}.effect.base`, o.effect.base ?? 0, { type: 'number', label: 'Genel etki', step: '0.1', width: '110px' })}
    </div>
    <div class="small muted" style="margin-top:6px">Kime nasıl etki eder (+ destek/benimseme artırır):</div>
    <div class="row" style="margin-top:4px">
      ${used.map((t) => `<div class="chip" style="display:flex;gap:6px;align-items:center">${esc(TRAITS[t])}
        <input type="number" step="0.1" data-path="${p}.effect.traits.${t}" data-type="number" value="${o.effect.traits[t]}" style="width:64px;padding:2px 6px">
        <button class="btn small" style="padding:0 6px" data-act="del-trait" data-li="${li}" data-oi="${oi}" data-t="${t}">✕</button></div>`).join('')}
      ${free.length ? `<select data-act="add-trait" data-li="${li}" data-oi="${oi}"><option value="">+ eğilim ekle</option>${free.map((t) => `<option value="${t}">${esc(TRAITS[t])}</option>`).join('')}</select>` : ''}
    </div></div>`;
}

export function render(el, scn) {
  const kinds = EVENT_KINDS[scn.domain];
  el.innerHTML = `
    <div class="card">
      <div class="row">
        ${field('title', scn.title, { label: 'Başlık' })}
        <div style="flex:0 0 160px"><label class="f">Alan</label><select data-act="domain" style="width:100%">
          <option value="policy" ${scn.domain === 'policy' ? 'selected' : ''}>Kamu politikası</option>
          <option value="marketing" ${scn.domain === 'marketing' ? 'selected' : ''}>Pazarlama</option></select></div>
      </div>
      <div style="margin-top:8px"><label class="f">Açıklama (personalara da gösterilir)</label>
        <textarea data-path="summary" data-type="text" style="min-height:70px">${esc(scn.summary)}</textarea></div>
      <div class="row" style="margin-top:8px">
        ${field('question', scn.question, { label: 'Personalara sorulan soru' })}
        ${field('unit', scn.unit, { label: 'Zaman birimi', width: '90px' })}
        ${field('horizon', scn.horizon, { type: 'number', label: 'Süre', step: '1', width: '80px' })}
        ${field('budget', scn.budget, { type: 'number', label: 'Bütçe', step: '1', width: '90px' })}
      </div>
    </div>
    ${scn.levers.map((l, li) => `
      <div class="card lever">
        <div class="row">${field(`levers.${li}.label`, l.label, { label: `Karar ${li + 1}` })}
          <button class="btn small" data-act="del-lever" data-li="${li}" ${scn.levers.length <= 1 ? 'disabled' : ''}>Kararı sil</button></div>
        ${l.options.map((o, oi) => optionHtml(l, li, o, oi)).join('')}
        <button class="btn small" data-act="add-opt" data-li="${li}">+ Seçenek</button>
      </div>`).join('')}
    <button class="btn" data-act="add-lever">+ Karar ekle</button>
    <h2>Tek seferlik eylemler</h2>
    <div class="card">
      ${(scn.events || []).map((e, ei) => `<div class="row" style="margin-bottom:8px">
        ${field(`events.${ei}.label`, e.label, { label: 'Eylem' })}
        <div style="flex:0 0 190px"><label class="f">Tür</label><select data-path="events.${ei}.kind" data-type="text" style="width:100%">
          ${Object.entries(kinds).map(([k, v]) => `<option value="${k}" ${e.kind === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
        ${field(`events.${ei}.strength`, e.strength, { type: 'number', label: 'Güç', step: '0.05', width: '80px' })}
        ${field(`events.${ei}.cost`, e.cost, { type: 'number', label: 'Maliyet', step: '0.5', width: '80px' })}
        <button class="btn small" data-act="del-event" data-ei="${ei}">✕</button></div>`).join('') || '<p class="muted small">Yok.</p>'}
      <button class="btn small" data-act="add-event">+ Eylem</button>
    </div>`;
}

// Düzenleyiciyi bağlar. onChange(structural): her değişiklikte; structural=true ise yeniden çiz.
export function bind(el, getScn, onChange) {
  el.addEventListener('change', (e) => {
    const t = e.target;
    const scn = getScn();
    if (t.dataset.path) {
      let v = t.value;
      if (t.dataset.type === 'number') { v = Number(v); if (!Number.isFinite(v)) return; }
      set(scn, t.dataset.path, v);
      onChange(false);
    } else if (t.dataset.act === 'initial') {
      scn.levers[+t.dataset.li].initial = t.dataset.id; onChange(false);
    } else if (t.dataset.act === 'add-trait' && t.value) {
      const o = scn.levers[+t.dataset.li].options[+t.dataset.oi];
      o.effect.traits = { ...(o.effect.traits || {}), [t.value]: 0.5 };
      onChange(true);
    } else if (t.dataset.act === 'domain') {
      scn.domain = t.value;
      scn.objective = { ...OBJECTIVES[t.value] };
      const kinds = Object.keys(EVENT_KINDS[t.value]);
      for (const ev of scn.events || []) if (!kinds.includes(ev.kind)) ev.kind = kinds[0];
      onChange(true);
    }
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const scn = getScn();
    const li = +b.dataset.li, oi = +b.dataset.oi;
    switch (b.dataset.act) {
      case 'add-lever':
        scn.levers.push({ id: uid('l'), label: `Karar ${scn.levers.length + 1}`, initial: 'a', options: [
          { id: 'a', label: 'Seçenek A', impact: 0.6, cost: 0, effect: { base: 0, traits: {} } },
          { id: 'b', label: 'Seçenek B', impact: 0.8, cost: 0, effect: { base: 0, traits: {} } }] });
        break;
      case 'del-lever': scn.levers.splice(li, 1); break;
      case 'add-opt': scn.levers[li].options.push({ id: uid('o'), label: 'Yeni seçenek', impact: 0.7, cost: 0, effect: { base: 0, traits: {} } }); break;
      case 'del-opt': {
        const l = scn.levers[li];
        const [gone] = l.options.splice(oi, 1);
        if (l.initial === gone.id) l.initial = l.options[0].id;
        break;
      }
      case 'del-trait': delete scn.levers[li].options[oi].effect.traits[b.dataset.t]; break;
      case 'add-event': {
        const kind = Object.keys(EVENT_KINDS[scn.domain])[0];
        (scn.events ||= []).push({ id: uid('e'), label: 'Yeni eylem', kind, strength: 0.25, cost: 2 });
        break;
      }
      case 'del-event': scn.events.splice(+b.dataset.ei, 1); break;
      default: return;
    }
    onChange(true);
  });
}

export { get };
