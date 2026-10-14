// Hane temelli yaşam seyri mikrosimülasyonu: sentetik Türkiye seçmenleri gerçek demografik oranlardan
// AİLELERİYLE birlikte üretilir. Önce hane (tipi, bölgesi), sonra hanedeki her yetişkinin hayatı
// doğumdan bugüne yıl yıl kurulur: anne-baba (kendi kuşaklarının eğitimi, dönemin partisi), kardeşler
// (annenin kuşağının doğurganlığı, bebek ölümleri, gurbete gidenler), köyden kente göç, okul, askerlik,
// evlilik (yaşı, görücü usulü, akraba evliliği), çocuklar, iş hayatı, tarihsel olaylar ve iletişim
// ekolojisi (televizyon kanalı ve saati, sosyal medya, aile WhatsApp grubu, cami/cemevi, kahvehane,
// adı konmuş kanaat önderleri ve tartışma ağı). Hanedeki eş, yetişkin çocuk ve yaşlı ebeveyn de seçmendir:
// aile bağı soyut bir sütun değil, gerçek kişiler arasındaki ilişkidir.
// Oy, ayrı bir üretim süreciyle oluşur ve karar modelinin denklemi KULLANILMAZ: 18 yaşındaki
// sosyalleşme eğilimi + hayat olaylarının izleri + 2015–2023 arasında yıl yıl işleyen ajan tabanlı
// iletişim süreci (medya dozu, düşmanca medya etkisinde geri tepme, hane üyelerinin birbirini eş zamanlı
// etkilediği konuşmalar) + ekonomik ve afet deneyimi. Karar modeli yalnız ankette sorulabilecek sütunları görür.
// Kaynaklar (yaklaşık oranlar; kesin değer iddiası yoktur — ayrıntı: tests/data/sentetik/hane/README.md):
//   TÜİK ADNKS 2023 (bölge nüfusu, yaş yapısı, hane tipleri, ort. hane büyüklüğü 3,14),
//   TÜİK Evlenme İstatistikleri 2023 (ilk evlilik yaşı K 25,8 / E 28,3), TÜİK Ulusal Eğitim İst. (kuşak ×
//   cinsiyet eğitim düzeyi), TNSA 2018 (akraba evliliği %23, Güneydoğu ~%40; tamamlanmış doğurganlık),
//   TAYA 2016/2021 (görücü usulü, geniş aile), TÜİK Hayat Tabloları (ölümlülük), TÜİK İşgücü 2023 (kadın
//   katılımı %35,8), RTÜK/Reuters Dijital Haber Raporu 2023 (TV süresi, haber kaynağı), tarihsel olay ölçekleri
//   (12 Eylül gözaltıları, 1990'larda köy boşaltmaları, 1999 ve 2023 depremleri, 2001 krizi, KHK ihraçları).
// Çalıştır: node tests/data/hayat_uret.mjs [hane=1300] [tohum=2024]
import { writeFileSync, mkdirSync } from 'node:fs';
import { rng } from '../../js/audience/personas.js';

const NH = Number(process.argv[2] || 1300), SEED = Number(process.argv[3] || 2024), YIL = 2023;
const r = rng(SEED);
const U = () => r();
const norm = () => Math.sqrt(-2 * Math.log(U() || 1e-12)) * Math.cos(2 * Math.PI * U());
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const bern = (p) => U() < p;
const sig = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => Math.log(clamp(p, 1e-6, 1 - 1e-6) / (1 - clamp(p, 1e-6, 1 - 1e-6)));
const pick = (arr) => arr[Math.floor(U() * arr.length)];
const pickW = (obj) => { const ks = Object.keys(obj), t = ks.reduce((s, k) => s + Math.max(0, obj[k]), 0); let u = U() * t; for (const k of ks) { if ((u -= Math.max(0, obj[k])) <= 0) return k; } return ks[ks.length - 1]; };
const softmax = (V) => { const m = Math.max(...V), e = V.map((v) => Math.exp(v - m)), s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); };
const gumbel = () => -Math.log(-Math.log(U() || 1e-12));
const choose = (V) => { const W = V.map((v) => v + gumbel()); return W.indexOf(Math.max(...W)); };
const lerpT = (tab, x) => { const ks = Object.keys(tab).map(Number).sort((a, b) => a - b); if (x <= ks[0]) return tab[ks[0]]; if (x >= ks[ks.length - 1]) return tab[ks[ks.length - 1]];
  for (let i = 1; i < ks.length; i++) if (x <= ks[i]) { const w = (x - ks[i - 1]) / (ks[i] - ks[i - 1]), a = tab[ks[i - 1]], b = tab[ks[i]]; return Array.isArray(a) ? a.map((v, j) => v + w * (b[j] - v)) : a + w * (b - a); } };

/* ============================ DEMOGRAFİ TABLOLARI ============================ */
// Bölgeler (ADNKS 2023 yaklaşık): nüfus payı, kentli payı, Kürt / Alevi payı, dindarlık düzeyi, mülteci yoğunluğu,
// doğurganlık çarpanı (TNSA/TÜİK il TFR), akraba evliliği çarpanı (TNSA 2018), gurbetçi (1961–74 işçi göçü) yoğunluğu
const BOLGE = {
  istanbul: { pay: 0.185, kent: 0.99, kurt: 0.12, alevi: 0.12, din: 0.42, multeci: 0.6, dogur: 0.82, akraba: 0.6, gurbet: 0.6, iller: ['İstanbul'] },
  marmara: { pay: 0.11, kent: 0.78, kurt: 0.04, alevi: 0.1, din: 0.45, multeci: 0.25, dogur: 0.8, akraba: 0.55, gurbet: 0.8, iller: ['Bursa', 'Kocaeli', 'Tekirdağ', 'Balıkesir', 'Sakarya', 'Edirne'] },
  ege: { pay: 0.125, kent: 0.8, kurt: 0.05, alevi: 0.1, din: 0.38, multeci: 0.25, dogur: 0.8, akraba: 0.5, gurbet: 0.9, iller: ['İzmir', 'Manisa', 'Aydın', 'Denizli', 'Muğla', 'Afyonkarahisar'] },
  akdeniz: { pay: 0.13, kent: 0.75, kurt: 0.1, alevi: 0.1, din: 0.5, multeci: 0.7, dogur: 1.05, akraba: 1.0, gurbet: 0.7, iller: ['Antalya', 'Adana', 'Mersin', 'Hatay', 'Kahramanmaraş', 'Osmaniye'] },
  icanadolu: { pay: 0.155, kent: 0.8, kurt: 0.04, alevi: 0.18, din: 0.58, multeci: 0.35, dogur: 0.95, akraba: 1.0, gurbet: 1.6, iller: ['Ankara', 'Konya', 'Kayseri', 'Eskişehir', 'Sivas', 'Yozgat'] },
  karadeniz: { pay: 0.095, kent: 0.6, kurt: 0.01, alevi: 0.06, din: 0.62, multeci: 0.1, dogur: 0.95, akraba: 0.9, gurbet: 1.3, iller: ['Samsun', 'Trabzon', 'Ordu', 'Rize', 'Zonguldak', 'Tokat'] },
  dogu: { pay: 0.07, kent: 0.6, kurt: 0.45, alevi: 0.18, din: 0.65, multeci: 0.3, dogur: 1.45, akraba: 1.5, gurbet: 1.1, iller: ['Erzurum', 'Van', 'Malatya', 'Elazığ', 'Ağrı', 'Tunceli'] },
  guneydogu: { pay: 0.13, kent: 0.72, kurt: 0.68, alevi: 0.03, din: 0.68, multeci: 0.9, dogur: 1.7, akraba: 1.75, gurbet: 0.8, iller: ['Gaziantep', 'Şanlıurfa', 'Diyarbakır', 'Mardin', 'Batman', 'Adıyaman'] },
};
const DOGU = (b) => b === 'dogu' || b === 'guneydogu';
const METROPOL = new Set(['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Adana', 'Gaziantep', 'Konya', 'Kocaeli', 'Mersin', 'Diyarbakır', 'Kayseri']);
const DEPREM23 = new Set(['Hatay', 'Kahramanmaraş', 'Osmaniye', 'Adana', 'Gaziantep', 'Şanlıurfa', 'Diyarbakır', 'Adıyaman', 'Malatya', 'Elazığ']);
const DEPREM99 = new Set(['İstanbul', 'Kocaeli', 'Sakarya', 'Bursa']);
const GOC_HEDEF = { istanbul: 0.5, marmara: 0.13, ege: 0.12, akdeniz: 0.12, icanadolu: 0.13 };
const SEMT = { 'İstanbul': ['Bağcılar', 'Esenyurt', 'Sultanbeyli', 'Gazi Mahallesi', 'Kadıköy', 'Ümraniye', 'Avcılar', 'Fatih', 'Beşiktaş', 'Pendik', 'Sultangazi', 'Küçükçekmece'], 'Ankara': ['Mamak', 'Keçiören', 'Çankaya', 'Sincan', 'Etimesgut', 'Yenimahalle'], 'İzmir': ['Karşıyaka', 'Bornova', 'Buca', 'Kadifekale', 'Çiğli', 'Karabağlar'] };

// Eğitim dağılımı (bitirilen en yüksek düzey) — doğum kuşağı × cinsiyet (TÜİK yaş grubuna göre eğitim, yaklaşık)
const EGT = ['okumamis', 'ilkokul', 'ortaokul', 'lise', 'universite', 'lisansustu'];
const EGT_K = { 1935: [0.55, 0.38, 0.02, 0.03, 0.02, 0], 1950: [0.3, 0.55, 0.04, 0.06, 0.05, 0], 1965: [0.12, 0.55, 0.08, 0.13, 0.11, 0.01], 1980: [0.05, 0.33, 0.12, 0.25, 0.23, 0.02], 1995: [0.02, 0.08, 0.15, 0.33, 0.38, 0.04], 2005: [0.01, 0.04, 0.12, 0.45, 0.35, 0.03] };
const EGT_E = { 1935: [0.15, 0.6, 0.06, 0.1, 0.08, 0.01], 1950: [0.07, 0.55, 0.08, 0.15, 0.14, 0.01], 1965: [0.03, 0.45, 0.12, 0.2, 0.18, 0.02], 1980: [0.01, 0.25, 0.16, 0.3, 0.25, 0.03], 1995: [0.01, 0.06, 0.14, 0.38, 0.38, 0.03], 2005: [0.01, 0.03, 0.12, 0.5, 0.32, 0.02] };
/** shift > 0 → daha yüksek düzey (aile SES, kent); latent → hane içi eğitim homogamisi */
function egitimCek(dogum, kadin, shift) {
  const pr = lerpT(kadin ? EGT_K : EGT_E, dogum), t = pr.reduce((a, b) => a + b, 0);
  const u = sig(logit(U()) + shift);
  let c = 0;
  for (let i = 0; i < EGT.length; i++) { c += pr[i] / t; if (u <= c) return i; }
  return EGT.length - 1;
}
// İlk evlilik yaşı (TÜİK: kadın 1985 ~21, 2023 25,8; erkek ~3 yaş büyük), kuşağa göre doğrusal yaklaşım
const evlilikYasi = (dogum, kadin, egt) => (kadin ? 20.3 : 23.6) + 0.1 * clamp(dogum - 1945, 0, 55) + (egt >= 4 ? 2.6 : egt === 3 ? 1 : 0) + 3.2 * norm() * 0.9;
// Kadın kuşağının tamamlanmış doğurganlığı (TNSA/TÜİK; 1940 ~4,6 → 1995 ~1,7)
const DOGURGANLIK = { 1925: 5.6, 1940: 4.6, 1955: 3.6, 1965: 2.8, 1975: 2.4, 1985: 2.1, 1995: 1.7, 2005: 1.6 };
// Bebek/çocuk ölümlülüğü (doğum yılına göre 5 yaş altı ölüm olasılığı; 1950 ~%25 → 2000 ~%4)
const COCUK_OLUM = { 1930: 0.3, 1950: 0.24, 1965: 0.16, 1980: 0.09, 1995: 0.05, 2010: 0.015 };
// Akraba evliliği (evlenme yılına göre; TNSA 2018 evli kadınların %23'ü, gençlerde düşüş) ve görücü usulü (TAYA)
const AKRABA = { 1960: 0.27, 1985: 0.24, 2000: 0.18, 2015: 0.1, 2023: 0.07 };
const GORUCU = { 1960: 0.8, 1985: 0.65, 2000: 0.5, 2015: 0.35, 2023: 0.28 };
// Ölümlülük (TÜİK hayat tablosu ~ Gompertz; doğuşta beklenen yaşam E 75, K 81)
const hayatta = (yas, kadin) => bern(Math.exp(-Math.exp((yas - (kadin ? 86 : 81)) / 9.5) + Math.exp(-(kadin ? 86 : 81) / 9.5)));

