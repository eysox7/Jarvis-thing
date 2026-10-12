// Kitle tahmin motoru: MatrAIx tarzı sentetik nüfus × kuram yığını × kurum profili.
// Akış:  nüfus örnekle → (1. geçiş) kanal + birey kuramları → nüfus toplamları →
//        (2. geçiş) sosyal etkileşim kuramları → kişi başı çıktılar → toplam + segment + güven aralığı.
// Saf JS, DOM yok: hem tarayıcıda (ajan aracı) hem node'da (test) çalışır.

import { samplePopulation, features, rng, DIMENSIONS } from './personas.js';
import { THEORIES, lensWeights, sig } from './theories.js';
import { DOMAINS, CHANNELS, FRAMES, resolveInstitution } from './institutions.js';
import { extractMessage } from './extract.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const num = (v, d, lo, hi) => (v === undefined || v === null || v === '' || !Number.isFinite(+v) ? d : clamp(+v, lo, hi));
const r3 = (x) => Math.round(x * 1000) / 1000;
const pct = (x) => Math.round(x * 1000) / 10;

const STANCE = { egemen: 1, statuko: 1, notr: 0, muhalif: -1, karsi: -1, karsi_hegemonik: -1 };
const SLANT = { sol: -1, merkez: 0, sag: 1, notr: 0 };

/** Serbest biçimli mesaj tanımını motorun anladığı forma getirir; bilinmeyeni açıkça reddeder. */
export function normalizeMessage(msg = {}) {
  // Metin verildiyse eksik alanlar metinden çıkarılır; açıkça verilen her alan önceliklidir.
  const text = msg.text || msg.metin || '';
  const ex = text ? extractMessage(text) : { message: {}, kanit: null };
  const E = ex.message;
  const domain = msg.domain || msg.alan || E.domain || 'kamu_hizmeti';
  if (!DOMAINS[domain]) throw new Error(`bilinmeyen alan: ${domain}. Kullanılabilir: ${Object.keys(DOMAINS).join(', ')}`);
  const frame = msg.frame || msg.cerceve || E.frame || 'notr';
  if (!FRAMES[frame]) throw new Error(`bilinmeyen çerçeve: ${frame}. Kullanılabilir: ${Object.keys(FRAMES).join(', ')}`);
  const inst = resolveInstitution(msg.institution ?? msg.kurum);
  let channels = msg.channels ?? msg.kanallar ?? msg.channel ?? msg.kanal ?? inst.kanallar ?? ['sosyal'];
  if (!Array.isArray(channels)) channels = String(channels).split(/[,\s]+/).filter(Boolean);
  for (const c of channels) if (!CHANNELS[c]) throw new Error(`bilinmeyen kanal: ${c}. Kullanılabilir: ${Object.keys(CHANNELS).join(', ')}`);
  if (!channels.length) channels = ['sosyal'];

  const stance = msg.hegemonic ?? msg.stance ?? msg.durus ?? E.hegemonic;
  const slant = msg.slant ?? msg.egilim ?? E.slant;
  return {
    domain, frame, channels, inst, text, extraction: ex.kanit,
    quality: num(msg.quality ?? msg.arguman_kalitesi ?? E.quality, 0.6, 0, 1),
    cues: num(msg.cues ?? msg.cevresel_ipucu ?? E.cues, 0.5, 0, 1),
    slant: typeof slant === 'string' ? (SLANT[slant] ?? 0) : num(slant, inst.ideoloji * 0.7, -1, 1),
    // Egemen bloğun ideolojik konumu (Hall/Gramsci). Ülke/dönem bağlamına göre kurum değiştirebilir.
    H: num(msg.egemen_ideoloji ?? msg.H, 0.5, -1, 1),
    hegemonic: typeof stance === 'string' ? (STANCE[stance] ?? 0) : num(stance, 0, -1, 1),
    novelty: num(msg.novelty ?? msg.yenilik ?? E.novelty, 0.3, 0, 1),
    repetition: num(msg.repetition ?? msg.tekrar, 1, 1, 50),
    controversy: num(msg.controversy ?? msg.tartismali, DOMAINS[domain].controversy, 0, 1),
    commercial: num(msg.commercial ?? msg.ticari ?? E.commercial, inst.ticari, 0, 1),
    representation: num(msg.representation ?? msg.temsil ?? E.representation, 0, -1, 1),
  };
}

