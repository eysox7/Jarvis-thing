// Karar tahmin motoru: kuram-temelli çok terimli logit (tarayıcısız).
import { predictChoice, whatIf, resolveChoice, rowProbabilities } from '../js/decision/model.js';
import { simulateDataset, parseCSV, prepareRows, mapValue } from '../js/decision/data.js';
import { fitChoiceModel, crossValidate, scoreProbs, calibrateShares, learn, rake, shareDiagnostics, fitLatentClass } from '../js/decision/estimate.js';
import { buildEnsemble, stackWeights, siliconProbs, mixShares, siliconSecondOpinion } from '../js/decision/ensemble.js';
import { aggregatePolls } from '../js/decision/polls.js';
import { describePersona } from '../js/audience/survey.js';

const fails = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✖ ') + m); if (!c) fails.push(m); };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const O = { n: 1200, explain: false };

export const SECIM = { alan: 'siyaset', baglam: { ekonomi_algisi: -0.3 }, secenekler: [
  { id: 'A', ad: 'İktidar (sağ-muhafazakâr)', ekonomi: 0.4, kultur: 0.7, kimlik: 'sag', iktidar: true, lider: 0.6, anket: 0.4 },
  { id: 'B', ad: 'Ana muhalefet (merkez sol)', ekonomi: -0.4, kultur: -0.4, kimlik: 'sol', lider: 0.5, anket: 0.3 },
  { id: 'C', ad: 'Milliyetçi sağ', ekonomi: 0.3, kultur: 0.4, kimlik: 'sag', lider: 0.5, anket: 0.12 },
  { id: 'X', ad: 'Oy kullanmama', tur: 'cekimser' }] };
export const TELEFON = { alan: 'ticaret', secenekler: [
  { id: 'P', ad: 'Premium', fiyat: 45000, kalite: 0.9, marka: 0.95, puan: 0.8 },
  { id: 'O', ad: 'Orta', fiyat: 22000, kalite: 0.7, marka: 0.6, puan: 0.75 },
  { id: 'Y', ad: 'Yerli ucuz', fiyat: 12000, kalite: 0.5, marka: 0.4, puan: 0.6, yerli: true },
  { id: 'N', ad: 'Almıyorum', tur: 'disarida' }] };
export const ASI = { alan: 'gundelik', secenekler: [
  { id: 'evet', ad: 'Aşı olurum', fayda: 0.8, maliyet: 0.2, risk: 0.25, gecikmeli_fayda: 0.7, norm: 0.6, kurum_onerisi: true, zorluk: 0.2 },
  { id: 'hayir', ad: 'Olmam', fayda: 0.4, risk: 0.2, varsayilan: true, aliskanlik: 0.3 }] };

console.log('\n[1] Tanım doğrulama');
ok(throws(() => resolveChoice({ alan: 'yok', secenekler: [{}, {}] })), 'bilinmeyen alan reddedilir');
ok(throws(() => resolveChoice({ alan: 'ticaret', secenekler: [{ id: 'a' }] })), 'tek seçenek reddedilir');
ok(throws(() => resolveChoice({ alan: 'ticaret', secenekler: [{ id: 'a' }, { id: 'a' }] })), 'yinelenen kimlik reddedilir');

console.log('\n[2] Siyaset');
const s = predictChoice(SECIM, { ...O, segmentBy: ['ideoloji'] });
ok(Math.abs(Object.values(s.paylar).reduce((a, b) => a + b, 0) - 100) < 0.5, 'paylar toplamı %100');
ok(s.segmentler.ideoloji.sol.B > 50 && s.segmentler.ideoloji.sag.A + s.segmentler.ideoloji.sag.C > 60, 'ideoloji oy tercihini belirler (mekânsal + parti kimliği)');
ok(s.paylar.X < 20, `çekimser oranı makul (${s.paylar.X})`);
const kotu = predictChoice({ ...SECIM, baglam: { ekonomi_algisi: -0.9 } }, O).paylar.A, iyi = predictChoice({ ...SECIM, baglam: { ekonomi_algisi: 0.6 } }, O).paylar.A;
ok(iyi > kotu + 3, `geriye dönük ekonomik oy: iyi ekonomi iktidarı güçlendirir (${kotu} → ${iyi})`);
const lid = whatIf(SECIM, { secenekler: { B: { lider: 0.9 } } }, O);
ok(lid.degisim_puan.B > 2, 'güçlü lider adayı payı artırır (valens)');
const genc = predictChoice(SECIM, { ...O, target: { yas: '18-24' } }).paylar.X, yasli = predictChoice(SECIM, { ...O, target: { yas: '65+' } }).paylar.X;
ok(genc > yasli, `gençler daha az oy kullanır (${genc} > ${yasli})`);