// Adlar: kuşak × cinsiyet × kimlik (nüfus kayıtlarındaki yaygın adlardan)
const AD = {
  erkek: { eski: ['Mehmet', 'Ahmet', 'Mustafa', 'Ali', 'Hüseyin', 'Hasan', 'İbrahim', 'Osman', 'Halil', 'Süleyman', 'İsmail', 'Ramazan', 'Yaşar', 'Recep'],
    orta: ['Mehmet', 'Mustafa', 'Murat', 'Ali', 'Ahmet', 'Hakan', 'Serkan', 'Özgür', 'Kemal', 'Fatih', 'Volkan', 'Erkan', 'Tolga', 'Cengiz'],
    genc: ['Yusuf', 'Emre', 'Burak', 'Mehmet', 'Enes', 'Furkan', 'Mustafa', 'Ömer', 'Eren', 'Berkay', 'Oğuzhan', 'Kerem', 'Arda', 'Alperen'],
    kurt: ['Abdullah', 'Mehmet', 'Ramazan', 'Şiyar', 'Rojhat', 'Baran', 'Welat', 'Azad', 'Serhat', 'Mahsun', 'Cihan', 'Şehmus', 'Hamit', 'Bişar'],
    alevi: ['Ali', 'Hüseyin', 'Hasan', 'Rıza', 'Haydar', 'Cem', 'Deniz', 'Erdal', 'Kazım', 'Veli', 'Musa', 'Doğan', 'Hıdır', 'Zeynel'] },
  kadin: { eski: ['Fatma', 'Ayşe', 'Emine', 'Hatice', 'Zeynep', 'Elif', 'Hanife', 'Meryem', 'Şerife', 'Zehra', 'Havva', 'Sultan', 'Dürdane', 'Saniye'],
    orta: ['Ayşe', 'Fatma', 'Özlem', 'Derya', 'Esra', 'Emine', 'Sibel', 'Gülay', 'Ebru', 'Hülya', 'Nurcan', 'Seda', 'Arzu', 'Serap'],
    genc: ['Zeynep', 'Elif', 'Merve', 'Büşra', 'Esra', 'Kübra', 'Ecrin', 'İrem', 'Melike', 'Sude', 'Rabia', 'Beyza', 'Ceren', 'Nisa'],
    kurt: ['Rojda', 'Berfin', 'Zelal', 'Hêvî', 'Gülistan', 'Leyla', 'Nesrin', 'Dilan', 'Rukiye', 'Fatma', 'Sakine', 'Bese', 'Xecê', 'Zozan'],
    alevi: ['Zeynep', 'Güler', 'Gülizar', 'Cemile', 'Elif', 'Döne', 'Sevim', 'Gülbahar', 'Asiye', 'Nergis', 'Pınar', 'Deniz', 'Fadime', 'Hüsniye'] },
};
const SOYAD = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Yıldırım', 'Öztürk', 'Aydın', 'Özdemir', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Kara', 'Koç', 'Kurt', 'Özkan', 'Şimşek', 'Polat', 'Korkmaz', 'Karakaya', 'Bulut', 'Güneş', 'Akın', 'Tekin', 'Aksoy', 'Uçar', 'Ekinci', 'Altun', 'Ateş', 'Keskin', 'Duman', 'Erdem', 'Turan'];
const adCek = (kadin, dogum, kim) => pick(AD[kadin ? 'kadin' : 'erkek'][kim === 'kurt' && bern(0.6) ? 'kurt' : kim === 'alevi' && bern(0.5) ? 'alevi' : dogum < 1960 ? 'eski' : dogum < 1990 ? 'orta' : 'genc']);

// Türkçe ekler
const lastV = (w) => { const m = w.toLocaleLowerCase('tr').match(/[aeıioöuü](?=[^aeıioöuü]*$)/); return m ? m[0] : 'e'; };
const back = (w) => 'aıou'.includes(lastV(w));
const endsV = (w) => /[aeıioöuü]$/i.test(w);
const yon = (w) => `${w}'${endsV(w) ? 'y' : ''}${back(w) ? 'a' : 'e'}`;
const bul = (w) => `${w}'${/[çfhkpsşt]$/i.test(w) ? 't' : 'd'}${back(w) ? 'a' : 'e'}`;
const cik = (w) => `${w}'${/[çfhkpsşt]$/i.test(w) ? 't' : 'd'}${back(w) ? 'an' : 'en'}`;
// Sayıya bulunma eki (okunuşa göre): 1979'da, 2003'te, 1980'de, 2000'de
const SAYI_EK = ['', 'de', 'de', 'te', 'te', 'te', 'da', 'de', 'de', 'da'], ONLAR_EK = ['', 'da', 'de', 'da', 'ta', 'de', 'ta', 'te', 'de', 'da'];
const yilda = (y) => { const n = Math.abs(y) % 100, b = n % 10, o = Math.floor(n / 10); return `${y}'${b ? SAYI_EK[b] : o ? ONLAR_EK[o] : 'de'}`; };
const Buyuk = (s) => !s ? '' : s[0].toLocaleUpperCase('tr') + s.slice(1);

/* ============================ SİYASİ SOY ============================ */
const ALTS = ['iktidar', 'ana_muhalefet', 'milliyetci', 'kurt_sol', 'oy_yok'];
const AI = Object.fromEntries(ALTS.map((a, i) => [a, i]));
const HEDEF = { iktidar: 0.43, ana_muhalefet: 0.29, milliyetci: 0.08, kurt_sol: 0.08, oy_yok: 0.12 };
const HEDEF18 = { iktidar: 0.46, ana_muhalefet: 0.2, milliyetci: 0.085, kurt_sol: 0.1, oy_yok: 0.155 };
const HEDEF15 = { iktidar: 0.44, ana_muhalefet: 0.21, milliyetci: 0.1, kurt_sol: 0.1, oy_yok: 0.15 };
const PARTI_KISA = { iktidar: 'iktidar ittifakı', ana_muhalefet: 'ana muhalefet', milliyetci: 'milliyetçi muhalefet', kurt_sol: 'Kürt siyasi hareketi', oy_yok: 'siyasetten uzak' };
// Babanın oyu, kendi kuşağının partileriyle anlatılır (siyasi soy: merkez sağ/İslamcı → iktidar, CHP/SHP/DSP → ana muhalefet …)
function soyAnlat(blok, dogum, dindar) {
  const genc = dogum >= 1950;
  return {
    iktidar: dindar ? (genc ? "önce Refah Partisi'ne, sonra AK Parti'ye" : "Milli Selamet'e, sonra Refah'a") : (genc ? "ANAP'a, sonra AK Parti'ye" : "Adalet Partisi'ne, sonra Doğru Yol'a"),
    ana_muhalefet: genc ? "Ecevit'e, DSP'ye, sonra CHP'ye" : "CHP'ye, Ecevit'in 'ak günlere' sloganına inanarak",
    milliyetci: "MHP'ye — Türkeş'in ülkücü hareketine",
    kurt_sol: genc ? "HADEP'ten bu yana Kürt siyasi hareketine" : "bölgedeki ağanın dediğine, seksenlerden sonra Kürt siyasi hareketine",
    oy_yok: null,
  }[blok];
}

/* ============================ KİŞİ ============================ */
let KID = 0;
const kisiler = [];
const haneler = [];
const eskiler = [];   // ölmüş/boşanmış eşler: anlatı ve çocuklarının aile soyu için (seçmen değil)

function kimlikCek(bolge) {
  const B = BOLGE[bolge];
  const kurt = bern(B.kurt), alevi = bern(kurt ? 0.12 : B.alevi), arap = !kurt && bolge === 'guneydogu' && bern(0.1);
  return { kurt, alevi, arap, kim: kurt ? 'kurt' : alevi ? 'alevi' : 'turk' };
}

function babaBlokCek(din, kim, bolge) {
  return pickW({
    iktidar: 1.3 * din * (kim.alevi ? 0.15 : 1) * (kim.kurt ? 0.6 : 1) + 0.15,
    ana_muhalefet: (1.1 - din) * (kim.alevi ? 3.2 : 1) * (kim.kurt ? 0.3 : 1) * (bolge === 'ege' ? 1.7 : bolge === 'marmara' ? 1.3 : 1),
    milliyetci: 0.32 * (kim.kurt || kim.alevi ? 0.05 : 1) * (['icanadolu', 'akdeniz', 'karadeniz'].includes(bolge) ? 1.6 : 1),
    kurt_sol: kim.kurt ? 1.6 * (1.1 - din * 0.6) : 0.01,
    oy_yok: 0.15,
  });
}

/**
 * Bir yetişkinin hayatını doğumdan bugüne kurar. o: {dogum, kadin, bolge (yaşadığı), il, kim?, kokenBolge?, esine?}
 * esine: eşin kişi kaydı — homogami (köken, kimlik, eğitim) ve evlilik bilgisi ondan gelir.
 */
