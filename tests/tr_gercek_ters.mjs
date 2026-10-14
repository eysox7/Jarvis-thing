process.argv.splice(2, process.argv.length, '--yukle');
const R = new URL('../', import.meta.url).pathname;   // sağlamlık: ters bölünme (B'ye kalibre → A'da sına); önce HEDEF_YARI=B node tests/data/hane_kalibre.mjs
const { trGercek, sentetikTR } = await import(R + 'tests/realdata.mjs');
const { fitChoiceModel, tuneDemoSigma, scoreProbs } = await import(R + 'js/decision/estimate.js');
const { rowProbabilities, KURAM_OLCEGI } = await import(R + 'js/decision/model.js');
const { parseCSV, prepareRows } = await import(R + 'js/decision/data.js');
const { readFileSync } = await import('node:fs');
const ORTAK = ['yas', 'cinsiyet', 'egitim', 'gelir', 'dindarlik', 'ideoloji', 'yerlesim', 'etnik_koken', 'azinlik_kimlik', 'ekonomi_algisi', 'kurumsal_guven', 'siyasi_ilgi'];
const keep = (rows) => rows.map((r) => ({ ...r, p: Object.fromEntries(Object.entries(r.p).filter(([k]) => ORTAK.includes(k))) }));
const yarim = (k) => Number(String(k).split('-')[1]) % 2 === 0 ? 'A' : 'B';
const G = trGercek(2018, false), spec = { ...G.spec, baglam: { ...G.spec.baglam } }; delete spec.baglam.bolge_paylari;
const all = keep(G.rows), te = all.filter((r) => yarim(r.kisi) === 'A'), trB = all.filter((r) => yarim(r.kisi) === 'B');
const ids = spec.secenekler.map((a) => a.id), T = ids.map((id) => te.filter((t) => t.secim === id).length / te.length);
const sc = (m) => scoreProbs(rowProbabilities(spec, m, te).map((x, i) => ({ P: x.P, y: ids.indexOf(te[i].secim), w: 1 })));
const calib = (model) => { const mm = { ...model, asc: { ...(model.asc || {}) } }; for (let it = 0; it < 40; it++) { const P = rowProbabilities(spec, mm, te); ids.forEach((id, j) => { const m = P.reduce((a, x) => a + x.P[j], 0) / P.length; mm.asc[id] = (mm.asc[id] || 0) + Math.log(T[j] / m); }); } return mm; };
const fit = (tr) => fitChoiceModel(spec, tr, { demoSigma: tuneDemoSigma(spec, tr, {}), iters: 300 });
// hane_kal_B'yi d2018 görünümüyle yükle (sentetikTR yalnız 'hane'/'hane_kal' tanıyor → doğrudan)
const DON = ['ekonomi_algisi', 'hane_algisi', 'tehdit_algisi', 'is_kaybi', 'borc_yuku', 'deprem_maruziyeti'];
const yukle = (d) => keep(prepareRows(parseCSV(readFileSync(R + `tests/data/sentetik/${d}/TR_hane_secmen.csv`, 'utf8')).map(({ hane, ...r }) => { const o = { ...r }; for (const k of DON) o[k] = r[k + '_2018']; o.secim = r.onceki; return o; }), spec).rows);
const synB = yukle('hane_kal_B'), synA = keep(sentetikTR('d2018', 'hane').rows);
const f = (r) => `${r.isabet_yuzde}% (ll ${r.log_kayip})`;
console.log(`ters bölünme: B'ye kalibre, A'da (n=${te.length}) sına`);
console.log('  yalnız kuram', f(sc(calib({ asc: {}, kuram_olcegi: KURAM_OLCEGI }))));
console.log('  kalibrasyonsuz sentetik', f(sc(calib(fit(synA)))));
console.log('  B-kalibre sentetik', f(sc(calib(fit(synB)))));
try { console.log('  B-kalibre + il kalibre sentetik (YSK 2023)', f(sc(calib(fit(yukle('hane_kal_B_il')))))); } catch (e) { console.log('  hane_kal_B_il yok (KAYNAK=hane_kal_B node tests/data/hane_il_kalibre.mjs)'); }
console.log('  gerçek B yarısında öğrenilmiş', f(sc(calib(fit(trB)))));
const { rng } = await import(R + 'js/audience/personas.js');
for (const n of [50, 100, 200]) {
  const acc = { g: [], s: [] };
  for (let rep = 0; rep < 3; rep++) {
    const r = rng(500 + rep * 13 + n), idx = trB.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const real = idx.slice(0, n).map((i) => trB[i]), w = Math.min(1, 2 * n / synB.length);
    acc.g.push(sc(calib(fit(real))).isabet_yuzde); acc.s.push(sc(calib(fit([...synB.map((x) => ({ ...x, w })), ...real]))).isabet_yuzde);
  }
  const m = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
  console.log(`  n=${n}: yalnız gerçek ${m(acc.g)}% | gerçek + B-kalibre sentetik ${m(acc.s)}%`);
}