console.log('\n[3] Ticaret');
const t = predictChoice(TELEFON, { ...O, segmentBy: ['gelir'], explain: true });
ok(t.segmentler.gelir.yuksek.P > t.segmentler.gelir.dusuk.P * 2, 'yüksek gelir premium seçer, düşük gelir fiyata duyarlı');
const ind = whatIf(TELEFON, { secenekler: { O: { fiyat: 15000 } } }, O);
ok(ind.degisim_puan.O > 5 && ind.degisim_puan.Y < 0, 'fiyat indirimi talebi artırır, rakipten çalar');
const ref = whatIf(TELEFON, { secenekler: { O: { referans_fiyat: 18000 } } }, O);
ok(ref.degisim_puan.O < 0, 'referans fiyatın üstünde fiyat kayıp gibi algılanır (kayıp kaçınma)');
ok(t.terim_etkileri.length > 0 && t.terim_etkileri[0].kuram, 'kuram temelli karşı-olgusal açıklama üretilir');

console.log('\n[4] Gündelik karar');
const a = predictChoice(ASI, { ...O, segmentBy: ['kurumsal_guven'] });
ok(a.segmentler.kurumsal_guven.yuksek.evet > a.segmentler.kurumsal_guven.dusuk.evet, 'kurum önerisi güvenenlerde daha etkili');
const norm = whatIf(ASI, { secenekler: { evet: { norm: 0.9 } } }, O);
ok(norm.degisim_puan.evet > 0, 'sosyal norm davranışı artırır');
const def = whatIf(ASI, { secenekler: { evet: { varsayilan: true }, hayir: { varsayilan: false } } }, O);
ok(def.degisim_puan.evet > 10, `varsayılanı değiştirmek güçlü etkidir (+${def.degisim_puan.evet})`);

console.log('\n[5] Kampanya → karar');
const kamp = predictChoice({ ...ASI, kampanya: { secenek: 'evet', mesaj: { domain: 'saglik', institution: 'kamu_bakanlik', frame: 'kayip', channels: ['tv', 'sms'] } } }, O);
ok(kamp.paylar.evet > a.paylar.evet, `kampanya hedef seçeneği güçlendirir (${a.paylar.evet} → ${kamp.paylar.evet})`);
ok(throws(() => predictChoice({ ...ASI, kampanya: { secenek: 'yok', mesaj: {} } }, O)), 'olmayan hedef seçenek reddedilir');
ok(JSON.stringify(predictChoice(SECIM, O)) === JSON.stringify(predictChoice(SECIM, O)), 'deterministik');

console.log('\n[6] Veriden öğrenme (sentetik gerçek model)');
const TRUTH = { theta: { yakinlik: 2.4, yon: 0.2, parti_kimligi: 0.6, ekonomik_oy: 0.5, lider: 1.5, stratejik: 0.8, katilmama: 0.9, kurumsal_guven: 1.8 },
  asc: { A: 0.3, B: 0, C: -0.4, X: -0.3 }, demo: { B: { 'yas=18-24': 0.9 }, C: { 'cinsiyet=erkek': 0.6 } } };