function kisiKur(o) {
  const P = { id: ++KID, kadin: o.kadin, dogum: o.dogum, yas: YIL - o.dogum, bolge: o.bolge, il: o.il, olaylar: [], etki: new Array(5).fill(0) };
  const ola = (yil, metin, etki = {}) => { P.olaylar.push({ yil, metin }); for (const [k, v] of Object.entries(etki)) P.etki[AI[k]] += v; };
  // --- Köken -------------------------------------------------------------------
  const e = o.esine;
  const yerli = bern(['istanbul'].includes(o.bolge) ? 0.3 : DOGU(o.bolge) || o.bolge === 'karadeniz' ? 0.92 : 0.65);
  P.dogumBolge = o.kokenBolge ?? (e && bern(0.7) ? e.dogumBolge : yerli ? (o.bolge === 'istanbul' ? 'istanbul' : o.bolge) : pickW({ dogu: 0.16, guneydogu: 0.16, karadeniz: 0.22, icanadolu: 0.24, akdeniz: 0.08, ege: 0.06, marmara: 0.08 }));
  if (P.dogumBolge === o.bolge && !yerli && o.bolge !== 'istanbul') P.dogumBolge = o.bolge;
  P.dogumIl = P.dogumBolge === o.bolge && bern(0.75) ? o.il : pick(BOLGE[P.dogumBolge].iller);
  const kim = o.kim ?? (e ? (bern(0.92) ? { kurt: e.kurt, alevi: bern(0.93) ? e.alevi : !e.alevi, arap: e.arap, kim: e.kim } : kimlikCek(P.dogumBolge)) : kimlikCek(P.dogumBolge));
  Object.assign(P, { kurt: kim.kurt, alevi: kim.alevi, arap: kim.arap, kim: kim.kurt ? 'kurt' : kim.alevi ? 'alevi' : 'turk' });
  P.soyad = o.soyad ?? (P.kurt && bern(0.3) ? pick(['Ekinci', 'Aslan', 'Altun', 'Ateş', 'Tekin', 'Oral', 'Acar', 'Alkan', 'Demir', 'Yıldız']) : pick(SOYAD));
  P.ad = adCek(P.kadin, P.dogum, P.kim);
  P.koyde = bern(clamp(1 - BOLGE[P.dogumBolge].kent + (YIL - P.dogum) * 0.009, 0.02, 0.92));
  // --- Anne, baba ---------------------------------------------------------------
  const babaDogum = P.dogum - Math.round(27 + 4 * norm() * 0.8 + (P.dogum < 1960 ? 2 : 0)), anneDogum = babaDogum + Math.round(4 + 2 * norm() * 0.7);
  const ses = clamp(0.32 + 0.22 * norm() + (P.koyde ? -0.12 : 0.08) + (P.dogum - 1960) * 0.003 + (DOGU(P.dogumBolge) ? -0.08 : 0));
  const din = clamp(BOLGE[P.dogumBolge].din + 0.18 * norm() + (P.koyde ? 0.12 : -0.05) + (P.alevi ? -0.25 : 0) - (P.dogum - 1960) * 0.002);
  const babaEgt = egitimCek(babaDogum, false, 2.2 * (ses - 0.35) - (P.koyde ? 0.6 : 0));
  const anneEgt = egitimCek(anneDogum, true, 2.2 * (ses - 0.35) - (P.koyde ? 0.8 : 0) + 0.5 * (babaEgt - 1));
  const babaBlok = e && bern(0.6) ? e.aile.babaBlok : babaBlokCek(din, kim, P.dogumBolge);   // eş seçiminde siyasi homogami (Alford vd. 2011)
  const anneBlok = bern(0.72) ? babaBlok : babaBlokCek(din, kim, P.dogumBolge);
  const babaMeslek = babaEgt >= 4 ? pickW({ ogretmen: 0.45, memur: 0.25, doktor: 0.05, muhendis: 0.12, avukat: 0.05, imam: 0.08 * din }) : P.koyde ? pickW({ ciftci: 0.7, coban: 0.08, imam: 0.03 * din, muhtar: 0.04, isci: 0.15 }) : babaEgt >= 4 ? pickW({ ogretmen: 0.4, memur: 0.3, doktor: 0.05, muhendis: 0.1, avukat: 0.05 }) : pickW({ isci: 0.4, esnaf: 0.25, sofor: 0.12, memur: 0.1, insaat_ustasi: 0.13 });
  const anneMeslek = anneEgt >= 4 ? pickW({ ogretmen: 0.5, hemsire: 0.3, memur: 0.2 }) : P.koyde ? 'tarla ve ev' : bern(0.12) ? 'terzi' : 'ev hanımı';
  P.aile = { babaAd: adCek(false, babaDogum, P.kim), anneAd: adCek(true, anneDogum, P.kim), babaDogum, anneDogum, babaEgt, anneEgt, babaMeslek, anneMeslek, babaBlok, anneBlok, ses, din,
    babaHayatta: hayatta(YIL - babaDogum, false), anneHayatta: hayatta(YIL - anneDogum, true) };
  if (!P.aile.babaHayatta) P.aile.babaOlum = clamp(Math.round(babaDogum + 55 + 18 * U() + 6 * norm()), P.dogum + 1, YIL);
  if (!P.aile.anneHayatta) P.aile.anneOlum = clamp(Math.round(anneDogum + 60 + 18 * U() + 6 * norm()), P.dogum + 1, YIL);
  // --- Kardeşler (annenin kuşağının doğurganlığı × bölge × anne eğitimi) ----------------
  const tfr = lerpT(DOGURGANLIK, anneDogum) * BOLGE[P.dogumBolge].dogur ** (anneDogum < 1960 ? 0.6 : 1) * (anneEgt >= 4 ? 0.72 : anneEgt === 0 ? 1.3 : 1) * (P.koyde ? 1.15 : 0.95);
  let nCocuk = 1; for (let k = 0; k < 14; k++) if (U() < (tfr - 1) / 13) nCocuk++;
  const sira = Math.floor(U() * nCocuk);
  P.kardesler = [];
  for (let k = 0; k < nCocuk; k++) {
    if (k === sira) continue;
    const kd = P.dogum + (k - sira) * Math.round(2 + 1.4 * U());
    if (kd > YIL - 1) continue;
    const kk = bern(0.49), olu = bern(lerpT(COCUK_OLUM, kd));
    let kad = adCek(kk, kd, P.kim);
    for (let t = 0; t < 6 && (kad === P.ad || P.kardesler.some((x) => x.ad === kad)); t++) kad = adCek(kk, kd, P.kim);
    const s = { ad: kad, kadin: kk, dogum: kd, buyuk: kd < P.dogum, olu };
    if (!olu) {
      const kegt = egitimCek(kd, kk, 2.2 * (ses - 0.35) - (P.koyde ? 0.6 : 0));
      s.egt = kegt;
      s.yer = kd >= 1935 && kd <= 1955 && bern(0.12 * BOLGE[P.dogumBolge].gurbet) ? 'almanya' : bern(P.koyde ? 0.4 : 0.15) ? 'koy' : bern(0.45) ? 'il' : pick(['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Kocaeli']);
      if (s.yer === 'almanya') s.gurbetYil = clamp(Math.round(1962 + 11 * U()), kd + 17, 1974), s.sehir = pick(['Köln', 'Duisburg', 'Berlin', 'Stuttgart', 'Frankfurt', 'Viyana', 'Rotterdam']);
      if (s.yer === 'koy' && kegt >= 4) s.yer = pick(['İstanbul', 'Ankara', 'İzmir', 'il']);
      s.meslek = kegt >= 4 ? pick(['öğretmen', 'mühendis', 'hemşire', 'muhasebeci', 'polis', 'avukat']) : kk ? pick(['ev hanımı', 'ev hanımı', 'terzi', 'tekstil işçisi']) : pick(['inşaat ustası', 'taksici', 'esnaf', 'fabrika işçisi', 'çiftçi', 'polis', 'güvenlik görevlisi', 'astsubay']);
      s.blok = bern(0.6) ? babaBlok : babaBlokCek(clamp(din - 0.08 * (kegt - 2)), kim, P.dogumBolge);
      s.evli = YIL - kd > 24 && bern(0.85);
    }
    P.kardesler.push(s);
  }
  P.gurbet = P.kardesler.some((s) => s.yer === 'almanya') || bern(0.06 * BOLGE[P.dogumBolge].gurbet);
  // --- Çocukluk: ACE, terbiye --------------------------------------------------
  const yoksul = 1 - ses;
  P.ace = {
    yoksulluk: bern(0.08 + 0.35 * yoksul ** 2), siddet: bern(0.1 + 0.12 * yoksul + (din > 0.7 ? 0.03 : 0)),
    ebeveynKaybi: (P.aile.babaOlum && P.aile.babaOlum - P.dogum < 16) || (P.aile.anneOlum && P.aile.anneOlum - P.dogum < 16),
    bosanma: bern(0.02 + (P.dogum > 1985 ? 0.06 : 0) + (din < 0.3 ? 0.04 : 0)), alkol: bern(0.04 + 0.04 * yoksul),
  };
  P.sertCeza = bern(clamp(0.18 + 0.35 * din + 0.15 * yoksul + (P.koyde ? 0.08 : 0) - (P.dogum - 1960) * 0.004));
  // --- Göç: köyden kente / zorunlu / bölgeler arası ----------------------------------
  P.goc = null;
  const zorunlu = P.kurt && P.koyde && DOGU(P.dogumBolge) && P.dogum >= 1950 && P.dogum <= 2000 && bern(0.22);
  if (zorunlu) {
    const yil = Math.round(1992 + 4 * U());
    P.goc = { yil, il: P.dogumBolge === o.bolge ? o.il : pick(['Diyarbakır', 'Van', 'Mersin', 'Adana', 'İstanbul']), zorunlu: true };
    ola(yil, `${yilda(yil)} köyleri güvenlik gerekçesiyle boşaltıldı; aile bir gecede evini, bağını, hayvanlarını bırakıp ${yon(P.goc.il)} göçmek zorunda kaldı`, { kurt_sol: 1.1, iktidar: -0.3 });
  }
  if (P.dogumBolge !== o.bolge || (P.koyde && !(o.kirsal))) {
    const yil = clamp(Math.round(P.dogum + 16 + 10 * U()), P.dogum + 3, YIL - 1);
    P.goc = P.goc ?? { yil, il: o.il, zorunlu: false };
    if (!P.goc.zorunlu) P.goc = { yil, il: o.il, zorunlu: false, neden: P.dogum + 16 > yil ? 'aile' : pick(['iş', 'iş', 'okul', 'evlilik']) };
    P.goc.semt = SEMT[o.il] ? pick(SEMT[o.il]) : null;
  }
  P.koyKalan = P.koyde && !P.goc;
  // --- Eğitim, askerlik --------------------------------------------------------
  const shift = 2.2 * (ses - 0.35) + 0.25 * (babaEgt - 1.2) - (P.koyde ? 0.5 : 0) - (P.kadin && DOGU(P.dogumBolge) && P.dogum < 1990 ? 0.7 : 0) - 0.08 * Object.values(P.ace).filter(Boolean).length + (e ? 0.9 * (e.egt - 2.5) / 2 : 0);
  P.egt = egitimCek(P.dogum, P.kadin, shift);
  P.egitim = ['ilkokul', 'ilkokul', 'ilkokul', 'lise', 'universite', 'lisansustu'][P.egt];
  P.egit01 = [0, 0.1, 0.2, 0.4, 0.8, 1][P.egt];
  P.universiteSehir = P.egt >= 4 ? pick(['Ankara', 'İstanbul', 'İzmir', 'Eskişehir', 'Erzurum', 'Konya', 'Trabzon', 'Diyarbakır']) : null;
  if (!P.kadin && P.yas >= 21) {
    const yil = P.dogum + (P.egt >= 4 ? 24 : 20) + (bern(0.2) ? 1 : 0);
    const dogu = yil >= 1984 && yil <= 2002 && bern(0.38);
    P.askerlik = { yil, yer: dogu ? pick(['Hakkari', 'Şırnak', 'Tunceli', 'Siirt', 'Bitlis']) : pick(['Kars', 'Erzurum', 'Edirne', 'Çanakkale', 'Isparta', 'Kırklareli', 'Ankara', 'İzmir', 'Burdur', 'Sivas']), dogu, bedelli: P.egt >= 4 && yil > 2018 && bern(0.4) };
    if (dogu && yil <= YIL) ola(yil, `askerliğini çatışmaların yoğun olduğu yıllarda ${bul(P.askerlik.yer)} yaptı${bern(0.3) ? '; bölüğünden şehit düşen arkadaşları oldu' : ''}`, { milliyetci: P.kurt ? 0 : 0.5, kurt_sol: P.kurt ? 0.3 : -0.2 });
  }
  // --- İş hayatı ---------------------------------------------------------------
  const emekli = P.yas >= (P.kadin ? 52 : 56) && bern(P.kadin ? 0.5 : 0.85);
  const ogrenci = P.yas < 25 && P.egt >= 3 && bern(0.45);
  const calisan = !ogrenci && !emekli && bern(P.kadin ? [0.2, 0.22, 0.25, 0.33, 0.65, 0.75][P.egt] : 0.82);
  P.meslek = ogrenci ? 'ogrenci' : emekli ? 'emekli' : !calisan ? (P.kadin ? 'ev_kadini' : 'issiz') : P.koyKalan && bern(0.6) ? 'ciftci'
    : P.egt >= 4 ? pickW({ memur: 0.35, ozel_sektor_beyaz_yaka: 0.5, serbest_meslek: 0.15 }) : pickW({ isci: 0.55, esnaf: 0.22, memur: 0.08, sofor_kurye: 0.15 });
  P.sektor = { memur: P.egt >= 4 ? pick(['öğretmen', 'hemşire', 'belediye memuru', 'vergi dairesinde memur', 'polis', 'imam']) : pick(['belediye zabıtası', 'hastanede sekreter', 'polis']), isci: pick(['tekstil atölyesinde', 'otomotiv yan sanayiinde', 'inşaatta', 'gıda fabrikasında', 'mobilya atölyesinde', 'depoda', 'temizlik şirketinde']), esnaf: pick(['bakkal', P.kadin ? 'kuaför' : 'berber', 'kahvehane', 'oto tamirhanesi', 'manav', 'kuaför', 'telefoncu', 'fırın']), ozel_sektor_beyaz_yaka: pick(['bankada', 'yazılım şirketinde', 'muhasebe bürosunda', 'sigortacıda', 'reklam ajansında', 'lojistik firmasında']), serbest_meslek: pick(['avukat', 'mali müşavir', 'diş hekimi', 'mimar', 'eczacı']), sofor_kurye: pick(['servis şoförü', 'kurye', 'taksici', 'tır şoförü']), ciftci: pick(['fındık', 'pamuk', 'buğday', 'çay', 'zeytin', 'hayvancılık', 'tütün', 'kayısı']) }[P.meslek] ?? null;
  P.sendika = (P.meslek === 'isci' || P.meslek === 'memur') && bern(0.18);
  const gelirSkor = 0.45 * P.egit01 + 0.2 * ses + (calisan ? 0.15 : 0) + (['istanbul', 'marmara', 'ege'].includes(o.bolge) ? 0.08 : 0) + (P.meslek === 'emekli' ? -0.05 : 0) + 0.15 * norm();
  P.gelir = gelirSkor < 0.3 ? 'dusuk' : gelirSkor < 0.62 ? 'orta' : 'yuksek';
  // --- Değerler (sosyalleşme + deneyim) ------------------------------------------
  P.din = clamp(0.65 * din + 0.12 * (P.sertCeza ? 1 : 0) - 0.12 * P.egit01 + (P.alevi ? -0.15 : 0) + 0.14 * norm());
  P.otoriter = clamp(0.25 + 0.35 * din + 0.18 * (P.sertCeza ? 1 : 0) + 0.03 * Object.values(P.ace).filter(Boolean).length - 0.25 * P.egit01 + (P.koyKalan ? 0.05 : 0) + 0.15 * norm());
  P.ilgi = clamp(0.32 + 0.33 * P.egit01 + (P.kadin ? -0.07 : 0.05) + 0.004 * (P.yas - 18) + (P.sendika ? 0.12 : 0) + 0.18 * norm());
  // --- Tarihsel olaylar (yaşa, yere ve aileye göre maruziyet) ----------------------
  const yasIn = (y) => y - P.dogum, burada = (y) => (P.goc && y >= P.goc.yil ? P.goc.il : P.dogumIl);
  if (yasIn(1980) >= 12 && bern(0.02 + (babaBlok === 'ana_muhalefet' ? 0.05 : 0) + (P.alevi || P.kurt ? 0.05 : 0) + (babaBlok === 'milliyetci' ? 0.04 : 0))) {
    const kim2 = yasIn(1980) >= 18 && !P.kadin && bern(0.4) ? 'kendisi' : pick(['abisi', 'babası', 'amcası', 'dayısı']);
    P.darbe = 1; ola(1980, `12 Eylül darbesinden sonra ${kim2 === 'kendisi' ? 'kendisi gözaltına alındı, aylarca cezaevinde kaldı' : kim2 + ' gözaltına alındı, işkence gördü'}`, { ana_muhalefet: 0.4, kurt_sol: P.kurt ? 0.5 : 0, iktidar: -0.2 });
  }
  if (P.kurt && DOGU(P.dogumBolge) && yasIn(1995) >= 5 && bern(0.3)) { P.teror = 1; ola(1993 + Math.floor(U() * 5), `çatışmaların en sert olduğu yıllarda ${bul(burada(1994))} büyüdü; köy korucusu-gerilla ikilemi akrabalarını böldü${bern(0.35) ? ', bir amcaoğlu dağa çıktı' : ''}`, { kurt_sol: 0.6 }); }
  if (!P.kurt && bern(0.035 + (['karadeniz', 'icanadolu'].includes(P.dogumBolge) ? 0.03 : 0))) { P.sehit = 1; const y = 1987 + Math.floor(U() * 30); ola(y, `${yilda(y)} ${pick(['kuzeni', 'amcasının oğlu', 'köylüsü', 'teyzesinin oğlu'])} askerde şehit düştü; cenazede bütün köy toplandı`, { milliyetci: 0.7, kurt_sol: -0.5 }); }
  if (DEPREM99.has(burada(1999)) && yasIn(1999) >= 4) { P.deprem99 = 1; ola(1999, `17 Ağustos 1999 depremini ${bul(burada(1999))} yaşadı${bern(0.15) ? '; bir yakınını enkazda kaybetti' : ''}`, {}); }
  if (yasIn(2001) >= 20 && ['isci', 'ozel_sektor_beyaz_yaka', 'esnaf', 'sofor_kurye'].includes(P.meslek) && bern(0.14)) { P.kriz01 = 1; ola(2001, `2001 krizinde ${P.meslek === 'esnaf' ? 'dükkânını kapatmanın eşiğine geldi' : 'işten çıkarıldı'}; o yıl ailece borçla yaşadılar`, { iktidar: 0.25, ana_muhalefet: -0.15 }); }
  if (yasIn(2013) >= 16 && yasIn(2013) <= 35 && P.din < 0.4 && !P.koyKalan && bern(0.12 + 0.1 * P.egit01)) { P.gezi = 1; ola(2013, 'Gezi eylemlerinde sokaktaydı; biber gazını ilk kez orada soludu', { ana_muhalefet: 0.6, iktidar: -0.6 }); }
  if (YIL - 2016 + P.yas - YIL + 2016 >= 0 && yasIn(2016) >= 16 && P.din > 0.6 && !P.alevi && !P.kurt && bern(0.14)) { P.temmuz15 = 1; ola(2016, '15 Temmuz gecesi sela okununca sokağa çıktı, sabaha kadar köprü başında bekledi', { iktidar: 0.6 }); }
  if (P.meslek === 'memur' && yasIn(2016) >= 24 && bern(0.035)) { P.khk = 1; P.meslek = bern(0.5) ? 'issiz' : 'sofor_kurye'; ola(2016, "2016'da KHK ile kamudan ihraç edildi; pasaportu iptal edildi, yıllarca iş bulamadı", { iktidar: -1.4 }); }
  if (yasIn(2020) >= 18 && bern(0.06)) { P.covidKayip = 1; ola(2020, `pandemide ${pick(['babasını', 'annesini', 'dayısını', 'teyzesini', 'amcasını'])} kaybetti`, {}); }
  P.deprem23 = DEPREM23.has(o.il) && bern(0.75) ? (bern(0.25) ? 2 : 1) : 0;
  if (P.deprem23) ola(2023, P.deprem23 === 2 ? `6 Şubat depreminde evi yıkıldı, ${pick(['kayınbiraderini', 'yeğenini', 'komşularını', 'teyzesini ve kuzenlerini'])} kaybetti; ilk iki gün kimsenin gelmediğini anlatır` : '6 Şubat depremini yaşadı; aylarca konteynerde kaldı', {});
  // Ekonomik deneyim (2021–23 enflasyonu) ve 2018 kur krizi
  P.isKaybi = !emekli && !ogrenci && P.meslek !== 'ev_kadini' && (P.khk || bern(0.08 + (P.meslek === 'issiz' ? 0.5 : 0) + (P.gelir === 'dusuk' ? 0.06 : 0))) ? 1 : 0;
  P.borc = clamp(0.25 + 0.3 * (P.gelir === 'dusuk' ? 1 : P.gelir === 'orta' ? 0.5 : 0) + (P.isKaybi ? 0.2 : 0) + 0.15 * norm());
  P.isKaybi18 = P.isKaybi && bern(0.35) ? 1 : 0; P.borc18 = P.borc * 0.6;
  P.ez = clamp(0.35 * P.isKaybi + 0.35 * P.borc + (P.gelir === 'dusuk' ? 0.15 : 0) + (P.deprem23 === 2 ? 0.2 : 0) + 0.1 * norm());
  P.ez18 = clamp(0.35 * P.isKaybi18 + 0.35 * P.borc18 + (P.gelir === 'dusuk' ? 0.15 : 0) + 0.1 * norm());
  return P;
}

