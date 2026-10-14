// Gerçek Türkiye verisinde (CSES 2015, 2018) kuramın sınandığı üç durum:
//  1) hiç bireysel veri yok: yalnız kuram + seçimin gerçek toplam sonucu
//  2) seçimler arası aktarım: 2015'te öğren → 2018'i tahmin et (ve tersi); iktidar bloğu ve milliyetçi parti değişir
//  3) sentetik → gerçek: hane temelli sentetik nüfusta öğren → gerçek 2018 seçmenini tahmin et (ortak sütunlarla)
// Çalıştır: node tests/tr_gercek.mjs   (önce python3 tests/data/fetch_cses_tr.py)
process.argv.splice(2, process.argv.length, '--yukle');
const { trGercek, sentetikTR } = await import('./realdata.mjs');
const { fitChoiceModel, tuneDemoSigma, scoreProbs } = await import('../js/decision/estimate.js');
const { rowProbabilities, KURAM_OLCEGI } = await import('../js/decision/model.js');
const { DECISION_DOMAINS } = await import('../js/decision/domains.js');
const ids = ['iktidar', 'ana_muhalefet', 'milliyetci', 'kurt_sol', 'oy_yok'];
const sc = (spec, model, te) => scoreProbs(rowProbabilities(spec, model, te).map((x, i) => ({ P: x.P, y: ids.indexOf(te[i].secim), w: 1 })));
const target = (te) => ids.map((id) => te.filter((t) => t.secim === id).length / te.length);
const calib = (spec, model, te) => { const mm = { ...model, asc: { ...(model.asc || {}) } }; const T = target(te); for (let it = 0; it < 40; it++) { const P = rowProbabilities(spec, mm, te); ids.forEach((id, j) => { const m = P.reduce((a, x) => a + x.P[j], 0) / P.length; mm.asc[id] = (mm.asc[id] || 0) + Math.log(T[j] / m); }); } return mm; };
const fit = (sp, tr, o = {}) => fitChoiceModel(sp, tr, { ...o, demoSigma: tuneDemoSigma(sp, tr, o), iters: 300 });
const STD = ['iletisim_maruziyet', 'reklam_teshir', 'iletisim_tutum', 'hall_okuma', 'gecmis', 'aile', 'ag', 'topluluk', 'silikon'];
const ham = (spec) => ({ ...DECISION_DOMAINS[spec.alan], id: 'ham_siyaset', hazirla: undefined, terimler: [] });
const r1 = (x) => x.toFixed(1);