const rows = simulateDataset(SECIM, TRUTH, { n: 1500, seed: 3 });
const oracle = scoreProbs(rows.map((r) => ({ P: r._P, y: ['A', 'B', 'C', 'X'].indexOf(r.secim), w: 1 })));
const cv = crossValidate(SECIM, rows, { k: 4, iters: 200 });
ok(cv.isabet_yuzde > cv.kuram_isabet_yuzde && cv.isabet_yuzde > cv.cogunluk_isabet_yuzde + 15, `öğrenilen model temel modelleri geçer (${cv.kazanc})`);
ok(cv.isabet_yuzde > oracle.isabet_yuzde - 3, `görülmemiş veride isabet teorik tavana yakın (${cv.isabet_yuzde} vs tavan ${oracle.isabet_yuzde})`);
ok(cv.log_kayip < cv.kuram_log_kayip && cv.kalibrasyon_hatasi_ece < 0.05, 'olasılıklar iyi kalibre (log-kayıp, ECE)');
const m = fitChoiceModel(SECIM, rows, { iters: 250 });
ok(Math.abs(m.theta.yakinlik - 2.4) < 0.5 && Math.abs(m.theta.katilmama - 0.9) < 0.3, `kuram katsayıları geri kazanılır (yakınlık ${m.theta.yakinlik}, katılmama ${m.theta.katilmama})`);
ok((m.demo.B['yas=18-24'] || 0) > 0.3, 'kuramın açıklamadığı demografik etki öğrenilir (gençler → B)');
const tS = predictChoice(SECIM, { model: TRUTH, n: 1500, explain: false }).paylar, fS = predictChoice(SECIM, { model: m, n: 1500, explain: false }).paylar;
ok(Object.keys(tS).every((k) => Math.abs(tS[k] - fS[k]) < 4), `nüfus payları gerçeğe yakın (${JSON.stringify(fS)} vs ${JSON.stringify(tS)})`);
const few = fitChoiceModel(SECIM, rows.slice(0, 30), { iters: 200 });
ok(Math.abs(few.theta.yakinlik - 1.6) < Math.abs(m.theta.yakinlik - 1.6) + 0.01, 'az veride model kuram öncülüne yaslanır');
ok(m.kuramlar.every((k) => k.std_hata > 0 && k.destek), 'kuram başına std. hata ve destek yorumu');

console.log('\n[7] Toplam paylara kalibrasyon');
const cs = calibrateShares(SECIM, { A: 35, B: 28, C: 12, X: 25 }, { n: 800 });
ok(Math.abs(cs.son_paylar.A - 35) < 1 && Math.abs(cs.son_paylar.X - 25) < 1, `anket paylarına oturur (${JSON.stringify(cs.son_paylar)})`);
const csSeg = predictChoice(SECIM, { model: cs, n: 800, explain: false, segmentBy: ['ideoloji'] });
ok(csSeg.segmentler.ideoloji.sol.B > csSeg.segmentler.ideoloji.sag.B, 'kalibrasyondan sonra bireysel farklılaşma korunur');

console.log('\n[8] CSV ve şema eşleme');
ok(mapValue('yas', '37') === '35-44' && mapValue('cinsiyet', 'Kadın') === 'kadin' && mapValue('gelir', 'Yüksek') === 'yuksek', 'Türkçe/sayısal değerler eşlenir');
const csv = 'Yaş;Cinsiyet;Eğitim;Tercih\n23;K;Lisans;B\n61;E;ilkokul;A\n45;E;lise;bilinmeyen\n30;kadın;üniversite;Oy kullanmama';
const prep = prepareRows(parseCSV(csv), { ...SECIM, secenekler: SECIM.secenekler.map((a) => ({ ...a })) });
ok(prep.rows.length === 3 && prep.uyarilar.some((u) => u.includes('eşleşmedi')), 'eşleşmeyen seçim atlanır ve uyarılır');
ok(prep.rows[0].p.egitim === 'universite' && prep.rows[2].secim === 'X', 'seçenek adıyla da eşleşir (Oy kullanmama → X)');

console.log('\n[9] Conjoint / satış verisi: satıra özgü fiyatlar');
const TRUE_T = { theta: { fiyat: 2.6, kalite: 1.2, marka: 0.8, sosyal_kanit: 1.1, yerli: 1.4, disarida: 1.0 }, asc: { P: 0.2, O: 0.3, Y: 0, N: -0.5 } };
const vary = { P: { fiyat: [35000, 60000] }, O: { fiyat: [15000, 30000] }, Y: { fiyat: [8000, 16000] } };
const crow = simulateDataset(TELEFON, TRUE_T, { n: 1500, seed: 5, vary });
const cm = fitChoiceModel(TELEFON, crow, { iters: 250 });
ok(Math.abs(cm.theta.fiyat - 2.6) < 0.4, `fiyat esnekliği veriden öğrenilir (gerçek 2.6 → ${cm.theta.fiyat})`);
const wT = whatIf(TELEFON, { secenekler: { O: { fiyat: 18000 } } }, { model: TRUE_T, n: 1200 }), wM = whatIf(TELEFON, { secenekler: { O: { fiyat: 18000 } } }, { model: cm, n: 1200 });
ok(Math.abs(wT.degisim_puan.O - wM.degisim_puan.O) < 2, `fiyat senaryosu gerçeğe yakın (${wM.degisim_puan.O} vs ${wT.degisim_puan.O})`);
const csv2 = 'yas;gelir;secim;fiyat_P;fiyat_O;var_Y\n30;orta;O;50000;20000;1\n50;dusuk;N;40000;28000;0';
const pr2 = prepareRows(parseCSV(csv2), TELEFON);
ok(pr2.rows[0].ozel.O.fiyat === 20000 && pr2.rows[1].yok.includes('Y'), 'CSV satıra özgü fiyat ve bulunurluk sütunlarını okur');