/* ============================ HANELER ============================ */
// Hane tipi (TÜİK ADNKS 2023, yaklaşık): tek kişilik %19,7; çocuksuz çift %15; çocuklu çift %42; tek ebeveyn %9; geniş aile %13
const HANE_TIPI = { tek: 0.197, cift: 0.15, cekirdek: 0.42, tek_ebeveyn: 0.09, genis: 0.143 };
function yasAraligi(tip) {
  switch (tip) {
    case 'tek': return bern(0.45) ? 20 + 12 * U() : bern(0.5) ? 33 + 30 * U() : 64 + 22 * U();
    case 'cift': return bern(0.35) ? 22 + 10 * U() : 52 + 26 * U();
    case 'cekirdek': return 27 + 31 * U() ** 1.25;
    case 'tek_ebeveyn': return 34 + 30 * U();
    default: return 36 + 26 * U();
  }
}
function evlilikKur(A, B, kadinKisi) {
  const k = kadinKisi, yil = clamp(Math.round(k.dogum + evlilikYasi(k.dogum, true, k.egt)), k.dogum + 16, YIL);
  const B0 = BOLGE[k.dogumBolge];
  const akraba = bern(lerpT(AKRABA, yil) * B0.akraba * (k.koyde ? 1.3 : 0.85) * (k.egt >= 4 ? 0.4 : 1));
  const gorucu = akraba || bern(lerpT(GORUCU, yil) * (DOGU(k.dogumBolge) ? 1.2 : 1) * (k.egt >= 4 ? 0.45 : 1));
  const akr = akraba ? pick(['teyzesinin', 'amcasının', 'halasının', 'dayısının', 'uzaktan akrabasının']) : null;
  const tanis = gorucu ? 'görücü usulüyle, aileler anlaşarak' : pick(['iş yerinde tanıştığı', ...(A.egt >= 4 && B.egt >= 4 ? ['üniversitede tanıştığı', 'üniversitede tanıştığı'] : []), 'mahalleden tanıdığı', 'bir düğünde görüp beğendiği', 'bir arkadaşının tanıştırdığı']);
  for (const [X, Y] of [[A, B], [B, A]]) {
    const nasil = akr ? (akr === 'uzaktan akrabasının' ? 'uzaktan akrabası ' + Y.ad + ' ile' : `${akr} ${Y.kadin ? 'kızı' : 'oğlu'} ${Y.ad} ile`) : gorucu ? `${tanis} ${Y.ad} ile` : `${tanis} ${Y.ad} ile`;
    X.evlilik = { yil, akraba, gorucu, nasil, esId: Y.id, esAd: Y.ad };
  }
  return yil;
}
function cocuklarKur(anne, baba, evlilikYili) {
  const tfr = lerpT(DOGURGANLIK, anne.dogum) * BOLGE[anne.bolge].dogur * (anne.egt >= 4 ? 0.75 : anne.egt === 0 ? 1.35 : 1) * (anne.koyKalan ? 1.15 : 1);
  let n = 0; for (let k = 0; k < 12; k++) if (U() < tfr / 12) n++;
  const cs = []; let y = evlilikYili + 1 + Math.floor(2 * U());
  for (let k = 0; k < n && y <= Math.min(YIL, anne.dogum + 43); k++) {
    const kad = bern(0.487);
    if (!bern(lerpT(COCUK_OLUM, y))) cs.push({ ad: adCek(kad, y, anne.kim), kadin: kad, dogum: y });
    y += 2 + Math.floor(3 * U());
  }
  return cs;
}

for (let h = 0; h < NH; h++) {
  const bolge = pickW(Object.fromEntries(Object.entries(BOLGE).map(([k, b]) => [k, b.pay])));
  const il = pick(BOLGE[bolge].iller);
  const kirsal = !METROPOL.has(il) && bern(1 - BOLGE[bolge].kent);
  const tip = pickW(HANE_TIPI);
  const H = { id: h + 1, bolge, il, kirsal, tip, uyeler: [] };
  const refYas = Math.round(yasAraligi(tip));
  const refKadin = tip === 'tek_ebeveyn' ? bern(0.82) : tip === 'tek' ? bern(refYas > 64 ? 0.72 : 0.45) : bern(0.5);
  const ref = kisiKur({ dogum: YIL - refYas, kadin: refKadin, bolge, il, kirsal });
  H.uyeler.push(ref); ref.rol = 'referans';
  const soyad = ref.soyad;
  let es = null;
  if (['cift', 'cekirdek', 'genis'].includes(tip) || (tip === 'tek_ebeveyn' && bern(0.3)) || (tip === 'tek' && bern(0.15))) {
    const esYas = refYas + (refKadin ? 1 : -1) * Math.round(3.2 + 2.5 * norm() * 0.8);
    es = kisiKur({ dogum: YIL - clamp(esYas, 18, 95), kadin: !refKadin, bolge, il, kirsal, esine: ref, soyad: refKadin ? pick(SOYAD) : soyad });
    if (refKadin) ref.kizlikSoyadi = ref.soyad, ref.soyad = es.soyad;
    const kadinK = refKadin ? ref : es, erkekK = refKadin ? es : ref;
    const ey = evlilikKur(ref, es, kadinK);
    const cocuklar = cocuklarKur(kadinK, erkekK, ey);
    if (tip === 'tek_ebeveyn' || tip === 'tek') {
      // eş öldü ya da boşandı: kişi kaydı anlatı içindir, seçmen değil
      const dul = es.yas > 60 || bern(0.35);
      ref.evlilik.bitis = dul ? { tur: 'dul', yil: clamp(Math.round(YIL - 1 - 15 * U()), ey + 2, YIL - 1) } : { tur: 'bosanma', yil: clamp(Math.round(ey + 4 + 12 * U()), ey + 1, YIL - 1) };
      ref.eskiEs = es; eskiler.push(es); es = null;
    } else { H.uyeler.push(es); es.rol = 'es'; }
    ref.cocuklar = cocuklar; if (es) es.cocuklar = cocuklar;
    // Evde yaşayan yetişkin bekâr çocuklar (Türkiye'de çocuklar çoğunlukla evlenene kadar ailesiyle yaşar)
    for (const c of cocuklar) {
      const cy = YIL - c.dogum;
      c.evli = cy >= 22 && bern(clamp((cy - 21) / 9, 0, 0.9));
      if (tip === 'tek') { c.evdeYasar = false; continue; }
      c.evdeYasar = !c.evli && (cy < 18 || bern(cy < 30 ? 0.85 : 0.5));
      if (c.evdeYasar && cy >= 18) {
        const ck = kisiKur({ dogum: c.dogum, kadin: c.kadin, bolge, il, kirsal, kokenBolge: bolge, kim: { kurt: kadinK.kurt, alevi: kadinK.alevi, arap: kadinK.arap }, soyad: erkekK.soyad });
        ck.ad = c.ad; ck.rol = 'cocuk'; ck.aile = { ...ck.aile, babaAd: erkekK.ad, anneAd: kadinK.ad, babaDogum: erkekK.dogum, anneDogum: kadinK.dogum, babaEgt: erkekK.egt, anneEgt: kadinK.egt,
          babaMeslek: erkekK.meslek, anneMeslek: kadinK.meslek, babaHayatta: !(ref.evlilik.bitis?.tur === 'dul' && ref.eskiEs === erkekK), anneHayatta: true, babaBlok: null, anneBlok: null, ebeveynKisi: [erkekK.id, kadinK.id] };
        ck.koyde = kirsal; ck.goc = null; ck.dogumIl = il; ck.dogumBolge = bolge;
        ck.kardesler = cocuklar.filter((x) => x !== c).map((x) => ({ ad: x.ad, kadin: x.kadin, dogum: x.dogum, buyuk: x.dogum < c.dogum, evli: x.evli, yer: x.evdeYasar ? 'ev' : 'il' }));
        c.kisi = ck; H.uyeler.push(ck);
      }
    }
    // Kardeş listesi çocukların hepsi belirlendikten sonra (evde yaşayan küçük kardeşler 'ev')
    for (const c of cocuklar) if (c.kisi) c.kisi.kardesler = cocuklar.filter((x) => x !== c).map((x) => ({ ad: x.ad, kadin: x.kadin, dogum: x.dogum, buyuk: x.dogum < c.dogum, evli: x.evli, yer: x.evdeYasar ? 'ev' : 'il' }));
  }
  // Geniş aile: dul kalmış yaşlı ebeveyn (çoğunlukla erkeğin annesi) hanede
  if (tip === 'genis') {
    const erkek = ref.kadin ? es : ref;
    const anneK = erkek && bern(0.75);
    const yas = erkek ? clamp(erkek.yas + 25 + Math.round(4 * norm() * 0.6), 60, 96) : 70;
    const yasli = kisiKur({ dogum: YIL - yas, kadin: anneK, bolge, il, kirsal, kokenBolge: erkek?.dogumBolge, kim: erkek ? { kurt: erkek.kurt, alevi: erkek.alevi, arap: erkek.arap } : undefined, soyad: erkek?.soyad });
    yasli.rol = 'yasli_ebeveyn'; yasli.dul = true;
    if (erkek) { yasli.ad = anneK ? erkek.aile.anneAd : erkek.aile.babaAd; yasli.cocukKisi = erkek.id; erkek.aile[anneK ? 'anneHayatta' : 'babaHayatta'] = true; erkek.aile.evdekiEbeveyn = yasli.id; yasli.blokEbeveyn = anneK ? erkek.aile.anneBlok : erkek.aile.babaBlok; }
    H.uyeler.push(yasli);
  }
  for (const m of H.uyeler) { m.hane = H.id; kisiler.push(m); }
  haneler.push(H);
}
const byId = new Map([...kisiler, ...eskiler].map((k) => [k.id, k]));

