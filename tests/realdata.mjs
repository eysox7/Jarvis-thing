// GERÇEK veri doğruluk testi: sentetik "gerçek model" yok — gerçek insanların gerçek kararları.
// Kaynak: Rdatasets (R paketleri carData, Ecdat, AER) — tests/data/real/*.csv
//   siyaset : BEPS (İngiltere seçim paneli 1997–2001, 1525 seçmen), Chile (1988 Pinochet plebisiti, 2700 seçmen)
//             ANES 2016 (ABD Ulusal Seçim Araştırması, 3610 seçmen; otoriterlik, din, güven, ideoloji) —
//             önce `python3 tests/data/fetch_anes.py` (ham veri repoya konmaz)
//   ticaret : Car (ABD otomobil satın alma tercihi, 4654 kişi; fiyat, yakıt, statü, menzil),
//             Heating (Kaliforniya ısıtma sistemi seçimi, 900 hane)
//   gündelik: TravelMode (Avustralya şehirlerarası ulaşım, 210 kişi), Mode (işe gidiş türü, 453 kişi)
// Kıyas (kişi düzeyinde 5 katlı çapraz doğrulama, görülmemiş veri):
//   çoğunluk   — herkese en sık seçenek
//   standart   — kuramsız koşullu logit: özellikler doğrusal + tüm kişi değişkenleri seçeneğe özgü
//   bütünleşik — kuram terimleri (ana akım + eleştirel + iletişim) + aynı kişi değişkenleri
// Çalıştır: node tests/realdata.mjs [veri_adı ...]

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseCSV } from '../js/decision/data.js';
import { crossValidate, fitChoiceModel, tuneDemoSigma, scoreProbs } from '../js/decision/estimate.js';
import { rowProbabilities, resolveChoice, KURAM_OLCEGI } from '../js/decision/model.js';
import { rng } from '../js/audience/personas.js';
import { DECISION_DOMAINS, ILETISIM_TERIMLERI } from '../js/decision/domains.js';

const DIR = new URL('./data/real/', import.meta.url), CACHE = new URL('./data/cache/', import.meta.url);
const fileOf = (n) => (existsSync(new URL(n + '.csv', DIR)) ? new URL(n + '.csv', DIR) : new URL(n + '.csv', CACHE));
const load = (n) => parseCSV(readFileSync(fileOf(n), 'utf8'));
const num = (v) => (v === '' || v === 'NA' || v === undefined ? NaN : Number(v));
const yasBand = (a) => (a < 25 ? '18-24' : a < 35 ? '25-34' : a < 45 ? '35-44' : a < 55 ? '45-54' : a < 65 ? '55-64' : '65+');
const tertile = (vals) => { const s = vals.filter(Number.isFinite).sort((x, y) => x - y); const t1 = s[Math.floor(s.length / 3)], t2 = s[Math.floor(2 * s.length / 3)]; return (v) => (!Number.isFinite(v) ? undefined : v <= t1 ? 'dusuk' : v <= t2 ? 'orta' : 'yuksek'); };
// Panel: aynı kişinin bir önceki seçimi (durum bağımlılığı)
function withPast(rows) { const last = {}; for (const r of rows) { if (last[r.kisi] !== undefined) r.p.onceki = last[r.kisi]; last[r.kisi] = r.secim; } return rows; }