console.log('\n[10] Yanlı örneklem → nüfus (raking / MRP)');
const bias = simulateDataset(TELEFON, TRUE_T, { n: 1200, seed: 9, vary, marginals: { yas: { '18-24': 60, '25-34': 30, '35-44': 5, '45-54': 3, '55-64': 1, '65+': 1 }, egitim: { universite: 70, lisansustu: 20, lise: 8, ilkokul: 2 } } });
const truePop = predictChoice(TELEFON, { model: TRUE_T, n: 1500, explain: false }).paylar;
const diag = shareDiagnostics(TELEFON, bias, fitChoiceModel(TELEFON, bias, { iters: 250 }), { n: 1500 });
const err = (x) => Object.keys(truePop).reduce((s, k) => s + Math.abs(x[k] - truePop[k]), 0);
ok(err(diag.model_nufus) < err(diag.ham_orneklem), `model-tabanlı nüfus tahmini ham örneklemden isabetli (hata ${err(diag.model_nufus).toFixed(1)} vs ${err(diag.ham_orneklem).toFixed(1)})`);
const rk = rake(bias);
ok(rk.etkin_orneklem < bias.length && rk.boyutlar.includes('yas'), `raking ağırlık verir ve etkin örneklemi raporlar (${rk.etkin_orneklem}/${bias.length})`);

console.log('\n[11] Topluluk: kuram + öğrenilmiş + silikon');
// Sahte LLM: personayı metinden tanıyıp GERÇEK olasılığı gürültüyle söyler (iyi silikon) / tekdüze (kötü silikon)
const train = rows.slice(0, 1000), valid = rows.slice(1000, 1300);
const byDesc = new Map(rows.map((r) => [describePersona(r.p), r._P]));
const mkChat = (good) => async (sys, user) => {
  const lines = user.split('PERSONALAR:')[1].trim().split('\n');
  return JSON.stringify({ yanitlar: lines.map((l, i) => {
    const P = byDesc.get(l.replace(/^\d+\.\s*/, '')) || [0.25, 0.25, 0.25, 0.25];
    const q = good ? P.map((v, j) => Math.max(0.01, v + 0.04 * Math.sin(i * 7 + j * 3))) : [1, 1, 1, 1];
    return { no: i + 1, olasiliklar: { A: q[0], B: q[1], C: q[2], X: q[3] } };
  }) });
};
const learnedM = fitChoiceModel(SECIM, train, { iters: 250 });
const ens = await buildEnsemble(SECIM, valid, { kuram: {}, ogrenilmis: learnedM, silikon: 'silikon' }, { chat: mkChat(true) });
const best = Math.min(...Object.values(ens.bilesen_basarimi).map((b) => b.log_kayip));
ok(ens.topluluk_basarimi.log_kayip <= best + 1e-9, `topluluk en iyi bileşenden kötü değil (${ens.topluluk_basarimi.log_kayip} ≤ ${best})`);
ok(ens.agirliklar.silikon > 0.1, `bilgi taşıyan silikon bileşen ağırlık alır (${JSON.stringify(ens.agirliklar)})`);
const ensBad = await buildEnsemble(SECIM, valid, { ogrenilmis: learnedM, silikon: 'silikon' }, { chat: mkChat(false) });
ok(ensBad.agirliklar.silikon <= 0.1, `işe yaramaz silikon bileşen ~0 ağırlık alır (${ensBad.agirliklar.silikon})`);
const sw = stackWeights([[[0.9, 0.1]], [[0.1, 0.9]]], [0]);
ok(sw.agirliklar[0] === 1, 'yığınlama doğru bileşeni seçer');
ok(JSON.stringify(mixShares({ a: { x: 60, y: 40 }, b: { x: 20, y: 80 } }, { a: 0.5, b: 0.5 })) === JSON.stringify({ x: 40, y: 60 }), 'pay karışımı');
let thr = false; try { await siliconProbs(SECIM, valid.slice(0, 2)); } catch { thr = true; }
ok(thr, 'model bağlantısı olmadan silikon örneklem açık hata verir');