/* ============================ İLETİŞİM EKOLOJİSİ ============================ */
// Kanal türü → seçeneklere eğilim (üretim tarafının medya içeriği; karar modelinin bağlam tablosundan bağımsız)
const KANAL = {
  hukumete_yakin_kanal: { ad: ['ATV', 'A Haber', 'TRT 1', 'Kanal 7', 'Ülke TV', 'Beyaz TV'], v: [1, -0.6, -0.1, -0.8, -0.1] },
  muhalif_kanal: { ad: ['Halk TV', 'Sözcü TV', 'Tele1'], v: [-0.9, 0.8, 0.25, 0.05, 0] },
  ana_akim_kanal: { ad: ['Show TV', 'Kanal D', 'Star TV', 'NOW'], v: [0.25, 0, 0, -0.2, 0.1] },
  hukumete_yakin_hesaplar: { ad: ['X\'te hükümete yakın hesaplar', 'YouTube\'da hükümete yakın yorumcular'], v: [1, -0.7, 0, -0.8, -0.1] },
  muhalif_hesaplar: { ad: ['X\'te muhalif gazeteciler', 'YouTube\'da muhalif yayınlar'], v: [-1, 0.8, 0.25, 0.1, 0] },
  kurt_medyasi: { ad: ['Kürtçe yayın yapan sosyal medya hesapları', 'Arti TV ve bölgesel hesaplar'], v: [-0.8, -0.1, -0.7, 1.1, 0] },
  karisik_akis: { ad: ['Instagram ve TikTok akışı'], v: [0, 0, 0.05, 0, 0.35] },
};
for (const P of kisiler) {
  const dij = clamp(1.1 - 0.018 * (P.yas - 18) + 0.35 * P.egit01 + 0.1 * norm());
  P.dijital = dij;
  P.tvSaat = Math.round(clamp(3.3 + 0.03 * (P.yas - 40) - 0.9 * P.egit01 + (P.meslek === 'ev_kadini' || P.meslek === 'emekli' ? 0.9 : 0) + 1.1 * norm(), 0, 9) * 2) / 2;
  P.sosyalSaat = Math.round(clamp(dij * 4 - 0.6 + 0.9 * norm(), 0, 8) * 2) / 2;
  P.whatsappAile = dij > 0.25 && bern(0.75);
  P.cami = !P.kadin && !P.alevi && P.din > 0.55 && bern(0.75);
  P.cemevi = P.alevi && bern(0.35 + 0.3 * (P.yas > 45 ? 1 : 0));
  P.kahve = !P.kadin && P.yas > 30 && P.meslek !== 'ozel_sektor_beyaz_yaka' && bern(0.45 + (P.koyKalan ? 0.3 : 0));
  P.gun = P.kadin && P.yas > 30 && bern(0.4);
  P.cemaat = P.din > 0.7 && bern(0.2);
  P.dernek = P.goc && !P.goc.zorunlu && bern(0.18) ? `${cik(P.dogumIl).split("'")[0]} hemşehri derneği` : null;
}

/* ============================ OY SÜRECİ (üretim) ============================ */
// 1) 18 yaşında sosyalleşme eğilimi (aile soyu, kimlik, din) + hayat olaylarının izleri + yapısal konum
function yapisal(P) {
  const s = new Array(5).fill(0), a = P.aile;
  const bb = a.babaBlok ?? (P.aile.ebeveynKisi ? null : null), ab = a.anneBlok;
  if (bb) s[AI[bb]] += 1.3; if (ab) s[AI[ab]] += 0.6;
  s[AI.iktidar] += 1.9 * P.din + 1.0 * P.otoriter - 1.6 * (P.alevi ? 1 : 0) - 1.4 * (P.kurt ? 1 : 0) * (1 - 0.6 * P.din) + 0.5 * (P.koyKalan ? 1 : 0) + 0.012 * (P.yas - 40) - 0.4 * P.egit01 + (P.meslek === 'esnaf' ? 0.3 : 0);
  s[AI.ana_muhalefet] += 1.8 * (P.alevi ? 1 : 0) + 1.4 * (1 - P.din) + 0.6 * P.egit01 + (P.bolge === 'ege' ? 0.6 : P.bolge === 'istanbul' ? 0.25 : 0) - 0.9 * (P.kurt ? 1 : 0) + (P.sendika ? 0.3 : 0);
  s[AI.milliyetci] += 1.4 * P.otoriter + (P.kadin ? -0.3 : 0.25) + (P.yas < 35 ? 0.35 : 0) - 2.5 * (P.kurt ? 1 : 0) - 0.6 * (P.alevi ? 1 : 0) + 0.6 * BOLGE[P.bolge].multeci * (P.kurt ? 0 : 1);
  s[AI.kurt_sol] += (P.kurt ? 3.2 - 1.6 * P.din : -3) + (P.yas < 35 ? 0.4 : 0) + (P.alevi && !P.kurt ? 0.2 : 0);
  s[AI.oy_yok] += 1.6 * (1 - P.ilgi) + (P.yas < 25 ? 0.6 : 0) + 0.12 * Object.values(P.ace).filter(Boolean).length - 0.6 * P.egit01 + (P.goc && P.goc.yil > YIL - 3 ? 0.6 : 0);
  return s.map((v, j) => v + P.etki[j]);
}
for (const P of [...kisiler, ...eskiler]) {
  P.tat = ALTS.map(() => 0.55 * norm());
  P.a = yapisal(P).map((v, j) => v + P.tat[j]);
}
// Yetişkin çocukların ve yaşlı ebeveynin "aile soyu" — hanedeki gerçek ebeveynin eğilimi (aşağıda dinamikte de birbirlerini etkilerler)
for (const P of kisiler) {
  if (P.aile.ebeveynKisi) { const [b, an] = P.aile.ebeveynKisi.map((id) => byId.get(id)); const pb = softmax(b.a), pa = softmax(an.a); P.a = P.a.map((v, j) => v + 1.1 * pb[j] + 0.6 * pa[j]); P.aile.babaBlok = ALTS[pb.indexOf(Math.max(...pb))]; P.aile.anneBlok = ALTS[pa.indexOf(Math.max(...pa))]; }
  if (P.rol === 'yasli_ebeveyn' && P.blokEbeveyn) P.a[AI[P.blokEbeveyn]] += 0.8;
}
// Evlilik içinde yıllar boyunca karşılıklı uyum (Zuckerman 2005; Stoker & Jennings 2005): evlilik yılıyla artan yakınsama
for (const P of kisiler) {
  if (!P.evlilik || P.evlilik.bitis || P._uyum) continue;
  const E = byId.get(P.evlilik.esId); if (!E || !kisiler.includes(E)) continue;
  const k = 1.6 * Math.min(1, (2015 - P.evlilik.yil) / 20);
  if (k <= 0) continue;
  const qa = softmax(P.a), qb = softmax(E.a);
  P.a = P.a.map((v, j) => v + k * (qb[j] - qa[j]) * (0.6 + 0.4 * (1 - P.ilgi)));
  E.a = E.a.map((v, j) => v + k * (qa[j] - qb[j]) * (0.6 + 0.4 * (1 - E.ilgi)));
  P._uyum = E._uyum = true;
}
// Medya seçimi: seçici maruziyet (Stroud) — mevcut eğilime göre kanal
for (const P of kisiler) {
  const q = softmax(P.a);
  const tvTur = P.kurt && q[AI.kurt_sol] > 0.4 && bern(0.5) ? 'kurt_medyasi' : pickW({ hukumete_yakin_kanal: 0.15 + 1.6 * q[AI.iktidar] + 0.4 * q[AI.milliyetci], muhalif_kanal: 0.1 + 1.5 * q[AI.ana_muhalefet] + 0.3 * q[AI.milliyetci] + 0.2 * q[AI.kurt_sol], ana_akim_kanal: 0.35 + 0.4 * q[AI.oy_yok] });
  const sosTur = P.kurt && q[AI.kurt_sol] > 0.35 ? 'kurt_medyasi' : pickW({ hukumete_yakin_hesaplar: 0.1 + 1.2 * q[AI.iktidar], muhalif_hesaplar: 0.1 + 1.4 * (q[AI.ana_muhalefet] + q[AI.milliyetci] * 0.6), karisik_akis: 0.3 + 0.8 * q[AI.oy_yok] + 0.3 * (P.yas < 30 ? 1 : 0) });
  P.tvTur = tvTur; P.sosTur = sosTur;
  P.tvKanal = pick(KANAL[tvTur].ad); P.sosKanal = pick(KANAL[sosTur].ad);
  P.anaKaynak = P.sosyalSaat > P.tvSaat ? 'sosyal' : 'tv';
}
// Hane dışı tartışma ağı: adı konmuş kişiler (kardeşler, akrabalar, komşular, iş arkadaşları, kanaat önderleri)
const yerelHavuz = {};
for (const P of kisiler) (yerelHavuz[P.il] ||= []).push(P);
function disKisi(P, iliski, blokOlas) {
  const kad = /abla|kız|teyze|hala|komşu kadın|gelin|elti|görümce/.test(iliski) ? true : /abi|amca|dayı|enişte|imam|dede|muhtar|usta|öğretmen|bey|kahve/.test(iliski) ? false : bern(0.5);
  return { iliski, ad: adCek(kad, P.dogum + Math.round(10 * norm()), P.kim), blok: blokOlas };
}
for (const P of kisiler) {
  const ag = [];
  const H = haneler[P.hane - 1];
  for (const m of H.uyeler) if (m !== P) ag.push({ kisi: m.id, iliski: (P.rol === 'referans' && m.rol === 'es') || (P.rol === 'es' && m.rol === 'referans') ? 'eşi' : P.rol === 'cocuk' && (m.rol === 'referans' || m.rol === 'es') ? (m.kadin ? 'annesi' : 'babası') : m.rol === 'cocuk' ? (P.rol === 'cocuk' ? (m.kadin ? 'kız kardeşi' : 'erkek kardeşi') : (m.kadin ? 'kızı' : 'oğlu')) : m.rol === 'yasli_ebeveyn' ? (P.cocuklar?.length || P.rol === 'es' || P.rol === 'referans' ? (P.id === m.cocukKisi ? (m.kadin ? 'annesi' : 'babası') : (m.kadin ? 'kayınvalidesi' : 'kayınpederi')) : (m.kadin ? 'babaannesi' : 'dedesi')) : (P.rol === 'cocuk' ? (m.kadin ? 'annesi' : 'babası') : 'ev arkadaşı'), ad: m.ad, siklik: (P.rol === 'referans' && m.rol === 'es') || (P.rol === 'es' && m.rol === 'referans') ? 3 : 1 });
  // Hane dışı ebeveynler, kardeşler, evden ayrılmış çocuklar
  if (!P.aile.ebeveynKisi && P.rol !== 'yasli_ebeveyn') {
    if (P.aile.babaHayatta && !P.aile.evdekiEbeveyn) ag.push({ iliski: 'babası', ad: P.aile.babaAd, blok: P.aile.babaBlok, siklik: 0.4 });
    if (P.aile.anneHayatta && !P.aile.evdekiEbeveyn) ag.push({ iliski: 'annesi', ad: P.aile.anneAd, blok: P.aile.anneBlok, siklik: 0.4 });
  }
  for (const s of (P.kardesler || []).filter((s) => !s.olu && s.blok && s.yer !== 'ev').slice(0, 2)) ag.push({ iliski: s.kadin ? (s.buyuk ? 'ablası' : 'kız kardeşi') : (s.buyuk ? 'abisi' : 'erkek kardeşi'), ad: s.ad, blok: s.blok, siklik: s.yer === 'almanya' ? 0.15 : 0.35 });
  for (const c of (P.cocuklar || []).filter((c) => !c.evdeYasar && YIL - c.dogum >= 18).slice(0, 2)) { c.blok ||= bern(0.55) ? ALTS[softmax(P.a).indexOf(Math.max(...softmax(P.a)))] : pickW({ iktidar: 0.35, ana_muhalefet: 0.35, milliyetci: 0.1, kurt_sol: P.kurt ? 0.4 : 0.03, oy_yok: 0.2 }); ag.push({ iliski: c.kadin ? 'evli kızı' : 'evli oğlu', ad: c.ad, blok: c.blok, siklik: 0.35 }); }
  // Yerel çevre: homofilik eşleşme — aynı ildeki benzer kişilerden (eğilimleri onlarınki)
  const havuz = yerelHavuz[P.il];
  const k = 2 + Math.round(4 * P.ilgi);
  for (let q = 0; q < k; q++) {
    let best = null, bs = -Infinity;
    for (let c = 0; c < 12; c++) { const x = pick(havuz); if (x === P || x.hane === P.hane) continue; const d = Math.abs(x.din - P.din) + Math.abs(x.egit01 - P.egit01) + (x.kim !== P.kim ? 1.2 : 0) + Math.abs(x.yas - P.yas) / 30; const s = -2 * d + gumbel(); if (s > bs) { bs = s; best = x; } }
    if (!best) continue;
    const rol = P.meslek === 'isci' || P.meslek === 'memur' || P.meslek === 'ozel_sektor_beyaz_yaka' ? pick(['iş arkadaşı', 'komşusu', 'arkadaşı']) : P.kahve ? pick(['kahvedeki arkadaşı', 'komşusu']) : P.gun ? pick(['gün arkadaşı', 'komşu kadın']) : pick(['arkadaşı', 'komşusu', 'kuzeni']);
    ag.push({ kisiYerel: best.id, iliski: best.kadin && /kahve/.test(rol) ? 'komşusu' : !best.kadin && /gün arkadaşı|komşu kadın/.test(rol) ? 'komşusu' : rol, ad: best.ad, siklik: 0.5 });
  }
  // Kanaat önderi (Katz & Lazarsfeld): bağlama göre adı konmuş biri
  const onder = P.cami ? { iliski: 'mahallenin imamı', blok: bern(0.8) ? 'iktidar' : 'milliyetci' } : P.cemevi ? { iliski: 'cemevindeki dede', blok: bern(0.75) ? 'ana_muhalefet' : 'kurt_sol' } : P.kahve ? { iliski: 'kahvede herkesin dinlediği emekli öğretmen', blok: pickW({ iktidar: 0.35, ana_muhalefet: 0.4, milliyetci: 0.2, kurt_sol: P.kurt ? 0.5 : 0.02 }) }
    : P.sendika ? { iliski: 'sendika temsilcisi', blok: pickW({ ana_muhalefet: 0.5, kurt_sol: 0.2, iktidar: 0.3 }) } : P.koyKalan ? { iliski: 'köyün muhtarı', blok: bern(0.65) ? 'iktidar' : pick(ALTS.slice(1, 4)) } : P.cemaat ? { iliski: 'cemaatteki ağabey/abla', blok: 'iktidar' } : null;
  if (onder) ag.push({ ...disKisi(P, onder.iliski, onder.blok), siklik: 0.45, onder: true });
  P.ag = ag;
}

