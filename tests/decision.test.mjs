// Karar tahmin motoru: kuram-temelli çok terimli logit (tarayıcısız).
import { predictChoice, whatIf, resolveChoice } from '../js/decision/model.js';
import { simulateDataset, parseCSV, prepareRows, mapValue } from '../js/decision/data.js';
import { fitChoiceModel, crossValidate, scoreProbs, calibrateShares, learn } from '../js/decision/estimate.js';

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

console.log('');
if (fails.length) { console.log(`✖ ${fails.length} başarısız`); process.exit(1); }
console.log('✔ karar testleri geçti');
