// "Karar" sekmesi: oy / satın alma / gündelik karar tahmini, veri yükleyip öğrenme, ne olur.
// Hesap cihazda yapılır; sohbetteki decision_* araçlarıyla aynı motor ve aynı kayıtlar.

import { $, el } from './util.js';
import * as S from './store.js';
import { predictChoice, whatIf, resolveChoice } from './decision/model.js';
import { DECISION_DOMAINS } from './decision/domains.js';
import { DECISION_PRESETS } from './decision/presets.js';
import { parseCSV, prepareRows } from './decision/data.js';
import { learn, shareDiagnostics } from './decision/estimate.js';
import { DIMENSIONS } from './audience/personas.js';

const opt = (v, t) => el('option', { value: v }, t);
const decDb = () => S.db().decision || { scenarios: {}, datasets: {}, models: {} };
const COLORS = ['#4da3ff', '#f0883e', '#3fb950', '#c297ff', '#d29922', '#ff7b72', '#79c0ff', '#a5d6ff'];

export function initDecisionView() {
  $('#decSegment').append(opt('', '(kırılım yok)'), ...Object.entries(DIMENSIONS).map(([k, v]) => opt(k, v.label)));
  $('#decSegment').value = 'ideoloji';
  $('#decScenario').addEventListener('change', () => loadScenario($('#decScenario').value));
  $('#decDomain').addEventListener('change', showAttrDoc);
  $('#btnDecPredict').addEventListener('click', () => run(predictNow));
  $('#btnDecWhatIf').addEventListener('click', () => run(whatIfNow));
  $('#btnDecLearn').addEventListener('click', () => run(learnNow));
  $('#btnDecSave').addEventListener('click', () => run(saveNow));
  renderDecision();
  loadScenario('hazir:secim');
}