const DATASETS = {
  BEPS() {
    const raw = load('BEPS');
    const id = { Labour: 'lab', Conservative: 'con', 'Liberal Democrat': 'lib' };
    const spec = { alan: 'siyaset', secenekler: [
      { id: 'lab', ad: 'İşçi Partisi', iktidar: true, ekonomi: -0.2, kultur: -0.2, kimlik: 'sol' },
      { id: 'con', ad: 'Muhafazakâr', ekonomi: 0.6, kultur: 0.55, kimlik: 'sag' },
      { id: 'lib', ad: 'Liberal Demokrat', ekonomi: -0.3, kultur: -0.55, kimlik: 'merkez' }] };
    const rows = raw.map((r, i) => ({
      kisi: i, w: 1, secim: id[r.vote],
      p: { yas: yasBand(num(r.age)), cinsiyet: r.gender === 'female' ? 'kadin' : 'erkek', bilissel_ihtiyac: num(r['political.knowledge']) >= 2 ? 'yuksek' : 'dusuk',
        ekonomi_algisi: (num(r['economic.cond.national']) - 3) / 2, hane_algisi: (num(r['economic.cond.household']) - 3) / 2,
        konum_kultur: (num(r.Europe) - 6) / 5 },
      ozel: { lab: { lider: (num(r.Blair) - 1) / 4 }, con: { lider: (num(r.Hague) - 1) / 4 }, lib: { lider: (num(r.Kennedy) - 1) / 4 } },
    }));
    return { spec, rows, attrs: ['lider'] };
  },
  Chile() {
    const raw = load('Chile').filter((r) => r.vote && r.vote !== 'NA' && Number.isFinite(num(r.statusquo)));
    const inc = tertile(raw.map((r) => num(r.income))), sq = tertile(raw.map((r) => num(r.statusquo)));
    const spec = { alan: 'siyaset', secenekler: [
      { id: 'Y', ad: 'Evet (Pinochet)', iktidar: true, ekonomi: 0.7, kultur: 0.7, kimlik: 'sag' },
      { id: 'N', ad: 'Hayır', ekonomi: -0.4, kultur: -0.4, kimlik: 'sol' },
      { id: 'U', ad: 'Kararsız', tur: 'kararsiz' },
      { id: 'A', ad: 'Oy kullanmama', tur: 'cekimser' }] };
    const rows = raw.map((r, i) => {
      const pop = num(r.population);
      return { kisi: i, w: 1, secim: r.vote, p: {
        yas: Number.isFinite(num(r.age)) ? yasBand(num(r.age)) : undefined, cinsiyet: r.sex === 'F' ? 'kadin' : 'erkek',
        egitim: { P: 'ilkokul', S: 'lise', PS: 'universite' }[r.education], gelir: inc(num(r.income)),
        yerlesim: pop < 25000 ? 'kirsal' : pop < 250000 ? 'kent' : 'metropol', bolge: r.region,
        kurumsal_guven: sq(num(r.statusquo)), konum_kultur: Math.max(-1, Math.min(1, num(r.statusquo) / 1.2)), konum_ekonomi: Math.max(-1, Math.min(1, num(r.statusquo) / 1.2)) } };
    }).map((r) => { for (const k of Object.keys(r.p)) if (r.p[k] === undefined) delete r.p[k]; return r; });
    return { spec, rows, attrs: [] };
  },
  ANES2016() { return anes(2016, true); },
  ANES2016_yapisal() { return anes(2016, false); },
  ANES2020() { return anes(2020, true); },
  ANES2020_yapisal() { return anes(2020, false); },
  Car() {
    const raw = load('Car');
    const alts = ['1', '2', '3', '4', '5', '6'];
    const yesil = { electric: 1, cng: 0.6, methanol: 0.4, gasoline: 0 };
    const spec = { alan: 'ticaret', secenekler: alts.map((a) => ({ id: a, ad: 'seçenek ' + a, fiyat: 4, isletme_maliyeti: 4 })) };
    const rows = raw.map((r, i) => ({ kisi: i, w: 1, secim: r.choice.replace('choice', ''),
      p: { egitim: r.college === '1' ? 'universite' : 'lise', hane: r.hsg2, kisa_yol: r.coml5 },
      ozel: Object.fromEntries(alts.map((a) => [a, { fiyat: num(r['price' + a]), isletme_maliyeti: num(r['cost' + a]), yesil: yesil[r['fuel' + a]] ?? 0,
        statu: r['type' + a] === 'sportcar' ? 1 : r['type' + a] === 'sportuv' ? 0.6 : 0, menzil: num(r['range' + a]), hizlanma: num(r['acc' + a]),
        hiz: num(r['speed' + a]), kirlilik: num(r['pollution' + a]), boyut: num(r['size' + a]), alan_ic: num(r['space' + a]), istasyon: num(r['station' + a]),
        van: r['type' + a] === 'van' ? 1 : 0, kamyonet: r['type' + a] === 'truck' ? 1 : 0, elektrik: r['fuel' + a] === 'electric' ? 1 : 0 }])) }));
    return { spec, rows, attrs: ['fiyat', 'isletme_maliyeti', 'yesil', 'statu', 'menzil', 'hizlanma', 'hiz', 'kirlilik', 'boyut', 'alan_ic', 'istasyon', 'van', 'kamyonet', 'elektrik'] };
  },
  Heating() {
    const raw = load('Heating');
    const alts = ['gc', 'gr', 'ec', 'er', 'hp'];
    const inc = tertile(raw.map((r) => num(r.income)));
    const spec = { alan: 'ticaret', secenekler: alts.map((a) => ({ id: a, ad: a, fiyat: 900, isletme_maliyeti: 300 })) };
    const rows = raw.map((r, i) => ({ kisi: i, w: 1, secim: r.depvar,
      p: { yas: yasBand(num(r.agehed)), gelir: inc(num(r.income)), bolge: r.region },
      ozel: Object.fromEntries(alts.map((a) => [a, { fiyat: num(r['ic.' + a]), isletme_maliyeti: num(r['oc.' + a]) }])) }));
    return { spec, rows, attrs: ['fiyat', 'isletme_maliyeti'] };
  },
  TravelMode() {
    const raw = load('TravelMode');
    const by = {};
    for (const r of raw) (by[r.individual] ||= []).push(r);
    const inc = tertile(Object.values(by).map((g) => num(g[0].income)));
    const alts = ['air', 'train', 'bus', 'car'];
    const spec = { alan: 'gundelik', secenekler: alts.map((a) => ({ id: a, ad: a, maliyet: 0.4, sure: 600 })) };
    const rows = Object.entries(by).map(([k, g]) => ({ kisi: k, w: 1, secim: g.find((r) => r.choice === 'yes').mode,
      p: { gelir: inc(num(g[0].income)), hane: Math.min(3, num(g[0].size)) },
      ozel: Object.fromEntries(g.map((r) => [r.mode, { maliyet: num(r.vcost) / 200, sure: num(r.travel) + num(r.wait) }])) }));
    return { spec, rows, attrs: ['maliyet', 'sure'] };
  },
  Mode() {
    const raw = load('Mode');
    const alts = ['car', 'carpool', 'bus', 'rail'];
    const spec = { alan: 'gundelik', secenekler: alts.map((a) => ({ id: a, ad: a, maliyet: 0.3, sure: 30 })) };
    const rows = raw.map((r, i) => ({ kisi: i, w: 1, secim: r.choice, p: {},
      ozel: Object.fromEntries(alts.map((a) => [a, { maliyet: num(r['cost.' + a]) / 8, sure: num(r['time.' + a]) }])) }));
    return { spec, rows, attrs: ['maliyet', 'sure'] };
  },
};