// 2) 2015–2023: yıl yıl iletişim süreci. Medya dozu × güvenilirlik; karşıt medyada geri tepme (düşmanca
// medya etkisi, Vallone vd. 1985); konuşmalar (hane üyeleri eş zamanlı, dış çevre kendi eğilimiyle).
const asc0 = new Array(5).fill(0);
for (let it = 0; it < 60; it++) { const m = new Array(5).fill(0); for (const P of kisiler) softmax(P.a.map((v, j) => v + asc0[j])).forEach((q, j) => { m[j] += q / kisiler.length; }); ALTS.forEach((a, j) => { asc0[j] += 0.8 * Math.log(HEDEF15[a] / m[j]); }); }
const pref = (P) => softmax(P.a.map((v, j) => v + asc0[j]));
const kosul = (yil) => ({ tehdit: yil >= 2015 && yil <= 2017 ? 0.6 : 0.25, ekonomi: yil <= 2017 ? 0 : yil <= 2020 ? 0.5 : 1, deprem: yil >= 2023 });
function yilAdimi(yil) {
  const k = kosul(yil);
  const Q = new Map(kisiler.map((P) => [P.id, pref(P)]));
  for (const P of kisiler) {
    const q = Q.get(P.id), d = new Array(5).fill(0);
    // Medya: iki kanal, saatle doz (azalan getiri), dikkat (ilgi) ile
    for (const [tur, saat] of [[P.tvTur, P.tvSaat], [P.sosTur, P.sosyalSaat]]) {
      const v = KANAL[tur].v, doz = Math.log1p(saat) / Math.log(9) * (0.4 + 0.6 * P.ilgi);
      const uyum = v.reduce((s, x, j) => s + x * q[j], 0);
      const f = uyum < -0.35 ? -0.35 : 1;   // düşmanca medya: karşıt içerik ters teper
      for (let j = 0; j < 5; j++) d[j] += 0.09 * doz * f * v[j];
    }
    // Konuşma ağı
    let W = 0; const m = new Array(5).fill(0);
    for (const c of P.ag) {
      const qc = c.kisi ? Q.get(c.kisi) : c.kisiYerel ? Q.get(c.kisiYerel) : ALTS.map((a) => (a === c.blok ? 0.75 : 0.0625));
      const w = c.siklik * (c.onder ? 1.4 : 1);
      W += w; for (let j = 0; j < 5; j++) m[j] += w * qc[j];
    }
    if (W) for (let j = 0; j < 5; j++) d[j] += 0.16 * (1.2 - 0.5 * P.ilgi) * (m[j] / W - q[j]);
    // Deneyim: ekonomi (partizan algı perdesi: iktidar yanlısının zararı daha az cezalandırması), tehdit, deprem
    const perde = q[AI.iktidar] > 0.6 ? 0.45 : 1, ezYil = k.ekonomi * (yil >= 2021 ? P.ez : P.ez18);
    d[AI.iktidar] -= 0.22 * ezYil * perde; d[AI.ana_muhalefet] += 0.08 * ezYil; d[AI.oy_yok] += 0.05 * ezYil;
    d[AI.milliyetci] += 0.06 * k.tehdit * P.otoriter * (P.kurt ? 0 : 1); d[AI.iktidar] += 0.04 * k.tehdit * P.otoriter;
    if (k.deprem && P.deprem23) d[AI.iktidar] -= (P.deprem23 === 2 ? 0.6 : 0.2) * (P.tvTur === 'hukumete_yakin_kanal' ? 0.35 : 1);   // "devlet sahada" çerçevesi deneyimi yumuşatır
    P.d = d;
  }
  for (const P of kisiler) for (let j = 0; j < 5; j++) P.a[j] += P.d[j];
}
for (let yil = 2015; yil <= 2018; yil++) yilAdimi(yil);
// 2018 oyu (panelin ilk dalgası)
// Sandıktaki seçim: eğilimlerin ölçeği (KESIN) bireysel oyun ne kadar belirlenmiş olduğunu ayarlar (panel tutarlılığı ~%75)
const KESIN = 1.7;
const oyVer = (hedef, ek = () => 0) => {
  const asc = new Array(5).fill(0), V = (P) => P.a.map((v, j) => KESIN * (v + asc[j] + ek(P, j)));
  for (let it = 0; it < 80; it++) { const m = new Array(5).fill(0); for (const P of kisiler) softmax(V(P)).forEach((q, j) => { m[j] += q / kisiler.length; }); ALTS.forEach((a, j) => { asc[j] += 0.6 * Math.log(hedef[a] / m[j]) / KESIN; }); }
  return kisiler.map((P) => ALTS[choose(V(P))]);
};
oyVer(HEDEF18).forEach((v, i) => { kisiler[i].oy18 = v; });
for (let yil = 2019; yil <= 2023; yil++) yilAdimi(yil);
// 2023 oyu — alışkanlık (2018 oyu) + son durum
oyVer(HEDEF, (P, j) => (P.oy18 === ALTS[j] ? 0.9 : 0)).forEach((v, i) => { kisiler[i].oy = v; });

/* ============================ ÖLÇÜLEN SÜTUNLAR ============================ */
const tri = (v, a, b) => (v < a ? 'dusuk' : v < b ? 'orta' : 'yuksek');
const r2 = (x) => Math.round(x * 100) / 100;
// İl "resmî sonuçları" ve mahalle payları
const ilPay = {};
for (const P of kisiler) { const o = (ilPay[P.il] ||= { n: 0, s: new Array(5).fill(0) }); o.n++; o.s[AI[P.oy]]++; }
const IL = Object.fromEntries(Object.entries(ilPay).map(([k, v]) => [k, v.s.map((x) => (x + 0.5) / (v.n + 2.5))]));
const rows = kisiler.map((P) => {
  const q = pref(P), H = haneler[P.hane - 1];
  const progov = P.tvTur === 'hukumete_yakin_kanal' || P.sosTur === 'hukumete_yakin_hesaplar';
  const muhalif = P.tvTur === 'muhalif_kanal' || P.sosTur === 'muhalif_hesaplar' || P.tvTur === 'kurt_medyasi';
  const ideo = clamp(0.5 + 0.35 * (P.din - 0.5) + 0.3 * (P.otoriter - 0.4) + (P.alevi ? -0.2 : 0) + (P.kurt ? -0.15 : 0) + 0.15 * norm());
  const tehdit = clamp(0.2 + 0.3 * (P.teror || 0) + 0.25 * (P.sehit || 0) + 0.25 * BOLGE[P.bolge].multeci * (P.kurt ? 0.3 : 1) + 0.25 * P.otoriter + 0.04 * P.tvSaat * (progov ? 1 : 0.4) + (P.deprem23 === 2 ? 0.1 : 0) + 0.1 * norm());
  const guven = clamp(0.35 + (progov ? 0.3 : muhalif ? -0.15 : 0) + 0.25 * (q[AI.iktidar] - 0.4) - 0.03 * Object.values(P.ace).filter(Boolean).length - (P.alevi || P.kurt ? 0.1 : 0) + (P.khk ? -0.3 : 0) + 0.12 * norm());
  // Algılanan eş oyu ve ağ payları (algı hatası: suskunluk sarmalı — azınlıktaki kişi sesini kısar, çoğunluğa sayılır)
  const esK = P.evlilik && !P.evlilik.bitis ? byId.get(P.evlilik.esId) : null;
  const esOyu = esK && esK.oy ? (bern(0.85) ? esK.oy : ALTS[softmax(esK.a).indexOf(Math.max(...softmax(esK.a)))]) : '';
  const say = new Array(5).fill(0); let n = 0;
  const ilMaj = IL[P.il].indexOf(Math.max(...IL[P.il]));
  for (const c of P.ag) {
    if (c.iliski === 'eşi') continue;
    let v = c.kisi ? AI[byId.get(c.kisi).oy] : c.kisiYerel ? AI[byId.get(c.kisiYerel).oy] : AI[c.blok];
    if (v === undefined) continue;
    if (v !== ilMaj && bern(0.15)) v = ilMaj;
    say[v]++; n++;
  }
  const evdeCocuk = (P.cocuklar || []).filter((c) => c.evdeYasar).length;
  const ebeveynBlok = P.aile.babaBlok ?? '';
  const terr = P.teror || 0;
  return {
    kisi: P.id, hane: P.hane, yas: P.yas, cinsiyet: P.kadin ? 'kadin' : 'erkek', egitim: P.egitim, gelir: P.gelir, yerlesim: H.kirsal ? 'kirsal' : METROPOL.has(P.il) ? 'metropol' : 'kent',
    ideoloji: ideo < 0.38 ? 'sol' : ideo < 0.6 ? 'merkez' : 'sag', dindarlik: tri(P.din, 0.33, 0.62),
    dijital: tri(P.dijital, 0.4, 0.7), medya: P.anaKaynak, medya_kaynagi: P.anaKaynak === 'sosyal' ? P.sosTur : P.tvTur,
    kurumsal_guven: tri(guven, 0.35, 0.6), bilissel_ihtiyac: P.ilgi > 0.55 ? 'yuksek' : 'dusuk',
    kanaat_onderi: P.ilgi > 0.7 && P.ag.length >= 7 ? 'evet' : 'hayir',
    azinlik_kimlik: P.kurt || P.alevi ? 'evet' : 'hayir', etnik_koken: P.kurt ? 'kurt' : P.arap ? 'arap' : 'turk', inanc: P.alevi ? 'alevi' : 'sunni',
    otoriterlik: Math.round(clamp(P.otoriter + 0.12 * norm()) * 4) / 4,
    ekonomi_algisi: r2(clamp(-0.3 - 0.9 * P.ez + 0.8 * (q[AI.iktidar] - 0.4) + (progov ? 0.25 : muhalif ? -0.15 : 0) + 0.25 * norm(), -1, 1)),
    hane_algisi: r2(clamp(-0.2 - 1.1 * P.ez + 0.2 * norm(), -1, 1)),
    tehdit_algisi: r2(tehdit), travma_skoru: Object.values(P.ace).filter(Boolean).length + (P.sertCeza ? 1 : 0), cocuklukta_sert_ceza: P.sertCeza ? 1 : 0,
    zorunlu_goc: P.goc?.zorunlu ? 1 : 0, teror_maruziyeti: terr, sehit_yakini: P.sehit || 0,
    deprem_maruziyeti: P.deprem23 || (P.deprem99 ? 1 : 0), is_kaybi: P.isKaybi, borc_yuku: r2(P.borc),
    ic_goc: P.goc ? 1 : 0, meslek: P.meslek, medeni_durum: P.evlilik ? (P.evlilik.bitis ? P.evlilik.bitis.tur : 'evli') : P.dul ? 'dul' : 'bekar', cocuk_sayisi: (P.cocuklar || []).length,
    es_oyu: esOyu, ebeveyn_oyu: ebeveynBlok, onceki: P.oy18,
    ekonomi_algisi_2018: r2(clamp(-0.05 - 0.9 * P.ez18 + 0.8 * (q[AI.iktidar] - 0.4) + (progov ? 0.25 : muhalif ? -0.15 : 0) + 0.25 * norm(), -1, 1)),
    hane_algisi_2018: r2(clamp(-0.1 - 1.1 * P.ez18 + 0.2 * norm(), -1, 1)), tehdit_algisi_2018: r2(clamp(tehdit + 0.1 + 0.08 * norm())),
    is_kaybi_2018: P.isKaybi18, borc_yuku_2018: r2(P.borc18), deprem_maruziyeti_2018: P.deprem99 ? 1 : 0,
    ...Object.fromEntries(ALTS.map((a, j) => ['ag_' + a, n ? r2(say[j] / n) : ''])),
    ...Object.fromEntries(ALTS.map((a, j) => ['cevre_' + a, r2(0.6 * IL[P.il][j] + 0.4 * q[j])])),
    // Yeni (hane ve iletişim ekolojisi) — ankette sorulabilir
    siyasi_ilgi: r2(clamp(P.ilgi + 0.1 * norm())), tv_saat: P.tvSaat, sosyal_saat: P.sosyalSaat, tv_kanal_turu: P.tvTur, sosyal_kaynak_turu: P.sosTur,
    hane_buyuklugu: H.uyeler.length + (P.cocuklar || []).filter((c) => c.evdeYasar && YIL - c.dogum < 18).length, hane_tipi: H.tip, evde_cocuk: evdeCocuk,
    kardes_sayisi: (P.kardesler || []).filter((s) => !s.olu).length, akraba_evliligi: P.evlilik?.akraba ? 1 : 0, gorucu_usulu: P.evlilik?.gorucu ? 1 : 0,
    gurbetci_akraba: P.gurbet ? 1 : 0, askerlik_dogu: P.askerlik?.dogu ? 1 : 0, darbe_maruziyeti: P.darbe || 0, khk: P.khk || 0,
    cami_cemevi: P.cami ? 'cami' : P.cemevi ? 'cemevi' : 'hayir', sendika: P.sendika ? 1 : 0, whatsapp_aile: P.whatsappAile ? 1 : 0,
    il: P.il, bolge_adi: P.bolge, secim: P.oy,
  };
});