console.log('\n[12] Geçmiş davranış (önceki oy / sadakat)');
const LOYAL = { theta: { yakinlik: 1.6, parti_kimligi: 0.8, gecmis: 2.5, katilmama: 1 }, asc: { A: 0.2, B: 0, C: -0.2, X: 0 } };
const prevSpec = { ...SECIM, baglam: { ...SECIM.baglam, onceki_paylar: { A: 42, B: 28, C: 12, X: 18 } } };
const pp = predictChoice(prevSpec, { model: LOYAL, n: 1500, seed: 4, keepPeople: true, explain: false });
const pastCounts = {}; pp._people.forEach((x) => { pastCounts[x.p.onceki] = (pastCounts[x.p.onceki] || 0) + 1; });
ok(Math.abs(pastCounts.A / 1500 * 100 - 42) < 3, `önceki paylar personalara tutarlı atanır (A %${(pastCounts.A / 15).toFixed(1)})`);
let seedR = 1; const RR = () => { seedR = (seedR * 16807) % 2147483647; return seedR / 2147483647; };
const prow = pp._people.map((x) => { let u = RR(), j = 0; while (j < x.P.length - 1 && (u -= x.P[j]) > 0) j++; return { p: x.p, secim: ['A', 'B', 'C', 'X'][j], w: 1 }; });
const cvP = crossValidate(SECIM, prow, { k: 3, iters: 200 }), cvN = crossValidate(SECIM, prow.map((x) => { const { onceki, ...p } = x.p; return { ...x, p }; }), { k: 3, iters: 200 });
ok(cvP.isabet_yuzde > cvN.isabet_yuzde + 10, `geçmiş oy isabeti büyük ölçüde artırır (%${cvN.isabet_yuzde} → %${cvP.isabet_yuzde})`);
const pm = fitChoiceModel(SECIM, prow, { iters: 250 });
ok(Math.abs(pm.theta.gecmis - 2.5) < 0.5, `sadakat katsayısı geri kazanılır (${pm.theta.gecmis})`);
const pcsv = prepareRows(parseCSV('yas;onceki_oy;secim\n30;B;B\n50;Kapanan Parti;A'), SECIM);
ok(pcsv.rows[0].p.onceki === 'B' && pcsv.rows[1].p.onceki === 'kapanan_parti', 'CSV önceki oy sütunu: seçenek ya da bugün olmayan etiket');

console.log('\n[13] Gizli sınıflar (panel / conjoint verisi)');
const LC = { siniflar: [
  { pay: 0.5, theta: { fiyat: 4.5, kalite: 0.5, marka: 0 }, asc: { P: 0, O: 0, Y: 0.3, N: -0.5 } },
  { pay: 0.5, theta: { fiyat: 0.4, kalite: 2.5, marka: 3.5 }, asc: { P: 0.5, O: 0, Y: -0.5, N: -1 } }] };
const lrows = simulateDataset(TELEFON, LC, { n: 250, seed: 8, vary, gorev: 6 });
ok(new Set(lrows.map((r) => r.kisi)).size === 250 && lrows.length === 1500, 'panel verisi: kişi başı 6 görev');
const lcm = fitLatentClass(TELEFON, lrows, { C: 2, emIters: 5 });
const fy = lcm.siniflar.map((c) => c.theta.fiyat).sort((a, b) => a - b);
ok(fy[1] - fy[0] > 1.5, `EM fiyat avcılarını ve marka tutkunlarını ayırır (fiyat katsayıları ${fy.join(' / ')})`);
ok(lcm.siniflar.every((c) => c.etiket && c.pay > 0.3), `sınıflar okunur etiket ve payla gelir (${lcm.siniflar.map((c) => c.etiket).join(' · ')})`);
const cvOne = crossValidate(TELEFON, lrows, { k: 2, siniflar: 1, iters: 200 }), cvTwo = crossValidate(TELEFON, lrows, { k: 2, siniflar: 2, emIters: 4 });
ok(cvTwo.log_kayip < cvOne.log_kayip, `görülmemiş kişilerde gizli sınıf modeli tek sınıftan iyi (log-kayıp ${cvTwo.log_kayip} < ${cvOne.log_kayip})`);
const pc = predictChoice(TELEFON, { model: lcm, n: 800, explain: false });
ok(pc.gizli_siniflar?.length === 2 && Math.abs(Object.values(pc.paylar).reduce((a, b) => a + b, 0) - 100) < 0.5, 'nüfus tahmini sınıf karışımıyla yapılır');