// ANES 2016 / 2020: Demokrat / Cumhuriyetçi / üçüncü aday / oy kullanmama (seçenek kimlikleri yıllar
// arasında ortak → bir seçimde öğrenip diğerinde tahmin edilebilir). İktidar 2016'da D, 2020'de R.
// tam: parti kimliği + aday termometreleri dahil; yapisal: yalnızca toplumsal yapı, değerler ve algılar
// (eleştirel kuramların asıl sınandığı model — "kim olduğun ve neye inandığın oyunu ne kadar belirler?")
export function anes(year, full) {
  const raw = load('ANES' + year);
  const inc = (v) => (!Number.isFinite(v) ? undefined : v <= 1 / 3 ? 'dusuk' : v <= 2 / 3 ? 'orta' : 'yuksek');
  const D = year === 2016, R = !D;
  const spec = { alan: 'siyaset', baglam: { ekonomi_algisi: D ? -0.1 : -0.3, iktidar_suresi_yil: D ? 8 : 4, medya_yanliligi: { sag_medya: { rep: 1, dem: -1 }, sol_medya: { dem: 1, rep: -1 } } }, secenekler: [
    { id: 'dem', ad: D ? 'Clinton (D)' : 'Biden (D)', iktidar: D, ekonomi: -0.4, kultur: -0.45, kimlik: 'sol' },
    { id: 'rep', ad: 'Trump (R)', iktidar: R, ekonomi: 0.35, kultur: 0.8, kimlik: 'sag', guclu_lider: 0.8, duzen_karsiti: D },
    { id: 'ucuncu', ad: 'Üçüncü aday', ekonomi: 0.2, kultur: -0.3, kimlik: 'merkez' },
    { id: 'oy_yok', ad: 'Oy kullanmadı', tur: 'cekimser' }] };
  const rows = raw.map((r, i) => {
    const ideo = num(r.ideoloji7), age = num(r.yas), tr = num(r.guven5), ek = num(r.ekonomi5), pid = num(r.parti7), au = num(r.otoriterlik);
    const p = {
      yas: age > 0 ? yasBand(age) : undefined, cinsiyet: r.cinsiyet || undefined, egitim: r.egitim || undefined, gelir: inc(num(r.gelir_yuzdelik)),
      ideoloji: ideo >= 1 && ideo <= 3 ? 'sol' : ideo >= 5 && ideo <= 7 ? 'sag' : ideo === 4 || ideo === 99 ? 'merkez' : undefined,
      dindarlik: r.dindarlik || undefined, azinlik_kimlik: r.beyaz === '1' ? 'hayir' : r.beyaz === '0' ? 'evet' : undefined,
      kurumsal_guven: tr >= 1 && tr <= 2 ? 'yuksek' : tr === 3 ? 'orta' : tr >= 4 ? 'dusuk' : undefined,
      ekonomi_algisi: ek >= 1 && ek <= 5 ? (3 - ek) / 2 : undefined,
      otoriterlik: Number.isFinite(au) ? Math.round(au * 8) / 8 : undefined,
      // Siyasete dikkat → bilişsel ihtiyaç (ELM merkezî yol; Habermas'ın akılcı-eleştirel kamusu)
      bilissel_ihtiyac: num(r.ilgi5) >= 1 && num(r.ilgi5) <= 2 ? 'yuksek' : num(r.ilgi5) >= 3 ? 'dusuk' : undefined,
    };
    // Herman & Chomsky: kişinin izlediği partizan medya (yanlılık bağlamda tanımlı)
    const ms = num(r.medya_sag), ml = num(r.medya_sol);
    if (Number.isFinite(ms) && Number.isFinite(ml)) p.medya_kaynagi = ms > ml ? 'sag_medya' : ml > ms ? 'sol_medya' : 'notr_medya';
    if (full && pid >= 1 && pid <= 7) p.parti_kimligi = (pid - 4) / 3;
    for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
    const row = { kisi: year + '-' + i, w: 1, secim: r.secim, p };
    if (full) {
      const td = num(r.term_dem), tp = num(r.term_rep);
      row.ozel = { dem: Number.isFinite(td) ? { lider: td / 100 } : {}, rep: Number.isFinite(tp) ? { lider: tp / 100 } : {} };
    }
    return row;
  });
  return { spec, rows, attrs: full ? ['lider'] : [] };
}

