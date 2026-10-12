// "Kitle" sekmesi: kitle tahminini sohbet açmadan, form üzerinden çalıştırır.
// Hesap tamamen cihazda yapılır (model çağrısı yok); sohbetteki audience_* araçlarıyla aynı motor.

import { $, el } from './util.js';
import * as S from './store.js';
import { predict, optimize, DOMAINS, CHANNELS, FRAMES } from './audience/engine.js';
import { INSTITUTIONS } from './audience/institutions.js';
import { DIMENSIONS } from './audience/personas.js';
import { SCENARIOS } from './audience/scenarios.js';

const selected = new Set();   // seçili kanallar (boş = kurumun kanalları)
let lens = 'butunlesik';

const opt = (v, t, sel) => el('option', { value: v, selected: sel || null }, t);

export function initAudienceView() {
  const domSel = $('#audDomain'), frSel = $('#audFrame'), segSel = $('#audSegment');
  domSel.append(...Object.entries(DOMAINS).map(([k, v]) => opt(k, v.label, k === 'kamu_hizmeti')));
  domSel.prepend(opt('', '(metinden çıkar)'));
  domSel.value = '';
  frSel.append(opt('', '(metinden çıkar / nötr)'), ...Object.entries(FRAMES).map(([k, v]) => opt(k, v)));
  segSel.append(opt('', '(kırılım yok)'), ...Object.entries(DIMENSIONS).map(([k, v]) => opt(k, v.label, k === 'yas')));

  const sc = $('#audScenario');
  sc.append(opt('', '(boş — kendi mesajını gir)'), ...Object.entries(SCENARIOS).map(([k, v]) => opt(k, v.ad)));
  sc.addEventListener('change', () => loadScenario(SCENARIOS[sc.value]));

  const chips = $('#audChannels');
  for (const [k, v] of Object.entries(CHANNELS)) {
    chips.append(el('button', {
      class: 'chip', 'data-ch': k, type: 'button',
      onclick: (e) => { selected.has(k) ? selected.delete(k) : selected.add(k); e.currentTarget.classList.toggle('on', selected.has(k)); },
    }, v.label));
  }

  $('#audLens').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-l]');
    if (!b) return;
    lens = b.dataset.l;
    [...$('#audLens').children].forEach((x) => x.classList.toggle('active', x === b));
  });

  $('#btnAudPredict').addEventListener('click', () => run('predict'));
  $('#btnAudOptimize').addEventListener('click', () => run('optimize'));
}

/** Hazır senaryoyu forma doldurur (alan/çerçeve metinden çıkarılsın diye boş bırakılır). */
function loadScenario(s) {
  if (!s) return;
  renderAudience();
  $('#audText').value = s.metin;
  $('#audInst').value = s.kurum;
  $('#audDomain').value = '';
  $('#audFrame').value = '';
  $('#audStance').value = '';
  selected.clear();
  for (const c of s.kanallar) selected.add(c);
  document.querySelectorAll('#audChannels .chip').forEach((b) => b.classList.toggle('on', selected.has(b.dataset.ch)));
}

/** Kurum listesini (hazır türler + kayıtlı kurumlar) tazeler. */
export function renderAudience() {
  const sel = $('#audInst');
  const cur = sel.value;
  const saved = S.db().audience?.institutions || {};
  sel.innerHTML = '';
  sel.append(opt('', '(belirtilmemiş kaynak)'));
  const g1 = el('optgroup', { label: 'Kurum türleri' }, ...Object.entries(INSTITUTIONS).map(([k, v]) => opt(k, v.ad)));
  sel.append(g1);
  if (Object.keys(saved).length) sel.append(el('optgroup', { label: 'Kayıtlı kurumlar' }, ...Object.entries(saved).map(([k, v]) => opt('@' + k, v.ad || k))));
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
}

function readForm() {
  const aud = S.db().audience || { institutions: {}, calibration: {} };
  const instVal = $('#audInst').value;
  const savedId = instVal.startsWith('@') ? instVal.slice(1) : null;
  const msg = {
    metin: $('#audText').value.trim() || undefined,
    domain: $('#audDomain').value || undefined,
    frame: $('#audFrame').value || undefined,
    institution: savedId ? aud.institutions[savedId] : instVal || undefined,
    channels: selected.size ? [...selected] : undefined,
    durus: $('#audStance').value || undefined,
  };
  const key = savedId || instVal;
  return {
    msg,
    opts: {
      lens,
      calibration: (key && aud.calibration[key]) || aud.calibration._genel,
      marginals: savedId ? aud.institutions[savedId]?.kitle : undefined,
      segmentBy: $('#audSegment').value ? [$('#audSegment').value] : [],
    },
  };
}