const ZERO = () => ({ exp: 0, att: 0, cred: 0, shift: 0, share: -1.6, comp: 0, adopt: -0.5, dom: 0, neg: 0, opp: 0, delib: 0 });
const KEYS = ['att', 'cred', 'shift', 'share', 'comp', 'adopt', 'dom', 'neg', 'opp', 'delib'];

function addDelta(state, delta, w, contrib, tid) {
  if (!delta || !w) return;
  for (const k of KEYS) {
    const v = delta[k];
    if (!v) continue;
    state[k] += w * v;
    contrib[tid][k] = (contrib[tid][k] || 0) + w * v;
  }
}

/** Kişi başı sonuç: olasılıklar ve tutum. */
function outcome(state, expLogit) {
  const z = Math.exp(state.dom) + Math.exp(state.neg) + Math.exp(state.opp);
  return {
    exposed: sig(expLogit),
    attend: sig(state.att),
    attitude: Math.tanh(state.shift),
    share: sig(state.share),
    comp: sig(state.comp),
    adopt: sig(state.adopt),
    delib: sig(state.delib - 0.5),
    dec: { egemen: Math.exp(state.dom) / z, muzakereci: Math.exp(state.neg) / z, karsit: Math.exp(state.opp) / z },
  };
}

/**
 * Bir mesajın kitle tepkisini tahmin eder.
 * @param {object} message     normalizeMessage girdisi
 * @param {object} opts        {n, seed, lens, weights, marginals, target, segmentBy, bootstrap, calibration}
 */