// Kuramsız temel model: her sayısal özellik için tek katsayılı doğrusal terim (standart koşullu logit)
function plainDomain(base, attrs, rows) {
  const scale = {};
  for (const k of attrs) { const v = rows.flatMap((r) => Object.values(r.ozel || {}).map((o) => o[k])).filter(Number.isFinite); const m = v.reduce((a, b) => a + b, 0) / v.length; scale[k] = { m, s: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1 }; }
  return { ...base, id: 'ham_' + base.id, hazirla: undefined,
    terimler: attrs.map((k) => ({ id: 'lin_' + k, ad: k, kuram: '—', onsel: 0, sd: scale[k].s, z: (f, p, a) => (a[k] === undefined ? 0 : (Number(a[k]) - scale[k].m) / scale[k].s) })) };
}

const COMM = ILETISIM_TERIMLERI.map((t) => t.id);
const ELESTIREL = ['otoriter_dinamik', 'muzakere', 'medya_yanliligi', 'arac', 'cinsiyet_acigi', 'kultur_endustrisi', 'arama_maliyeti', 'kulturel_sermaye', 'gosteris', 'reklam_teshir', 'risk_toplumu', 'otoriteye_uyum', 'bakim_yuku'];
const args = process.argv.slice(2);
const cleanRows = (rows) => rows.filter((r) => r.secim && Object.values(r.ozel || {}).every((o) => Object.values(o).every((v) => typeof v !== 'number' || Number.isFinite(v))));