/** Senaryo listesini (kayıtlı + hazır) tazeler. */
export function renderDecision() {
  const sel = $('#decScenario'), cur = sel.value;
  const saved = decDb().scenarios;
  sel.innerHTML = '';
  if (Object.keys(saved).length) {
    sel.append(el('optgroup', { label: 'Kayıtlı senaryolar' }, ...Object.entries(saved).map(([k, v]) => {
      const m = decDb().models[k];
      return opt('kayit:' + k, `${v.ad || k}${m?.cv ? ` · isabet %${m.cv.isabet_yuzde}` : m ? ' · kalibre' : ''}`);
    })));
  }
  sel.append(el('optgroup', { label: 'Hazır örnekler' }, ...Object.entries(DECISION_PRESETS).map(([k, v]) => opt('hazir:' + k, v.ad))));
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function loadScenario(key) {
  if (!key) return;
  const [kind, id] = key.split(':');
  const sc = kind === 'kayit' ? decDb().scenarios[id] : DECISION_PRESETS[id];
  if (!sc) return;
  $('#decScenario').value = key;
  $('#decId').value = kind === 'kayit' ? id : id;
  $('#decDomain').value = sc.alan;
  $('#decAlts').value = JSON.stringify(sc.secenekler, null, 1);
  $('#decCtx').value = JSON.stringify(sc.baglam || {});
  showAttrDoc();
  $('#decResult').innerHTML = '';
}

function showAttrDoc() {
  const d = DECISION_DOMAINS[$('#decDomain').value];
  $('#decAttrDoc').textContent = Object.entries(d.seceneOzellikleri).map(([k, v]) => `${k}: ${v}`).join('\n')
    + (Object.keys(d.baglam || {}).length ? '\n\nbağlam → ' + Object.entries(d.baglam).map(([k, v]) => `${k}: ${v}`).join('; ') : '');
}

function parseJson(id, label) {
  const t = $(id).value.trim();
  if (!t) return label === 'Bağlam' ? {} : null;
  try { return JSON.parse(t); } catch (e) { throw new Error(`${label} geçerli JSON değil: ${e.message}`); }
}

function currentSpec() {
  const spec = { alan: $('#decDomain').value, secenekler: parseJson('#decAlts', 'Seçenekler'), baglam: parseJson('#decCtx', 'Bağlam') };
  resolveChoice(spec);
  return spec;
}
const currentId = () => ($('#decId').value.trim().replace(/\s+/g, '_') || null);
const currentModel = () => { const id = currentId(); return id ? decDb().models[id] : undefined; };

function run(fn) {
  const out = $('#decResult');
  out.innerHTML = '';
  out.append(el('div', { class: 'muted small', text: 'hesaplanıyor…' }));
  setTimeout(() => {
    try { out.innerHTML = ''; out.append(fn()); } catch (e) { out.innerHTML = ''; out.append(el('div', { class: 'msg err', text: e.message })); }
  }, 30);
}

function saveNow() {
  const id = currentId();
  if (!id) throw new Error('senaryo kimliği gir');
  const spec = currentSpec();
  S.saveScenario(id, { ...spec, ad: decDb().scenarios[id]?.ad || DECISION_PRESETS[id]?.ad || id });
  renderDecision();
  $('#decScenario').value = 'kayit:' + id;
  return el('div', { class: 'muted small', text: `"${id}" kaydedildi. Veri yükleyip öğrenebilir ya da sohbette decision_predict ile kullanabilirsin.` });
}

function bars(shares, labels, delta) {
  const wrap = el('div', { class: 'dec-bars' });
  const max = Math.max(1, ...Object.values(shares).map(Math.abs));
  Object.entries(shares).forEach(([id, v], i) => {
    wrap.append(el('div', { class: 'dec-row' },
      el('span', { class: 'dec-name', text: labels[id] || id, title: labels[id] || id }),
      el('span', { class: 'dec-track' }, el('i', { style: `width:${Math.abs(v) / max * 100}%;background:${delta ? (v >= 0 ? 'var(--ok)' : 'var(--err)') : COLORS[i % COLORS.length]}` })),
      el('span', { class: 'dec-val', text: delta ? (v > 0 ? '+' : '') + v : `%${v}` })));
  });
  return wrap;
}

function predictNow() {
  const spec = currentSpec(), model = currentModel();
  const seg = $('#decSegment').value;
  const r = predictChoice(spec, { model, n: 2000, segmentBy: seg ? [seg] : [] });
  const labels = Object.fromEntries(spec.secenekler.map((a) => [String(a.id ?? a.ad), a.ad || a.id]));
  const box = el('div', { class: 'aud-out', id: 'decPrediction' });
  box.append(el('div', { class: 'muted small', text: `${r.alan} · ${r.n} persona · ${r.kaynak}` }));
  if (r.dogrulama) box.append(el('div', { class: 'mu lo' }, el('div', {}, el('strong', { text: `Görülmemiş veride isabet: %${r.dogrulama.isabet_yuzde}` })),
    el('div', { class: 'small muted', text: `çoğunluk tahmini %${r.dogrulama.temel_isabet_yuzde} · log-kayıp ${r.dogrulama.log_kayip}` })));
  else box.append(el('div', { class: 'mu mid' }, el('div', { class: 'small', text: 'Kuram öncülleriyle tahmin — kurumun verisi yüklenmeden mutlak paylar kalibre değildir. Yönler ve "ne olur" karşılaştırmaları daha güvenilirdir.' })));
  box.append(el('h4', { text: 'Tahmini paylar' }), bars(r.paylar, labels));
  if (r.pay_araligi_90) box.append(el('div', { class: 'muted small', text: '%90 tahmin aralığı: ' + Object.entries(r.pay_araligi_90).map(([id, [lo, hi]]) => `${labels[id] || id} %${lo}–${hi}`).join(' · ') }));
  if (r.gecerli_oy_paylari) box.append(el('h4', { text: `Geçerli oy payları · katılım %${r.katilim_yuzde}` }), bars(r.gecerli_oy_paylari, labels));
  if (r.gizli_siniflar) box.append(el('div', { class: 'muted small', text: 'Gizli tercih sınıfları: ' + r.gizli_siniflar.map((c) => `${c.etiket || 'sınıf'} %${c.pay_yuzde}`).join(' · ') }));
  box.append(el('div', { class: 'kpis' },
    el('div', { class: 'kpi' }, el('div', { class: 'kpi-v', text: labels[r.kazanan] || r.kazanan }), el('div', { class: 'kpi-l', text: `önde · fark ${r.fark_puan} puan` })),
    el('div', { class: 'kpi' }, el('div', { class: 'kpi-v', text: r.kararsizlik }), el('div', { class: 'kpi-l', text: 'kararsızlık (0 kesin … 1 tam kararsız)' }))));
  if (r.segmentler) {
    for (const [dim, groups] of Object.entries(r.segmentler)) {
      box.append(el('h4', { text: `Kırılım: ${DIMENSIONS[dim]?.label || dim}` }));
      const ids = Object.keys(r.paylar);
      const t = el('table', { class: 'seg-table' }, el('tr', {}, el('th', { text: '' }), el('th', { text: 'n' }), ...ids.map((id) => el('th', { text: id }))));
      for (const [v, g] of Object.entries(groups)) t.append(el('tr', {}, el('td', { text: v }), el('td', { text: g.n }), ...ids.map((id) => el('td', { text: `%${g[id]}` }))));
      box.append(t);
    }
  }
  if (r.terim_etkileri?.length) {
    box.append(el('h4', { text: `Önde olanın payını ne itiyor? (${labels[r.kazanan] || r.kazanan})` }));
    box.append(bars(Object.fromEntries(r.terim_etkileri.slice(0, 8).map((t) => [t.ad, t.kazanan_payina_etki_puan])), {}, true));
  }
  return box;
}

function whatIfNow() {
  const spec = currentSpec();
  const changes = parseJson('#decWhatIf', 'Değişiklik');
  if (!changes) throw new Error('değişiklik JSON\'u gir');
  const r = whatIf(spec, changes, { model: currentModel(), n: 2000 });
  const labels = Object.fromEntries(spec.secenekler.map((a) => [String(a.id ?? a.ad), a.ad || a.id]));
  const box = el('div', { class: 'aud-out', id: 'decWhatIfOut' });
  box.append(el('h4', { text: 'Pay değişimi (puan)' }), bars(r.degisim_puan, labels, true));
  box.append(el('div', { class: 'muted small', text: `önde: ${labels[r.kazanan_once] || r.kazanan_once} → ${labels[r.kazanan_sonra] || r.kazanan_sonra}` }));
  return box;
}

function learnNow() {
  const id = currentId();
  if (!id) throw new Error('önce senaryo kimliği gir');
  const spec = currentSpec();
  const prep = prepareRows(parseCSV($('#decCsv').value), spec);
  if (prep.rows.length < 10) throw new Error(`öğrenme için en az 10 geçerli satır gerekli (${prep.rows.length}). ${prep.uyarilar.join(' · ')}`);
  S.saveScenario(id, { ...spec, ad: decDb().scenarios[id]?.ad || DECISION_PRESETS[id]?.ad || id });
  S.saveDataset(id, prep);
  const model = learn(spec, prep.rows, {});
  S.saveModel(id, model);
  renderDecision();
  $('#decScenario').value = 'kayit:' + id;
  const cv = model.cv, diag = shareDiagnostics(spec, prep.rows, model);
  const box = el('div', { class: 'aud-out', id: 'decLearnOut' });
  box.append(el('div', { class: 'kpis' },
    el('div', { class: 'kpi' }, el('div', { class: 'kpi-v', text: `%${cv.isabet_yuzde}` }), el('div', { class: 'kpi-l', text: 'isabet (5-katlı, görülmemiş veri)' })),
    el('div', { class: 'kpi' }, el('div', { class: 'kpi-v', text: `%${cv.cogunluk_isabet_yuzde}` }), el('div', { class: 'kpi-l', text: 'referans: herkese en sık seçenek' })),
    el('div', { class: 'kpi' }, el('div', { class: 'kpi-v', text: cv.log_kayip }), el('div', { class: 'kpi-l', text: `log-kayıp (referans ${cv.cogunluk_log_kayip})` })),
    el('div', { class: 'kpi' }, el('div', { class: 'kpi-v', text: cv.kalibrasyon_hatasi_ece }), el('div', { class: 'kpi-l', text: 'kalibrasyon hatası (ECE)' }))));
  if (prep.uyarilar.length) box.append(el('div', { class: 'muted small', text: prep.uyarilar.join(' · ') }));
  box.append(el('h4', { text: 'Kuramlar bu veride' }));
  const t = el('table', { class: 'seg-table' }, el('tr', {}, ...['kuram', 'öncül', 'öğrenilen', 'veri payı', ''].map((h) => el('th', { text: h }))));
  for (const k of model.kuramlar) t.append(el('tr', {}, el('td', { text: k.ad, title: k.kuram }), el('td', { text: k.onsel }), el('td', { text: `${k.ogrenilen}±${k.std_hata}` }), el('td', { text: `%${k.veri_payi_yuzde}` }), el('td', { class: k.destek.includes('TERS') ? 'neg' : k.destek.includes('destekliyor') ? 'pos' : '', text: k.destek })));
  box.append(t);
  const labels = Object.fromEntries(spec.secenekler.map((a) => [String(a.id ?? a.ad), a.ad || a.id]));
  box.append(el('h4', { text: 'Örneklem → nüfus' }));
  const t2 = el('table', { class: 'seg-table' }, el('tr', {}, el('th', { text: '' }), ...Object.keys(diag.ham_orneklem).map((id) => el('th', { text: labels[id] || id }))));
  for (const [k, lab] of [['ham_orneklem', 'ham örneklem'], ['agirlikli_orneklem', 'ağırlıklı'], ['model_nufus', 'model (nüfus)']]) {
    t2.append(el('tr', {}, el('td', { text: lab }), ...Object.keys(diag.ham_orneklem).map((id) => el('td', { text: `%${diag[k][id]}` }))));
  }
  box.append(t2);
  return box;
}
