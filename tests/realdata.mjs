// GERÇEK veri doğruluk testi: sentetik "gerçek model" yok — gerçek insanların gerçek kararları.
// Kaynak: Rdatasets (R paketleri carData, Ecdat, AER) — tests/data/real/*.csv
//   siyaset : BEPS (İngiltere seçim paneli 1997–2001, 1525 seçmen), Chile (1988 Pinochet plebisiti, 2700 seçmen)
//   ticaret : Cracker (kraker marka paneli, 3292 alım), Yogurt (yoğurt marka paneli, 2412 alım),
//             Heating (Kaliforniya ısıtma sistemi seçimi, 900 hane)
//   gündelik: TravelMode (Avustralya şehirlerarası ulaşım, 210 kişi), Mode (işe gidiş türü, 453 kişi)
// Kıyas (kişi düzeyinde 5 katlı çapraz doğrulama, görülmemiş veri):
//   çoğunluk   — herkese en sık seçenek
//   standart   — kuramsız koşullu logit: özellikler doğrusal + tüm kişi değişkenleri seçeneğe özgü
//   bütünleşik — kuram terimleri (ana akım + eleştirel + iletişim) + aynı kişi değişkenleri
// Çalıştır: node tests/realdata.mjs [veri_adı ...]

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseCSV } from '../js/decision/data.js';
import { crossValidate } from '../js/decision/estimate.js';
import { DECISION_DOMAINS, ILETISIM_TERIMLERI } from '../js/decision/domains.js';

const DIR = new URL('./data/real/', import.meta.url);
const load = (n) => parseCSV(readFileSync(new URL(n + '.csv', DIR), 'utf8'));
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
  Cracker() { return brandPanel('Cracker', ['sunshine', 'kleebler', 'nabisco', 'private'], true); },
  Yogurt() { return brandPanel('Yogurt', ['yoplait', 'dannon', 'hiland', 'weight'], false); },
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

function brandPanel(name, alts, hasDisp) {
  const raw = load(name);
  const spec = { alan: 'ticaret', secenekler: alts.map((a) => ({ id: a, ad: a, fiyat: 100, reklam: 0, teshir: 0 })) };
  const rows = withPast(raw.map((r) => ({ kisi: r.id, w: 1, secim: r.choice, p: {},
    ozel: Object.fromEntries(alts.map((a) => [a, { fiyat: num(r['price.' + a]), reklam: num(r['feat.' + a]), teshir: hasDisp ? num(r['disp.' + a]) : 0 }])) })));
  return { spec, rows, attrs: hasDisp ? ['fiyat', 'reklam', 'teshir'] : ['fiyat', 'reklam'] };
}

// Kuramsız temel model: her sayısal özellik için tek katsayılı doğrusal terim (standart koşullu logit)
function plainDomain(base, attrs, rows) {
  const scale = {};
  for (const k of attrs) { const v = rows.flatMap((r) => Object.values(r.ozel || {}).map((o) => o[k])).filter(Number.isFinite); const m = v.reduce((a, b) => a + b, 0) / v.length; scale[k] = { m, s: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1 }; }
  return { ...base, id: 'ham_' + base.id, hazirla: undefined,
    terimler: attrs.map((k) => ({ id: 'lin_' + k, ad: k, kuram: '—', onsel: 0, sd: scale[k].s, z: (f, p, a) => (a[k] === undefined ? 0 : (Number(a[k]) - scale[k].m) / scale[k].s) })) };
}

const COMM = ILETISIM_TERIMLERI.map((t) => t.id);
const only = process.argv.slice(2);
const out = [];
const t0 = Date.now();
for (const [name, mk] of Object.entries(DATASETS)) {
  if (only.length && !only.includes(name)) continue;
  if (!existsSync(new URL(name + '.csv', DIR))) { console.log(`- ${name}: dosya yok, atlandı`); continue; }
  const { spec, rows, attrs } = mk();
  const clean = rows.filter((r) => r.secim && Object.values(r.ozel || {}).every((o) => Object.values(o).every((v) => typeof v !== 'number' || Number.isFinite(v))));
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