console.log('1) Hiç bireysel veri yok — yalnız kuram + gerçek toplam sonuç');
for (const y of [2015, 2018]) for (const tam of [false, true]) {
  const { spec, rows } = trGercek(y, tam);
  const r = sc(spec, calib(spec, { asc: {}, kuram_olcegi: KURAM_OLCEGI }, rows), rows);
  console.log(`  ${y} ${tam ? 'tam    ' : 'yapısal'}: çoğunluk ${r1(Math.max(...target(rows)) * 100)}% | kuram ${r.isabet_yuzde}% (ll ${r.log_kayip})`);
}
console.log('2) Seçimler arası aktarım (kuramsız standart | bütünleşik; + hedefin toplam payına kalibre)');
for (const tam of [false, true]) for (const [ya, yb] of [[2015, 2018], [2018, 2015]]) {
  const A = trGercek(ya, tam), B = trGercek(yb, tam);
  DECISION_DOMAINS.__ham = ham(A.spec);
  const hsA = { ...A.spec, alan: '__ham' }, hsB = { ...B.spec, alan: '__ham' };
  const mS = fit(hsA, A.rows, { haric: STD, kuramGuveni: 3 }), mB = fit(A.spec, A.rows);
  const s = sc(hsB, mS, B.rows), b = sc(B.spec, mB, B.rows), sC = sc(hsB, calib(hsB, mS, B.rows), B.rows), bC = sc(B.spec, calib(B.spec, mB, B.rows), B.rows);
  console.log(`  ${tam ? 'tam    ' : 'yapısal'} ${ya}→${yb}: standart ${s.isabet_yuzde}% (ll ${s.log_kayip}) | bütünleşik ${b.isabet_yuzde}% (ll ${b.log_kayip}) | kalibre: ${sC.isabet_yuzde}% / ${bC.isabet_yuzde}%`);
  delete DECISION_DOMAINS.__ham;
}
console.log('3) Sentetikte öğren → gerçek 2018 seçmenini tahmin et (ortak sütunlar; sınama = CSES 2018 B yarısı)');
{
  const ORTAK = ['yas', 'cinsiyet', 'egitim', 'gelir', 'dindarlik', 'ideoloji', 'yerlesim', 'etnik_koken', 'azinlik_kimlik', 'ekonomi_algisi', 'kurumsal_guven', 'siyasi_ilgi'];
  const yarim = (k) => Number(String(k).split('-')[1]) % 2 === 0 ? 'A' : 'B';
  const B = trGercek(2018, false);
  const keep = (rows) => rows.map((r) => ({ ...r, p: Object.fromEntries(Object.entries(r.p).filter(([k]) => ORTAK.includes(k))) }));
  const teAll = keep(B.rows), te = teAll.filter((r) => yarim(r.kisi) === 'B'), trA = teAll.filter((r) => yarim(r.kisi) === 'A');
  const spec = { ...B.spec, baglam: { ...B.spec.baglam } }; delete spec.baglam.bolge_paylari;   // sentetikte NUTS bölgesi yok
  DECISION_DOMAINS.__ham = ham(spec);
  const hs = { ...spec, alan: '__ham' };
  const z = sc(spec, calib(spec, { asc: {}, kuram_olcegi: KURAM_OLCEGI }, te), te);
  console.log(`  B yarısı n=${te.length}; yalnız kuram (veri yok) ${z.isabet_yuzde}% (ll ${z.log_kayip})`);
  const run = (ad, tr) => { const mS = fit(hs, tr, { haric: STD, kuramGuveni: 3 }), mB = fit(spec, tr); const sC = sc(hs, calib(hs, mS, te), te), bC = sc(spec, calib(spec, mB, te), te);
    console.log(`  ${ad.padEnd(38)} + gerçek toplama kalibre: standart ${sC.isabet_yuzde}% (ll ${sC.log_kayip}) / bütünleşik ${bC.isabet_yuzde}% (ll ${bC.log_kayip})`); };
  for (const k of ['hane', 'hane_kal']) { try { run(`sentetik ${k} (2018 oyu, n=${sentetikTR('d2018', k).rows.length})`, keep(sentetikTR('d2018', k).rows)); } catch (e) { console.log('  ' + k + ': ' + e.message); } }
  run(`gerçek A yarısında öğrenilmiş (n=${trA.length}, üst sınır)`, trA);
  delete DECISION_DOMAINS.__ham;
}
console.log('4) Az gerçek veri + kalibre sentetik aileler (sınama = CSES 2018 B yarısı; A yarısından n kişi, 3 tekrar)');
{
  const { rng } = await import('../js/audience/personas.js');
  const ORTAK = ['yas', 'cinsiyet', 'egitim', 'gelir', 'dindarlik', 'ideoloji', 'yerlesim', 'etnik_koken', 'azinlik_kimlik', 'ekonomi_algisi', 'kurumsal_guven', 'siyasi_ilgi'];
  const yarim = (k) => Number(String(k).split('-')[1]) % 2 === 0 ? 'A' : 'B';
  const B = trGercek(2018, false);
  const keep = (rows) => rows.map((r) => ({ ...r, p: Object.fromEntries(Object.entries(r.p).filter(([k]) => ORTAK.includes(k))) }));
  const all = keep(B.rows), te = all.filter((r) => yarim(r.kisi) === 'B'), A = all.filter((r) => yarim(r.kisi) === 'A');
  const spec = { ...B.spec, baglam: { ...B.spec.baglam } }; delete spec.baglam.bolge_paylari;
  const syn = keep(sentetikTR('d2018', 'hane_kal').rows);
  const fitN = (tr) => fitChoiceModel(spec, tr, { demoSigma: tuneDemoSigma(spec, tr, {}), iters: 300 });
  for (const n of [50, 100, 200]) {
    const acc = { g: [], s: [] };
    for (let rep = 0; rep < 3; rep++) {
      const r = rng(500 + rep * 13 + n), idx = A.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const real = idx.slice(0, n).map((i) => A[i]);
      acc.g.push(sc(spec, calib(spec, fitN(real), te), te).isabet_yuzde);
      // sentetik satırlar düşük ağırlıkla (toplam ağırlığı gerçek verinin ~2 katı) + gerçek satırlar tam ağırlık
      const w = Math.min(1, 2 * n / syn.length);
      acc.s.push(sc(spec, calib(spec, fitN([...syn.map((x) => ({ ...x, w })), ...real]), te), te).isabet_yuzde);
    }
    const m = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
    console.log(`  n=${n}: yalnız gerçek ${m(acc.g)}% | gerçek + kalibre sentetik ${m(acc.s)}%`);
  }
}