/* ============================ ANLATI ============================ */
const EGT_AD = ['okula hiç gidemedi', 'ilkokulu bitirdi', 'ortaokulu bitirdi', 'liseyi bitirdi', 'üniversiteyi bitirdi', 'yüksek lisans yaptı'];
const MESLEK_AD = { ciftci: 'çiftçi', coban: 'çoban', imam: 'köy imamı', muhtar: 'muhtar', isci: 'işçi', ogretmen: 'öğretmen', memur: 'memur', doktor: 'doktor', muhendis: 'mühendis', avukat: 'avukat', esnaf: 'esnaf', sofor: 'şoför', insaat_ustasi: 'inşaat ustası', ozel_sektor_beyaz_yaka: 'özel sektör çalışanı', serbest_meslek: 'serbest meslek sahibi', sofor_kurye: 'şoför', emekli: 'emekli', ev_kadini: 'ev hanımı', issiz: 'işsiz', ogrenci: 'öğrenci', hemsire: 'hemşire' };
const yasiSoz = (d) => `${YIL - d} yaşında`;
function oyku(P, row) {
  const s = [], A = P.aile, H = haneler[P.hane - 1];
  const kok = `${P.kurt ? 'Kürt' : P.arap ? 'Arap' : 'Türk'}${P.alevi ? ' Alevi' : ' Sünni'}`;
  // Köken ve anne-baba
  s.push(`${P.ad} ${P.soyad}${P.kizlikSoyadi ? ` (kızlık soyadı ${P.kizlikSoyadi})` : ''}, ${yilda(P.dogum)} ${P.koyde ? yon(P.dogumIl) + ' bağlı bir köyde' : bul(P.dogumIl)} doğdu; ${kok} bir ailenin ${(P.kardesler || []).length ? (P.kardesler.length + 1) + ' çocuğundan biri' : 'tek çocuğu'}.`);
  if (P.rol !== 'cocuk') {
    s.push(`Babası ${A.babaAd} ${MESLEK_AD[A.babaMeslek] ?? A.babaMeslek}${A.babaEgt <= 1 ? (A.babaEgt === 0 ? ', okuma yazması yoktu' : ', ilkokul mezunu') : A.babaEgt >= 4 ? (A.babaHayatta ? ', üniversite mezunu' : ', üniversite mezunuydu') : ''}; annesi ${A.anneAd} ${A.anneMeslek}${A.anneEgt === 0 ? ', hiç okula gitmemişti' : ''}.`);
    s.push(`Evde din ${A.din > 0.66 ? 'hayatın merkezindeydi' : A.din > 0.4 ? 'gelenek olarak yaşanırdı' : 'pek konuşulmazdı'}; babası ${A.babaBlok === 'oy_yok' ? 'sandığa pek gitmez, siyasete "devlet işi" derdi' : 'yıllarca ' + soyAnlat(A.babaBlok, A.babaDogum, A.din > 0.6) + ' oy verdi'}${A.anneBlok !== A.babaBlok ? `, annesi ise sandıkta ${PARTI_KISA[A.anneBlok] === 'siyasetten uzak' ? 'çoğu zaman oy kullanmazdı' : 'gizlice ' + PARTI_KISA[A.anneBlok] + ' çizgisine yakındı'}` : ''}.`);
    const olum = [];
    if (!A.babaHayatta) olum.push(`babasını ${yilda(A.babaOlum)} ${A.babaOlum - P.dogum < 16 ? 'henüz çocukken' : ''} kaybetti`.replace(/  /g, ' '));
    if (!A.anneHayatta) olum.push(`annesini ${yilda(A.anneOlum)} kaybetti`);
    if (A.evdekiEbeveyn) olum.push(`${byId.get(A.evdekiEbeveyn).kadin ? 'annesi' : 'babası'} dul kaldı ve şimdi onlarla yaşıyor`);
    else if (A.babaHayatta && A.anneHayatta) olum.push(`anne babası hayatta, ${P.goc ? 'memlekette' : 'yakınlarda'} yaşıyor`);
    if (olum.length) s.push(Buyuk(olum.join('; ')) + '.');
  } else {
    s.push(`Annesi ${A.anneAd}, babası ${A.babaAd}; ailenin evinde yaşıyor.`);
  }
  // Kardeşler
  const ks = (P.kardesler || []);
  const olu = ks.filter((k) => k.olu);
  const kt = ks.filter((k) => !k.olu).slice(0, 4).map((k) => {
    const rol = k.kadin ? (k.buyuk ? 'ablası' : 'kız kardeşi') : (k.buyuk ? 'abisi' : 'erkek kardeşi');
    if (k.yer === 'almanya') return `${rol} ${k.ad} ${yilda(k.gurbetYil)} işçi olarak ${yon(k.sehir)} gitti, orada kaldı`;
    if (k.yer === 'ev') return `${rol} ${k.ad} ${back(k.ad) ? 'da' : 'de'} evde`;
    return `${rol} ${k.ad} ${k.yer === 'koy' ? 'köyde' : k.yer === 'il' ? 'memlekette' : bul(k.yer)}${k.meslek ? ', ' + k.meslek : ''}${k.evli ? ', evli' : ''}`;
  });
  if (kt.length) s.push(Buyuk(kt.join('; ')) + '.');
  if (olu.length) s.push(`${olu.length === 1 ? 'Bir kardeşi' : olu.length + ' kardeşi'} bebekken öldü${olu[0].dogum < 1975 ? '; köyde doktor yoktu' : ''}.`);
  // Çocukluk
  const t = [];
  if (P.ace.yoksulluk) t.push('evde yiyecek sıkıntısı çekilen kışlar oldu');
  if (P.ace.siddet) t.push('evde şiddete tanık oldu');
  if (P.ace.bosanma) t.push('anne babası ayrıldı');
  if (P.ace.alkol) t.push('babasının içki sorunu evin havasını belirledi');
  if (P.sertCeza) t.push('itaat bekleyen sert bir terbiyeyle, dayakla büyütüldü');
  s.push(t.length ? `Çocukluğunda ${t.join('; ')}.` : 'Çocukluğu görece sakin geçti.');
  if (P.goc && !P.goc.zorunlu && P.goc.il === P.dogumIl) s.push(`${yilda(P.goc.yil)} ${P.goc.neden === 'aile' ? 'ailesiyle birlikte' : 'iş bulmak için'} köyden ${P.dogumIl} merkezine taşındı.`);
  else if (P.goc && !P.goc.zorunlu) s.push(`${yilda(P.goc.yil)} ${P.goc.neden === 'aile' ? 'ailesiyle birlikte' : P.goc.neden === 'okul' && P.egt >= 3 ? 'okumak için' : P.goc.neden === 'evlilik' ? 'evlenince' : 'iş bulmak için'} ${yon(P.goc.il)} göç etti${P.goc.semt ? `, ${P.goc.semt} semtine yerleşti` : ''}.`);
  // Eğitim, askerlik, iş
  s.push(`${Buyuk(EGT_AD[P.egt])}${P.universiteSehir ? ` (${bul(P.universiteSehir)} okudu)` : ''}.`);
  if (P.askerlik && !P.askerlik.dogu && P.askerlik.yil <= YIL) s.push(`Askerliğini ${P.askerlik.bedelli ? 'bedelli yaptı' : yilda(P.askerlik.yil) + ' ' + bul(P.askerlik.yer) + ' yaptı'}.`);
  const isCumle = { ogrenci: 'Hâlâ öğrenci; harçlığını yarı zamanlı işlerden çıkarıyor.', emekli: `Emekli${P.kadin ? '' : `; yıllarca ${P.egt >= 4 ? 'memur olarak' : 'işçi olarak'} çalıştı`}. Maaşı kiraya ve faturalara zor yetiyor.`, ev_kadini: !P.evlilik && P.yas < 35 ? 'Okulu bıraktıktan sonra evde annesine yardım ediyor; ara sıra iş arıyor.' : `Evin ${evdeCocukMetni(P) ? 've ' + evdeCocukMetni(P) : ''}bakımını üstleniyor.`, issiz: P.khk ? 'Kamudan ihraç edildiğinden beri düzenli bir iş bulamadı.' : 'Şu an iş arıyor; iş ilanlarına bakmaktan yoruldu.', ciftci: `${Buyuk(P.sektor)} üretiyor; mazot, gübre ve tohum fiyatları her yıl derdi.`, isci: `${Buyuk(P.sektor)} işçi olarak çalışıyor${P.sendika ? ', sendika üyesi' : ''}.`, esnaf: P.yas < 25 ? `Mahalledeki bir ${P.sektor} dükkânında tezgâhtar olarak çalışıyor.` : `Mahallede küçük bir ${P.sektor} işletiyor.`, memur: `${Buyuk(P.sektor)} olarak devlette çalışıyor${P.sendika ? ', sendikalı' : ''}.`, ozel_sektor_beyaz_yaka: `Özel sektörde, ${P.sektor} çalışıyor.`, serbest_meslek: `Serbest ${P.sektor}.`, sofor_kurye: `${Buyuk(P.sektor)} olarak çalışıyor.` }[P.meslek];
  if (isCumle) s.push(isCumle);
  // Hayat olayları (kronolojik)
  for (const o of [...P.olaylar].sort((a, b) => a.yil - b.yil)) s.push(Buyuk(o.metin) + '.');
  if (P.isKaybi && !P.khk) s.push(['issiz', 'emekli', 'ev_kadini', 'ogrenci'].includes(P.meslek) ? 'Son iki yılda işini kaybetti.' : 'Son iki yılda bir süre işsiz kaldı; yeniden iş bulana kadar birikimini tüketti.');
  if (P.borc > 0.6) s.push('Kredi kartı ve ihtiyaç kredisi borçları birikti; ay sonunu getirmek her ay daha zor.');
  else if (P.gelir === 'yuksek') s.push('Enflasyona rağmen geliri ailesini rahat geçindirmeye yetiyor.');
  // Evlilik ve çocuklar
  if (P.evlilik) {
    const E = P.evlilik, esK = byId.get(E.esId) ?? P.eskiEs;
    const esIs = esK ? (MESLEK_AD[esK.meslek] ?? esK.meslek) : '';
    s.push(`${yilda(E.yil)} ${E.nasil} evlendi${E.akraba ? ' (akraba evliliği)' : ''}${esK ? `; eşi ${esK.dogumIl !== P.dogumIl && esK.dogumIl !== P.il ? cik(esK.dogumIl) + ' gelme, ' : ''}${esIs}` : ''}.`);
    if (E.bitis) s.push(E.bitis.tur === 'dul' ? `Eşini ${yilda(E.bitis.yil)} kaybetti; o günden beri ${H.uyeler.length === 1 ? 'yalnız yaşıyor' : 'çocuklarıyla yaşıyor'}.` : `${yilda(E.bitis.yil)} boşandı${P.kadin ? '; nafaka davası yıllarca sürdü' : ''}.`);
    else if (row.es_oyu) s.push(`Eşi ${row.es_oyu === 'oy_yok' ? 'siyasetle pek ilgilenmez, sandığa gitmeyi gereksiz bulur' : 'siyasette ' + PARTI_KISA[row.es_oyu] + ' yanlısı'}${row.es_oyu !== 'oy_yok' && P.ilgi > 0.5 ? '; akşam yemeklerinde ara sıra tartışırlar' : ''}.`);
  } else if (P.rol !== 'cocuk' && P.yas > 30) s.push('Hiç evlenmedi.');
  else if (P.rol === 'cocuk') s.push(P.yas > 26 ? 'Evlenmesi için ailesinden baskı görüyor.' : 'Bekâr.');
  const cs = P.cocuklar || [];
  if (cs.length) s.push(`${cs.length} çocuğu var: ${cs.slice(0, 5).map((c) => `${c.ad} (${YIL - c.dogum}${c.evli ? ', evli' : c.evdeYasar ? '' : ', ayrı evde'})`).join(', ')}.`);
  // İletişim ekolojisi
  const ie = [];
  if (P.tvSaat >= 1) ie.push(`günde ${String(P.tvSaat).replace('.', ',')} saat kadar televizyon izliyor, haberleri çoğunlukla ${P.tvKanal} kanalından`);
  else ie.push('televizyonu neredeyse hiç açmıyor');
  if (P.sosyalSaat >= 1) ie.push(`sosyal medyada günde ${String(P.sosyalSaat).replace('.', ',')} saat geçiriyor, gündemi ${P.sosKanal} üzerinden takip ediyor`);
  if (P.whatsappAile) ie.push(`ailenin WhatsApp grubuna ${P.yas > 55 ? 'her sabah günaydın mesajı ve haber videoları atıyor' : 'gelen siyasi videoları çoğu zaman sessize alıyor'}`);
  s.push(Buyuk(ie.join('; ')) + '.');
  const kurum = [];
  if (P.cami) kurum.push('cuma namazlarını kaçırmaz');
  if (P.cemevi) kurum.push('cemevindeki cemlere katılır');
  if (P.cemaat) kurum.push('bir cemaatin sohbetlerine gider');
  if (P.kahve) kurum.push('akşamları kahvehanede oturur');
  if (P.gun) kurum.push('komşularıyla altın günü yapar');
  if (P.dernek) kurum.push(P.dernek + 'ne üye');
  if (kurum.length) s.push(Buyuk(kurum.join('; ')) + '.');
  const konusulan = P.ag.filter((c) => c.iliski !== 'eşi').slice(0, 6).map((c) => {
    const blok = c.kisi ? null : c.kisiYerel ? null : c.blok;
    return `${c.iliski} ${c.ad}${blok ? ` (${PARTI_KISA[blok] === 'siyasetten uzak' ? 'siyasetten uzak' : PARTI_KISA[blok] + ' yanlısı'})` : ''}`;
  });
  if (konusulan.length) s.push(`Siyaseti en çok şu kişilerle konuşuyor: ${konusulan.join(', ')}.`);
  const onder = P.ag.find((c) => c.onder);
  if (onder) s.push(`Bir konuda kafası karışınca ${onder.iliski} ${yon(onder.ad)} danışır.`);
  // Değerler, algılar (oyunu söylemez)
  if (row.tehdit_algisi > 0.65) s.push(`Ülkenin ${P.kurt ? 'huzurunun' : 'güvenliğinin ve sınırlarının'} tehlikede olduğunu düşünüyor${BOLGE[P.bolge].multeci > 0.5 && !P.kurt ? '; mahallesine gelen sığınmacılardan rahatsız' : ''}.`);
  if (P.otoriter > 0.65) s.push('Çocukların her şeyden önce büyüklerine saygı ve itaat öğrenmesi gerektiğine inanıyor.');
  else if (P.otoriter < 0.25) s.push('Çocukların merak ve bağımsızlıkla yetişmesi gerektiğini savunuyor.');
  s.push(P.ilgi > 0.6 ? 'Siyaseti yakından takip eder; tartışmaktan çekinmez.' : P.ilgi < 0.3 ? 'Siyasete ilgisi az; "hepsi aynı" der.' : 'Siyaseti ara sıra takip eder.');
  s.push(...gundelik(P, H));
  return s.join(' ');
}
// Gündelik hayat ayrıntıları — ayrı rastgele akış (oylar ve ölçülen sütunlar değişmez). Oranlar yaklaşık:
// konut sahipliği ~%57 (TÜİK), 65+ kronik hastalık ~%50 (TÜİK Sağlık Araştırması), Kürtçe anadili Kürtlerin büyük çoğunluğu
const r2nd = rng(SEED * 97 + 13), V2 = () => r2nd(), b2 = (p) => V2() < p, p2 = (a) => a[Math.floor(V2() * a.length)];
function gundelik(P, H) {
  const s = [];
  const evSahibi = b2(clamp(0.25 + 0.012 * (P.yas - 20) + (P.gelir === 'yuksek' ? 0.2 : P.gelir === 'dusuk' ? -0.15 : 0) + (H.kirsal ? 0.25 : 0), 0.05, 0.92));
  if (P.rol === 'cocuk' || P.rol === 'yasli_ebeveyn') s.push(`${P.rol === 'cocuk' ? 'Ailesinin' : P.kadin ? 'Oğlunun' : 'Oğlunun'} evinde${P.rol === 'yasli_ebeveyn' ? ' kalıyor; torunlarıyla vakit geçirmek en büyük teselli' : ' kendi odası var; kira fiyatları yüzünden ayrı eve çıkmayı erteliyor'}.`);
  else s.push(evSahibi ? (H.kirsal ? 'Köydeki ev babadan kalma; bahçesinde sebze yetiştiriyor.' : `Ev sahibi${b2(0.4) ? '; evin kredisi daha bitmedi' : ''}.`) : `Kirada oturuyor${b2(0.6) ? '; son iki yılda kira iki katına çıktı, ev sahibi tahliye için baskı yaptı' : ''}.`);
  if (P.yas > 25 && P.rol !== 'yasli_ebeveyn') s.push(P.gelir === 'yuksek' && b2(0.7) ? `${p2(['Kredili aldığı', 'Birkaç yaşında bir', 'İkinci el'])} arabası var.` : b2(0.35) ? 'Eski bir arabası var; benzin zamlarından sonra az kullanıyor.' : 'Arabası yok; toplu taşıma ve dolmuşla gidip geliyor.');
  if (P.yas > 55 && b2(0.55)) s.push(`${p2(['Tansiyon', 'Şeker', 'Kalp', 'Romatizma', 'KOAH'])} hastası; ilaçlarını ${P.meslek === 'emekli' ? 'emekli sağlık güvencesiyle' : 'devlet hastanesinden'} alıyor, randevu bulmak her seferinde dert.`);
  else if (P.yas > 35 && b2(0.15)) s.push(`${p2(['Bel fıtığı', 'Migren', 'Mide rahatsızlığı'])} yüzünden zaman zaman çalışamıyor.`);
  if (P.kurt) s.push(b2(P.yas > 40 ? 0.9 : 0.6) ? `Evde ${b2(0.15) ? 'Zazaca' : 'Kürtçe'} konuşuluyor${P.yas < 30 ? '; kendisi Türkçeyi daha rahat konuşuyor' : ''}.` : 'Kürtçeyi anlıyor ama konuşamıyor; bundan hayıflanıyor.');
  if (P.arap) s.push('Evde Arapça da konuşuluyor.');
  if (P.goc && !P.goc.zorunlu && P.goc.il !== P.dogumIl) s.push(b2(0.55) ? `Yazları ${P.dogumIl}'${back(P.dogumIl) ? 'daki' : 'deki'} köye gidiyor; bayramları memlekette geçirmeye çalışıyor.`.replace("'daki' köye", "'daki köye") : 'Memleketle bağı zayıfladı; en son yıllar önce bir cenaze için gitti.');
  if (P.din > 0.6) s.push(`${P.alevi ? 'Muharrem orucunu tutar' : P.kadin ? 'Beş vakit namazını kılar, başını örter' : 'Beş vakit namazını kılmaya çalışır'}; Ramazan'da oruç tutar.`);
  else if (P.din < 0.3 && !P.alevi) s.push('Dini bayramları aile ziyaretiyle geçirir; ibadetle pek arası yok.');
  const rutin = P.meslek === 'emekli' ? 'Sabahları pazara ya da camiye/parka gider, öğleden sonra torunlara bakar'
    : P.meslek === 'ev_kadini' ? 'Günü yemek, temizlik ve çocukların okul işleriyle geçer; akşam dizisini kaçırmaz'
    : P.meslek === 'ogrenci' ? 'Gününün çoğu okulda ve telefonda geçiyor; hafta sonları kafede çalışıyor'
    : P.meslek === 'ciftci' ? 'Güneş doğmadan tarlaya iner; akşam köy kahvesinde günün fiyatları konuşulur'
    : P.meslek === 'issiz' ? 'Gününü iş ilanlarına bakarak ve tanıdıklardan iş sorarak geçiriyor'
    : `Sabah ${p2(['7', '7.30', '8'])}'de evden çıkıyor, ${p2(['servisle', 'metrobüsle', 'otobüsle', 'arabayla', 'yürüyerek'])} işe gidiyor; akşam yorgun dönüyor`;
  s.push(rutin + '.');
  const kaygi = [];
  if (P.borc > 0.55 || P.ez > 0.5) kaygi.push('ay sonunu getirememek');
  if ((P.cocuklar || []).some((c) => YIL - c.dogum < 30)) kaygi.push('çocuklarının iş bulup bulamayacağı');
  if (P.il === 'İstanbul') kaygi.push('beklenen büyük İstanbul depremi');
  if (P.deprem23) kaygi.push('yeniden bir depremde enkaz altında kalmak');
  if (P.yas < 30 && P.egt >= 3) kaygi.push('yurt dışına gidip gitmemek');
  if (P.yas > 60) kaygi.push('çocuklarına yük olmak');
  if (kaygi.length) s.push(`En çok ${kaygi.slice(0, 3).join(', ')} konusunda kaygılanıyor.`);
  const umut = P.yas < 30 ? p2(['kendi işini kurmak', 'iyi bir işe girip ayrı eve çıkmak', 'yüksek lisans yapmak', 'evlenip yuva kurmak']) : P.yas < 55 ? p2(['çocuklarını okutmak', 'borçlarını kapatmak', 'bir ev almak', 'emekli olup memlekete dönmek']) : p2(['torunlarını evlendirmek', 'hacca gitmek', 'sağlıklı kalmak', 'çocuklarının yakınında yaşamak']);
  s.push(`Hayali ${umut.replace('hacca gitmek', P.alevi ? 'Hacı Bektaş\'a, dergâha gitmek' : 'hacca gitmek')}.`);
  return s;
}
function evdeCocukMetni(P) { const n = (P.cocuklar || []).filter((c) => c.evdeYasar).length; return n ? 'çocukların ' : (byId.get(P.aile.evdekiEbeveyn) ? 'yaşlı kayınvalidesinin ' : ''); }

/* ============================ YAZ ============================ */
const OUT = new URL('./sentetik/hane/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const cols = Object.keys(rows[0]);
const esc = (v) => (String(v).includes(';') ? `"${v}"` : String(v));
writeFileSync(new URL('TR_hane_secmen.csv', OUT), [cols.join(';'), ...rows.map((rw) => cols.map((k) => esc(rw[k])).join(';'))].join('\n') + '\n');
writeFileSync(new URL('TR_hane_oyku.jsonl', OUT), kisiler.map((P, i) => JSON.stringify({ kisi: P.id, hane: P.hane, oyku: oyku(P, rows[i]) })).join('\n') + '\n');
writeFileSync(new URL('TR_hane_il.csv', OUT), ['il;' + ALTS.join(';'), ...Object.entries(IL).map(([k, v]) => k + ';' + v.map((x) => (x * 100).toFixed(1)).join(';'))].join('\n') + '\n');
const dist = (k) => Object.fromEntries(ALTS.map((a) => [a, Math.round(kisiler.filter((x) => x[k] === a).length / kisiler.length * 1000) / 10]));
console.log(`${haneler.length} hane, ${kisiler.length} seçmen → tests/data/sentetik/hane/`, '2023:', dist('oy'), '2018:', dist('oy18'));