export function predict(message, opts = {}) {
  const m = normalizeMessage(message);
  const dom = { id: m.domain, ...DOMAINS[m.domain] };
  const n = clamp(Math.round(opts.n || 2000), 50, 20000);
  const seed = opts.seed ?? 42;
  const lens = ['ana_akim', 'elestirel', 'butunlesik'].includes(opts.lens) ? opts.lens : 'butunlesik';
  const cal = opts.calibration || {};
  const W = lensWeights(lens, { ...(cal.weights || {}), ...(opts.weights || {}) });
  const icpt = cal.intercepts || {};

  const pop = samplePopulation({ n, seed, marginals: opts.marginals, target: opts.target });
  if (!pop.length) throw new Error('hedef kitle tanımına uyan persona örneklenemedi');

  const active = THEORIES.filter((t) => W[t.id]);
  const contrib = Object.fromEntries(active.map((t) => [t.id, { exp: 0 }]));
  const people = [];

  // ---- 1. geçiş: kanal + birey ----
  for (const p of pop) {
    const f = features(p);
    const interest = clamp(dom.interest(f), 0, 1);
    const state = ZERO();
    const ctx = { p, f, m, inst: m.inst, dom, interest, state, channels: m.channels, CH: CHANNELS };

    // Kanal başı maruz kalma; çok kanal = gürültülü-VEYA birleşimi
    let miss = 1;
    const expByTheory = {};
    for (const c of m.channels) {
      const chan = CHANNELS[c];
      let e = icpt.exp || 0;
      for (const t of active) {
        if (t.asama !== 'kanal') continue;
        const d = t.apply({ ...ctx, chan });
        if (d?.exp) { e += W[t.id] * d.exp; expByTheory[t.id] = (expByTheory[t.id] || 0) + W[t.id] * d.exp / m.channels.length; }
        addDelta(state, { ...d, exp: 0 }, W[t.id] / m.channels.length, contrib, t.id);
      }
      miss *= 1 - sig(e);
    }
    let expLogit = Math.log(Math.max(1e-6, 1 - miss) / Math.max(1e-6, miss));
    for (const [tid, v] of Object.entries(expByTheory)) contrib[tid].exp += v;

    for (const t of active) {
      if (t.asama === 'kanal') continue;
      const d = t.apply(ctx);
      if (d?.exp) { expLogit += W[t.id] * d.exp; contrib[t.id].exp += W[t.id] * d.exp; }
      addDelta(state, d, W[t.id], contrib, t.id);
    }
    people.push({ p, f, state, expLogit, ctx });
  }

  // ---- nüfus toplamları (sosyal etkileşim kuramları için) ----
  const pre = people.map((x) => outcome(x.state, x.expLogit));
  const leaders = people.map((x, i) => [x, pre[i]]).filter(([x]) => x.f.leader);
  const mean = (arr, fn) => (arr.length ? arr.reduce((s, v) => s + fn(v), 0) / arr.length : 0);
  const agg = {
    leaderShare: mean(leaders, ([, o]) => o.exposed * o.attend * o.share),
    leaderAttitude: mean(leaders, ([, o]) => o.exposed * o.attend * o.attitude),
    climate: mean(pre, (o) => o.exposed * o.attend * o.attitude),
    earlyAdopt: mean(people.map((x, i) => [x, pre[i]]).filter(([x]) => x.f.innovativeness > 0.65), ([, o]) => o.exposed * o.adopt),
  };

  // ---- 2. geçiş ----
  const popFns = active.filter((t) => t.population).map((t) => [t, t.population(agg)]);
  for (const x of people) {
    for (const [t, fn] of popFns) {
      const d = fn(x.ctx);
      if (d?.exp) { x.expLogit += W[t.id] * d.exp; contrib[t.id].exp += W[t.id] * d.exp; }
      addDelta(x.state, d, W[t.id], contrib, t.id);
    }
    if (icpt.shift) x.state.shift += icpt.shift;
    if (icpt.share) x.state.share += icpt.share;
    if (icpt.adopt) x.state.adopt += icpt.adopt;
  }

  const outs = people.map((x) => outcome(x.state, x.expLogit));
  const summary = summarize(outs);

  // ---- bootstrap güven aralığı (örneklem belirsizliği) ----
  const B = clamp(opts.bootstrap ?? 120, 0, 1000);
  let ci = null;
  if (B > 0) {
    const r = rng((seed ^ 0x9e3779b9) >>> 0);
    const keys = ['erisim', 'ortalama_tutum', 'olumlu', 'paylasim', 'benimseme'];
    const samples = Object.fromEntries(keys.map((k) => [k, []]));
    for (let b = 0; b < B; b++) {
      const bs = new Array(outs.length);
      for (let i = 0; i < outs.length; i++) bs[i] = outs[(r() * outs.length) | 0];
      const s = summarize(bs, true);
      for (const k of keys) samples[k].push(s[k]);
    }
    ci = {};
    for (const k of keys) {
      const a = samples[k].sort((x, y) => x - y);
      ci[k] = [a[Math.floor(0.05 * (a.length - 1))], a[Math.ceil(0.95 * (a.length - 1))]];
    }
  }

  // ---- kuram katkıları (açıklanabilirlik) ----
  const N = people.length;
  const theories = active.map((t) => {
    const c = contrib[t.id];
    return {
      id: t.id, ad: t.ad, gelenek: t.gelenek, agirlik: W[t.id],
      erisim_etkisi: r3(c.exp / N), tutum_etkisi: r3((c.shift || 0) / N),
      paylasim_etkisi: r3((c.share || 0) / N), anlama_etkisi: r3((c.comp || 0) / N),
    };
  }).sort((a, b) => Math.abs(b.tutum_etkisi) + Math.abs(b.erisim_etkisi) - Math.abs(a.tutum_etkisi) - Math.abs(a.erisim_etkisi));

  // ---- segmentler ----
  const segBy = [].concat(opts.segmentBy || []).filter((k) => DIMENSIONS[k]);
  const segments = {};
  for (const k of segBy) {
    const groups = {};
    people.forEach((x, i) => { (groups[x.p[k]] ||= []).push(outs[i]); });
    segments[k] = Object.fromEntries(Object.entries(groups).map(([v, arr]) => {
      const s = summarize(arr);
      return [v, { n: arr.length, erisim: s.erisim_yuzde, tutum: s.ortalama_tutum, olumlu: s.olumlu_yuzde, paylasim: s.paylasim_yuzde, okuma: s.okuma }];
    }));
  }

  return {
    _people: opts.keepPeople ? people.map((x, i) => ({ persona: x.p, out: outs[i] })) : undefined,   // anket katmanı için
    mesaj: {
      alan: dom.label, cerceve: FRAMES[m.frame], kanallar: m.channels.map((c) => CHANNELS[c].label),
      kurum: m.inst.ad, durus: m.hegemonic > 0 ? 'egemen' : m.hegemonic < 0 ? 'karşı-hegemonik' : 'nötr',
    },
    cikarim: m.extraction || undefined,
    mercek: lens, n: N, tohum: seed,
    sonuc: { ...fmt(summary, ci), hall_okuma_yuzde: W.kodlama_kodacimlama ? summary.okuma : null },
    kuramlar: theories,
    segmentler: segBy.length ? segments : undefined,
    kalibre: !!(cal.weights || cal.intercepts),
    uyari: 'Kuram-temelli simülasyondur, gözlem değil. Gerçek kararlar için kurumun geçmiş verisiyle kalibre edin (audience_calibrate).',
  };
}