console.log('\n[14] Anket birleştirme');
const polls = [
  { kurulus: 'K1', tarih: '2026-10-01', n: 2000, paylar: { A: 40, B: 30, C: 12, X: 18 } },
  { kurulus: 'K1', tarih: '2026-09-20', n: 1500, paylar: { A: 41, B: 29, C: 12, X: 18 } },
  { kurulus: 'K2', tarih: '2026-10-05', n: 1000, paylar: { A: 34, B: 34, C: 13, X: 19 } },
  { kurulus: 'K2', tarih: '2026-09-25', n: 1000, paylar: { A: 35, B: 33, C: 13, X: 19 } },
  { kurulus: 'K3', tarih: '2026-06-01', n: 3000, paylar: { A: 50, B: 20, C: 10, X: 20 } },
];
const ag = aggregatePolls(polls, { bugun: '2026-10-06' });
ok(ag.paylar.A > 34 && ag.paylar.A < 41, `birleşik tahmin anketlerin arasında (A %${ag.paylar.A})`);
ok(ag.agirliklar.find((p) => p.kurulus === 'K3').agirlik < 5, 'eski anket düşük ağırlık alır');
ok(ag.kurulus_yanliligi_puan.K1.A > 0 && ag.kurulus_yanliligi_puan.K2.A < 0, 'kuruluş yanlılığı tahmin edilir (K1 A lehine, K2 aleyhine)');
ok(ag.hata_payi_95.A > 0.5 && ag.hata_payi_95.A < 10, `hata payı makul (±${ag.hata_payi_95.A})`);

console.log('\n[15] Seçim biçimi ve konu önemi');
const sb = predictChoice(SECIM, O);
ok(sb.katilim_yuzde > 70 && Math.abs(Object.values(sb.gecerli_oy_paylari).reduce((a, b) => a + b, 0) - 100) < 0.5 && !('X' in sb.gecerli_oy_paylari), `katılım %${sb.katilim_yuzde} ve geçerli oy payları (çekimser hariç)`);
ok(sb.kazanan !== 'X', 'kazanan çekimser olamaz');
const eko = predictChoice({ ...SECIM, baglam: { ...SECIM.baglam, konu_onemi: { ekonomi: 2, kultur: 0.3 } } }, { ...O, segmentBy: ['dindarlik'] });
const kul = predictChoice({ ...SECIM, baglam: { ...SECIM.baglam, konu_onemi: { ekonomi: 0.3, kultur: 2 } } }, { ...O, segmentBy: ['dindarlik'] });
const gap = (r) => r.segmentler.dindarlik.yuksek.A - r.segmentler.dindarlik.dusuk.A;
ok(gap(kul) > gap(eko), `kültür ekseni önem kazanınca dindarlık ayrışması büyür (${gap(eko).toFixed(1)} → ${gap(kul).toFixed(1)} puan)`);

console.log('\n[16] Öğrenilen etkileşimler');
const INT = { theta: { fiyat: 1.8, kalite: 1.5, marka: 1.2 }, etk: { fiyat: { 'yas=18-24': 1.5, 'yas=65+': -1.0 } } };
const irows = simulateDataset(TELEFON, INT, { n: 1200, seed: 12, vary });
const im = fitChoiceModel(TELEFON, irows, { etkilesim: true, demoSigma: 0.8, iters: 300 });
ok(im.etk && (im.etk.fiyat?.['yas=18-24'] || 0) > 0.3, `gençlerde fazladan fiyat duyarlılığı öğrenilir (${im.etk?.fiyat?.['yas=18-24']})`);
const iy = whatIf(TELEFON, { secenekler: { Y: { fiyat: 9000 } } }, { model: im, n: 800, target: { yas: '18-24' } }).degisim_puan.Y;
const io = whatIf(TELEFON, { secenekler: { Y: { fiyat: 9000 } } }, { model: im, n: 800, target: { yas: '65+' } }).degisim_puan.Y;
ok(iy > io, `fiyat indirimi gençlerde daha etkili (${iy} > ${io})`);