// Öğrenme eğrisi: az veriyle (n kişi) eğit, kalanında sına. Kuram öncülünün değeri az veride ortaya çıkar.
if (args[0] === '--egri') {
  const sizes = [0, 50, 100, 200, 400, 800, 1600];
  for (const name of args.slice(1)) {
    const { spec, rows, attrs } = DATASETS[name]();
    const clean = cleanRows(rows);
    DECISION_DOMAINS.__ham = plainDomain(DECISION_DOMAINS[spec.alan], attrs, clean);
    const serbest = Object.fromEntries(attrs.map((k) => [k, DECISION_DOMAINS.__ham.terimler.find((t) => t.id === 'lin_' + k).sd]));
    const ids = resolveChoice(spec).alts.map((a) => a.id);
    console.log(`\n${name} (n=${clean.length}) — test isabeti %, 3 tekrar ortalaması`);
    console.log('eğitim n | çoğunluk | standart | bütünleşik | eleştirelsiz');
    for (const n of sizes) {
      const acc = { c: [], s: [], b: [], e: [] };
      for (let rep = 0; rep < 3; rep++) {
        const r = rng(100 + rep * 7 + n), idx = clean.map((_, i) => i);
        for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
        const train = idx.slice(0, n).map((i) => clean[i]), test = idx.slice(-Math.min(1500, clean.length - n)).map((i) => clean[i]);
        const score = (sp, model) => scoreProbs(rowProbabilities(sp, model, test).map((x, i) => ({ P: x.P, y: ids.indexOf(test[i].secim), w: 1 }))).isabet_yuzde;
        const counts = {}; for (const t of train) counts[t.secim] = (counts[t.secim] || 0) + 1;
        const maj = n ? ids.reduce((a, b) => ((counts[a] || 0) >= (counts[b] || 0) ? a : b)) : null;
        acc.c.push(n ? test.filter((t) => t.secim === maj).length / test.length * 100 : NaN);
        const fit = (sp, o) => { if (n < 10) return {}; const sg = n >= 100 ? tuneDemoSigma(sp, train, o) : 0; return fitChoiceModel(sp, train, { ...o, demoSigma: sg, iters: 250 }); };
        const hs = { ...spec, alan: '__ham' };
        acc.s.push(n < 10 ? NaN : score(hs, fit(hs, { haric: [...COMM, 'gecmis'], kuramGuveni: 3 })));
        const bs = { ...spec, serbest };
        acc.b.push(score(bs, fit(bs, {})));
        acc.e.push(score(bs, fit(bs, { haric: ELESTIREL })));
      }
      const m = (a) => (a.every(Number.isNaN) ? '  —  ' : (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1).padStart(5));
      console.log(`${String(n).padStart(8)} | ${m(acc.c)}    | ${m(acc.s)}    | ${m(acc.b)}      | ${m(acc.e)}`);
    }
    delete DECISION_DOMAINS.__ham;
  }
  process.exit(0);
}
// Seçimler arası geçerlilik: bir seçimde öğren, diğer seçimi (farklı iktidar, farklı aday) tahmin et.
if (args[0] === '--secimler') {
  const COMBOS = [[2016, 2020], [2020, 2016]];
  for (const full of [false, true]) for (const [ya, yb] of COMBOS) {
    const A = anes(ya, full), B = anes(yb, full);
    const tr = cleanRows(A.rows), te = cleanRows(B.rows);
    DECISION_DOMAINS.__ham = plainDomain(DECISION_DOMAINS.siyaset, A.attrs, tr);
    const serbest = Object.fromEntries(A.attrs.map((k) => [k, DECISION_DOMAINS.__ham.terimler.find((t) => t.id === 'lin_' + k).sd]));
    const ids = ['dem', 'rep', 'ucuncu', 'oy_yok'];
    const sc = (specB, model) => scoreProbs(rowProbabilities(specB, model, te).map((x, i) => ({ P: x.P, y: ids.indexOf(te[i].secim), w: 1 })));
    const fit = (sp, o) => fitChoiceModel(sp, tr, { ...o, demoSigma: tuneDemoSigma(sp, tr, o), iters: 300 });
    const std = sc({ ...B.spec, alan: '__ham' }, fit({ ...A.spec, alan: '__ham' }, { haric: [...COMM, 'gecmis'], kuramGuveni: 3 }));
    const but = sc({ ...B.spec, serbest }, fit({ ...A.spec, serbest }, {}));
    const ele = sc({ ...B.spec, serbest }, fit({ ...A.spec, serbest }, { haric: ELESTIREL }));
    const cnt = {}; for (const t of tr) cnt[t.secim] = (cnt[t.secim] || 0) + 1; const maj = ids.reduce((a, b) => ((cnt[a] || 0) >= (cnt[b] || 0) ? a : b));
    console.log(`${full ? 'tam    ' : 'yapısal'} ${ya}→${yb}: çoğunluk ${(te.filter((t) => t.secim === maj).length / te.length * 100).toFixed(1)}% | standart ${std.isabet_yuzde}% (ll ${std.log_kayip}) | bütünleşik ${but.isabet_yuzde}% (ll ${but.log_kayip}) | eleştirelsiz ${ele.isabet_yuzde}% (ll ${ele.log_kayip})`);
    delete DECISION_DOMAINS.__ham;
  }
  process.exit(0);
}
// Sıfır bireysel veri: yalnızca kuram öncülleri + seçimin TOPLAM sonucu (sabitler toplam paylara
// oturtulur). Kurumun elinde anket yokken, kamuya açık sonuçla kişi düzeyinde ne kadar isabet edilir?
if (args[0] === '--sifir') {
  for (const y of [2016, 2020]) for (const full of [false, true]) {
    const { spec, rows } = anes(y, full); const te = cleanRows(rows);
    const ids = ['dem', 'rep', 'ucuncu', 'oy_yok'];
    const target = ids.map((id) => te.filter((t) => t.secim === id).length / te.length);
    const model = { asc: {}, kuram_olcegi: KURAM_OLCEGI };   // yalnız kuram, toplam paylara oturtulmuş
    for (let it = 0; it < 40; it++) {
      const P = rowProbabilities(spec, model, te), mean = ids.map((_, j) => P.reduce((a, x) => a + x.P[j], 0) / P.length);
      ids.forEach((id, j) => { model.asc[id] = (model.asc[id] || 0) + Math.log(target[j] / mean[j]); });
    }
    const r = scoreProbs(rowProbabilities(spec, model, te).map((x, i) => ({ P: x.P, y: ids.indexOf(te[i].secim), w: 1 })));
    console.log(`${y} ${full ? 'tam    ' : 'yapısal'}: çoğunluk ${(Math.max(...target) * 100).toFixed(1)}% | yalnız kuram + toplam sonuç ${r.isabet_yuzde}% (ll ${r.log_kayip})`);
  }
  process.exit(0);
}
if (args[0] === '--katsayi') {
  const { spec, rows, attrs } = DATASETS[args[1]]();
  const { learn } = await import('../js/decision/estimate.js');
  const m = learn(spec, cleanRows(rows), { demoSigma: 0.25 });
  const th = m.theta || m.model?.theta || {};
  const se = m.belirsizlik?.theta_se || m.model?.belirsizlik?.theta_se || {};
  for (const [k, v] of Object.entries(th)) console.log(k.padEnd(22), v.toFixed(2), se[k] !== undefined ? '± ' + (1.96 * se[k]).toFixed(2) : '');
  process.exit(0);
}
const only = args;
const out = [];
const t0 = Date.now();
for (const [name, mk] of Object.entries(DATASETS)) {
  if (only.length && !only.includes(name)) continue;
  if (!existsSync(fileOf(name.split('_')[0]))) { console.log(`- ${name}: dosya yok, atlandı`); continue; }
  const { spec, rows, attrs } = mk();
  const clean = cleanRows(rows);
  const base = DECISION_DOMAINS[spec.alan];
  DECISION_DOMAINS.__ham = plainDomain(base, attrs, clean);
  const cvO = { k: 5, seed: 3, demoSigma: 'oto' };
  const std = crossValidate({ ...spec, alan: '__ham' }, clean, { ...cvO, haric: [...COMM, 'gecmis'], kuramGuveni: 3 });
  // Hibrit: kuramın kapsamadığı ölçülmüş özellikler serbest terim olarak da girer (ölçek = std. sapma)
  const serbest = Object.fromEntries(attrs.map((k) => [k, DECISION_DOMAINS.__ham.terimler.find((t) => t.id === 'lin_' + k).sd]));
  const but = crossValidate(process.env.SERBEST === '0' ? spec : { ...spec, serbest }, clean, { ...cvO, kuramGuveni: Number(process.env.KG || 1) });
  delete DECISION_DOMAINS.__ham;
  const res = { veri: name, alan: spec.alan, n: clean.length,
    cogunluk: std.cogunluk_isabet_yuzde, standart: std.isabet_yuzde, butunlesik: but.isabet_yuzde,
    ll_cogunluk: std.cogunluk_log_kayip, ll_standart: std.log_kayip, ll_butunlesik: but.log_kayip, ece_butunlesik: but.ece };
  out.push(res);
  console.log(`${name.padEnd(11)} ${spec.alan.padEnd(9)} n=${String(clean.length).padEnd(5)} isabet: çoğunluk ${res.cogunluk}% | standart ${res.standart}% | bütünleşik ${res.butunlesik}%   log-kayıp: ${res.ll_cogunluk} | ${res.ll_standart} | ${res.ll_butunlesik}`);
}
const avg = (k) => Math.round(out.reduce((s, r) => s + r[k], 0) / out.length * 10) / 10;
if (out.length) console.log(`ORTALAMA isabet: çoğunluk ${avg('cogunluk')}% | standart ${avg('standart')}% | bütünleşik ${avg('butunlesik')}%   (${((Date.now() - t0) / 1000).toFixed(0)} sn)`);
try { mkdirSync(new URL('../reports/', import.meta.url), { recursive: true }); writeFileSync(new URL('../reports/realdata.json', import.meta.url), JSON.stringify(out, null, 2)); } catch {}