/** Kişi başı çıktılardan toplam göstergeler. */
function summarize(outs, raw = false) {
  const N = outs.length || 1;
  let reach = 0, att = 0, pos = 0, neg = 0, share = 0, comp = 0, adopt = 0, delib = 0;
  const dec = { egemen: 0, muzakereci: 0, karsit: 0 };
  for (const o of outs) {
    const engaged = o.exposed * o.attend;
    reach += o.exposed;
    att += engaged * o.attitude;
    if (o.attitude > 0.15) pos += engaged; else if (o.attitude < -0.15) neg += engaged;
    share += engaged * o.share;
    comp += engaged * o.comp;
    adopt += o.exposed * o.adopt;
    delib += engaged * o.delib;
    for (const k in dec) dec[k] += engaged * o.dec[k];
  }
  const s = {
    erisim: reach / N, ortalama_tutum: att / N, olumlu: pos / N, olumsuz: neg / N,
    paylasim: share / N, anlama: comp / N, benimseme: adopt / N, muzakere: delib / N,
  };
  if (raw) return s;
  const dz = dec.egemen + dec.muzakereci + dec.karsit || 1;
  return {
    ...s,
    erisim_yuzde: pct(s.erisim), olumlu_yuzde: pct(s.olumlu), paylasim_yuzde: pct(s.paylasim),
    okuma: { egemen: pct(dec.egemen / dz), muzakereci: pct(dec.muzakereci / dz), karsit: pct(dec.karsit / dz) },
  };
}

function fmt(s, ci) {
  const band = (k, f = pct) => (ci ? [f(ci[k][0]), f(ci[k][1])] : undefined);
  return {
    erisim_yuzde: s.erisim_yuzde, erisim_ga90: band('erisim'),
    ortalama_tutum: r3(s.ortalama_tutum), tutum_ga90: band('ortalama_tutum', r3),
    olumlu_yuzde: s.olumlu_yuzde, olumsuz_yuzde: pct(s.olumsuz), olumlu_ga90: band('olumlu'),
    paylasim_yuzde: s.paylasim_yuzde, paylasim_ga90: band('paylasim'),
    benimseme_yuzde: pct(s.benimseme), benimseme_ga90: band('benimseme'),
    anlama_yuzde: pct(s.anlama), muzakere_yuzde: pct(s.muzakere),
    hall_okuma_yuzde: s.okuma,
  };
}

/** Birden çok mesaj varyantını aynı nüfusta karşılaştırır (A/B öncesi sanal test). */
export function compare(messages, opts = {}, metric = 'ortalama_tutum') {
  if (!Array.isArray(messages) || messages.length < 2) throw new Error('karşılaştırma için en az 2 mesaj ver');
  const rows = messages.map((msg, i) => {
    const r = predict(msg, { ...opts, bootstrap: 0 });
    return { varyant: msg.ad || msg.name || `V${i + 1}`, ...r.mesaj, ...r.sonuc, _skor: r.sonuc[metric] ?? r.sonuc.ortalama_tutum };
  });
  rows.sort((a, b) => b._skor - a._skor);
  return { metrik: metric, kazanan: rows[0].varyant, siralama: rows.map(({ _skor, ...x }) => x) };
}

/** Çerçeve × kanal ızgarasında en iyi kombinasyonu arar (kurum için stratejik öneri). */
export function optimize(message, opts = {}, metric = 'ortalama_tutum') {
  const base = normalizeMessage(message);
  const frames = opts.frames || Object.keys(FRAMES);
  const chans = opts.channelSets || Object.keys(CHANNELS).map((c) => [c]);
  const out = [];
  for (const frame of frames) {
    for (const channels of chans) {
      const r = predict({ ...message, frame, channels }, { ...opts, n: Math.min(opts.n || 800, 1500), bootstrap: 0 });
      out.push({ cerceve: frame, kanallar: channels, skor: r.sonuc[metric], erisim: r.sonuc.erisim_yuzde, olumlu: r.sonuc.olumlu_yuzde, karsit_okuma: r.sonuc.hall_okuma_yuzde?.karsit ?? null });
    }
  }
  out.sort((a, b) => b.skor - a.skor);
  return { metrik: metric, alan: base.domain, kurum: base.inst.ad, en_iyi: out.slice(0, 5), en_kotu: out.slice(-3).reverse() };
}

export { DOMAINS, CHANNELS, FRAMES };