console.log('\n[17] Tahmin aralıkları');
const mI = fitChoiceModel(SECIM, rows.slice(0, 300), { iters: 200 });
const big = fitChoiceModel(SECIM, rows, { iters: 200 });
const pI = predictChoice(SECIM, { model: mI, n: 800, explain: false }), pB = predictChoice(SECIM, { model: big, n: 800, explain: false });
ok(pI.pay_araligi_90 && Object.entries(pI.paylar).every(([k, v]) => pI.pay_araligi_90[k][0] <= v + 1.5 && v - 1.5 <= pI.pay_araligi_90[k][1]), 'öğrenilmiş modelde pay aralıkları tahmini çevreler');
const w = (r) => r.pay_araligi_90.A[1] - r.pay_araligi_90.A[0];
ok(w(pI) > w(pB), `az veride aralık geniş, çok veride dar (${w(pI).toFixed(1)} > ${w(pB).toFixed(1)} puan)`);
ok(predictChoice(SECIM, { ...O }).pay_araligi_90 === undefined, 'kuram öncülü tahminde sahte aralık üretilmez');

console.log('\n[18] Silikon ikinci görüş');
const agreeChat = async (sys, user) => {
  const lines = user.split('PERSONALAR:')[1].trim().split('\n');
  return JSON.stringify({ yanitlar: lines.map((l, i) => ({ no: i + 1, olasiliklar: l.includes('solda') ? { A: 0.05, B: 0.8, C: 0.05, X: 0.1 } : l.includes('sağda') ? { A: 0.6, B: 0.05, C: 0.25, X: 0.1 } : { A: 0.3, B: 0.3, C: 0.1, X: 0.3 } })) });
};
const so = await siliconSecondOpinion(SECIM, undefined, agreeChat, { k: 12 });
ok(so.panel === 12 && so.tabaka === 'ideoloji', 'ideolojiye göre tabakalı panel soruldu');
ok(so.ayrisma_puan < 20 && so.yorum, `sağduyulu dil modeli ile kuram modeli uyuşur (ayrışma ${so.ayrisma_puan} puan)`);
const contrary = async (sys, user) => JSON.stringify({ yanitlar: user.split('PERSONALAR:')[1].trim().split('\n').map((_, i) => ({ no: i + 1, olasiliklar: { A: 0, B: 0, C: 0, X: 1 } })) });
const so2 = await siliconSecondOpinion(SECIM, undefined, contrary, { k: 12 });
ok(so2.ayrisma_puan > 40 && so2.yorum.includes('belirgin'), `uyuşmayan görüş açıkça işaretlenir (${so2.ayrisma_puan} puan)`);

console.log('\n[19] Davranışsal ekonomi terimleri');
const yor = (yil) => predictChoice({ ...SECIM, baglam: { ...SECIM.baglam, iktidar_suresi_yil: yil } }, { ...O, target: { yas: '18-24' } }).paylar.A;
ok(yor(20) < yor(0), `iktidar yorgunluğu gençlerde iktidar oyunu düşürür (${yor(0)} → ${yor(20)})`);
ok(whatIf(TELEFON, { secenekler: { O: { indirim_yuzde: 30 } } }, O).degisim_puan.O > 0, 'ilan edilen indirim talebi artırır');
const tk = (g) => whatIf(TELEFON, { secenekler: { P: { taksit: true } } }, { ...O, target: { gelir: g } }).degisim_puan.P;
ok(tk('dusuk') > tk('yuksek'), `taksit düşük gelirde daha etkili (${tk('dusuk')} > ${tk('yuksek')})`);
ok(whatIf(ASI, { secenekler: { evet: { kayip_cercevesi: true } } }, O).degisim_puan.evet > 0, 'kayıp çerçevesi davranışı artırır');
ok(whatIf(ASI, { secenekler: { evet: { maliyet: 0 } } }, O).degisim_puan.evet > whatIf(ASI, { secenekler: { evet: { maliyet: 0.02 } } }, O).degisim_puan.evet + 1, 'sıfır fiyat etkisi: bedava, neredeyse bedavadan belirgin güçlü');

console.log('');
if (fails.length) { console.log(`✖ ${fails.length} başarısız`); process.exit(1); }
console.log('✔ karar testleri geçti');