function run(kind) {
  const out = $('#audResult');
  out.innerHTML = '';
  out.append(el('div', { class: 'muted small', text: kind === 'optimize' ? 'çerçeve × kanal ızgarası taranıyor…' : 'sentetik nüfus simüle ediliyor…' }));
  // Hesap senkron; "hesaplanıyor" yazısının çizilmesi için bir kare bekle.
  setTimeout(() => {
    try {
      const { msg, opts } = readForm();
      out.innerHTML = '';
      if (kind === 'optimize') out.append(renderOptimize(optimize(msg, { ...opts, n: 700 })));
      else out.append(renderPrediction(predict(msg, { ...opts, n: 2000, modelUncertainty: true })));
    } catch (e) {
      out.innerHTML = '';
      out.append(el('div', { class: 'msg err', text: e.message }));
    }
  }, 30);
}

const fmtCi = (ci) => (ci ? `%90 GA: ${ci[0]} – ${ci[1]}` : '');

function kpi(label, value, sub) {
  return el('div', { class: 'kpi' }, el('div', { class: 'kpi-v', text: value }), el('div', { class: 'kpi-l', text: label }), sub ? el('div', { class: 'kpi-s', text: sub }) : null);
}

function renderPrediction(r) {
  const s = r.sonuc;
  const wrap = el('div', { class: 'aud-out', id: 'audPrediction' });
  wrap.append(el('div', { class: 'muted small', text: `${r.mesaj.kurum} · ${r.mesaj.alan} · ${r.mesaj.cerceve} · ${r.mesaj.kanallar.join(', ')} · ${r.n} persona${r.kalibre ? ' · kalibre' : ''}` }));
  wrap.append(el('div', { class: 'kpis' },
    kpi('Erişim', `%${s.erisim_yuzde}`, fmtCi(s.erisim_ga90)),
    kpi('Ortalama tutum', (s.ortalama_tutum > 0 ? '+' : '') + s.ortalama_tutum, fmtCi(s.tutum_ga90)),
    kpi('Olumlu / olumsuz', `%${s.olumlu_yuzde} / %${s.olumsuz_yuzde}`),
    kpi('Paylaşım', `%${s.paylasim_yuzde}`, fmtCi(s.paylasim_ga90)),
    kpi('Benimseme', `%${s.benimseme_yuzde}`, fmtCi(s.benimseme_ga90)),
    kpi('Anlama / müzakere', `%${s.anlama_yuzde} / %${s.muzakere_yuzde}`),
  ));

  const mu = r.model_belirsizligi;
  if (mu) {
    const b = mu.bant_ga90;
    wrap.append(el('h4', { text: 'Model belirsizliği' }), el('div', { class: 'mu ' + (mu.duyarlilik.startsWith('yüksek') ? 'hi' : mu.duyarlilik.startsWith('orta') ? 'mid' : 'lo') },
      el('div', {}, el('strong', { text: 'Duyarlılık: ' }), mu.duyarlilik),
      el('div', { class: 'small', text: mu.yorum }),
      el('div', { class: 'small muted', text: `Kuram ağırlıkları ×0.5–×2 bozulunca → erişim %${b.erisim_yuzde[0]}–${b.erisim_yuzde[1]} · tutum ${b.ortalama_tutum[0]} … ${b.ortalama_tutum[1]} · olumlu %${b.olumlu_yuzde[0]}–${b.olumlu_yuzde[1]}` }),
      el('div', { class: 'small muted', text: `Yalnız ana akım: tutum ${mu.mercek_karsilastirma.ana_akim.ortalama_tutum} · yalnız eleştirel: tutum ${mu.mercek_karsilastirma.elestirel.ortalama_tutum}` }),
    ));
  }

  if (s.hall_okuma_yuzde) {
    const h = s.hall_okuma_yuzde;
    wrap.append(el('h4', { text: 'Hall okumaları' }), el('div', { class: 'hall' },
      el('span', { class: 'h-dom', style: `width:${h.egemen}%`, title: 'egemen' }),
      el('span', { class: 'h-neg', style: `width:${h.muzakereci}%`, title: 'müzakereci' }),
      el('span', { class: 'h-opp', style: `width:${h.karsit}%`, title: 'karşıt' }),
    ), el('div', { class: 'legend small' },
      el('span', {}, el('i', { class: 'h-dom' }), ` egemen %${h.egemen}`),
      el('span', {}, el('i', { class: 'h-neg' }), ` müzakereci %${h.muzakereci}`),
      el('span', {}, el('i', { class: 'h-opp' }), ` karşıt %${h.karsit}`),
    ));
  }

  // Kuram katkıları: tutum etkisi, ıraksak çubuk
  const max = Math.max(0.05, ...r.kuramlar.map((t) => Math.abs(t.tutum_etkisi)));
  wrap.append(el('h4', { text: 'Kuram katkıları (tutuma etki)' }));
  const list = el('div', { class: 'theories' });
  for (const t of r.kuramlar) {
    const w = Math.abs(t.tutum_etkisi) / max * 50;
    list.append(el('div', { class: 'th-row', title: `erişim etkisi ${t.erisim_etkisi} · paylaşım ${t.paylasim_etkisi}` },
      el('span', { class: 'th-name ' + t.gelenek, text: t.ad }),
      el('span', { class: 'th-bar' },
        el('i', { class: t.tutum_etkisi >= 0 ? 'pos' : 'neg', style: t.tutum_etkisi >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%` })),
      el('span', { class: 'th-val', text: (t.tutum_etkisi > 0 ? '+' : '') + t.tutum_etkisi }),
    ));
  }
  wrap.append(list, el('div', { class: 'legend small' },
    el('span', {}, el('i', { class: 'ana_akim' }), ' ana akım'), el('span', {}, el('i', { class: 'elestirel' }), ' eleştirel')));

  if (r.segmentler) {
    for (const [dim, groups] of Object.entries(r.segmentler)) {
      wrap.append(el('h4', { text: `Kırılım: ${DIMENSIONS[dim]?.label || dim}` }));
      const tbl = el('table', { class: 'seg-table' },
        el('tr', {}, ...['', 'n', 'erişim', 'tutum', 'olumlu', 'karşıt'].map((h) => el('th', { text: h }))));
      for (const [v, g] of Object.entries(groups)) {
        tbl.append(el('tr', {}, el('td', { text: v }), el('td', { text: g.n }), el('td', { text: `%${g.erisim}` }),
          el('td', { class: g.tutum >= 0 ? 'pos' : 'neg', text: g.tutum.toFixed(3) }), el('td', { text: `%${g.olumlu}` }),
          el('td', { text: g.okuma ? `%${g.okuma.karsit}` : '—' })));
      }
      wrap.append(tbl);
    }
  }
  if (r.cikarim) wrap.append(el('details', { class: 'small' }, el('summary', { text: 'Metinden çıkarılanlar' }), el('pre', { text: JSON.stringify(r.cikarim, null, 1) })));
  wrap.append(el('p', { class: 'muted small', text: r.uyari }));
  return wrap;
}

function renderOptimize(o) {
  const wrap = el('div', { class: 'aud-out', id: 'audOptimize' });
  wrap.append(el('div', { class: 'muted small', text: `${o.kurum} · ${DOMAINS[o.alan].label} · metrik: ${o.metrik}` }));
  const table = (title, rows) => {
    wrap.append(el('h4', { text: title }));
    const t = el('table', { class: 'seg-table' }, el('tr', {}, ...['çerçeve', 'kanal', 'skor', 'erişim', 'karşıt'].map((h) => el('th', { text: h }))));
    for (const r of rows) {
      t.append(el('tr', {}, el('td', { text: r.cerceve }), el('td', { text: r.kanallar.map((c) => CHANNELS[c].label).join(', ') }),
        el('td', { class: r.skor >= 0 ? 'pos' : 'neg', text: r.skor }), el('td', { text: `%${r.erisim}` }), el('td', { text: r.karsit_okuma === null ? '—' : `%${r.karsit_okuma}` })));
    }
    wrap.append(t);
  };
  table('En iyi stratejiler', o.en_iyi);
  table('Kaçınılacaklar', o.en_kotu);
  return wrap;
}
