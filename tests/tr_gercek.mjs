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
console.log('3) Sentetik hane nüfusunda öğren → gerçek 2018 seçmenini tahmin et (ortak sütunlar)');
{
  const ORTAK = ['yas', 'cinsiyet', 'egitim', 'gelir', 'dindarlik', 'ideoloji', 'yerlesim', 'etnik_koken', 'azinlik_kimlik', 'ekonomi_algisi', 'kurumsal_guven', 'siyasi_ilgi'];
  const B = trGercek(2018, false), S = sentetikTR('oykusuz', 'hane');
  const keep = (rows) => rows.map((r) => ({ ...r, p: Object.fromEntries(Object.entries(r.p).filter(([k]) => ORTAK.includes(k))) }));
  const tr = keep(S.rows), te = keep(B.rows);
  const spec = { ...B.spec, baglam: { ...B.spec.baglam } }; delete spec.baglam.bolge_paylari;   // sentetikte NUTS bölgesi yok
  DECISION_DOMAINS.__ham = ham(spec);
  const hs = { ...spec, alan: '__ham' };
  const mS = fit(hs, tr, { haric: STD, kuramGuveni: 3 }), mB = fit(spec, tr);
  const z = sc(spec, calib(spec, { asc: {}, kuram_olcegi: KURAM_OLCEGI }, te), te);
  const sC = sc(hs, calib(hs, mS, te), te), bC = sc(spec, calib(spec, mB, te), te);
  console.log(`  yalnız kuram (veri yok) ${z.isabet_yuzde}% (ll ${z.log_kayip}) | sentetikte öğrenilmiş + gerçek toplama kalibre: standart ${sC.isabet_yuzde}% (ll ${sC.log_kayip}) / bütünleşik ${bC.isabet_yuzde}% (ll ${bC.log_kayip})`);
  delete DECISION_DOMAINS.__ham;
}
