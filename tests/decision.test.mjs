// Karar tahmin motoru: kuram-temelli çok terimli logit (tarayıcısız).
import { predictChoice, whatIf, resolveChoice } from '../js/decision/model.js';

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

console.log('');
if (fails.length) { console.log(`✖ ${fails.length} başarısız`); process.exit(1); }
console.log('✔ karar testleri geçti');
