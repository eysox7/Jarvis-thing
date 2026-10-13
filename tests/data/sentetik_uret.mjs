// Zengin sentetik Türkiye seçmen verisi: her kişinin hayat öyküsü, çocukluk travmaları, ailesi,
// eşi, mahallesi, tartışma ağı ve medya diyeti vardır. Üretim nedensel bir zincirle yapılır ve
// karar modelinin kendi fayda denklemi KULLANILMAZ (döngüsellik yok): etkileşimler, gizli kişisel
// eğilimler, ölçüm hatası ve gürültü içerir; model yalnız ankette sorulabilecek sütunları görür.
//   bölge → aile (SES, dindarlık, etnik köken/inanç, babanın partisi)
//         → çocukluk (ACE travmaları, sert ceza, zorunlu göç, terör, deprem)
//         → otoriterlik, tehdit duyarlılığı, kurumsal güven
//         → yetişkinlik (eğitim, iş, gelir, iç göç, evlilik homogamisi, iş kaybı, borç)
//         → çevre (mahalle, tartışma ağı, eşin oyu, medya) → oy
// Dağılımlar yaklaşık kamu istatistiklerine dayanır (TÜİK nüfus/eğitim/işgücü, ACE yaygınlığı
// çalışmaları, seçim sonuçlarının genel düzeyi); kesin değer iddiası yoktur — ayrıntı: tests/data/sentetik/README.md
// Çalıştır: node tests/data/sentetik_uret.mjs [kişi=3000] [tohum=2023]

import { writeFileSync, mkdirSync } from 'node:fs';
import { rng } from '../../js/audience/personas.js';

const N = Number(process.argv[2] || 3000), SEED = Number(process.argv[3] || 2023);
const r = rng(SEED);
const U = () => r();
const norm = () => Math.sqrt(-2 * Math.log(U() || 1e-12)) * Math.cos(2 * Math.PI * U());
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const bern = (p) => U() < p;
const pickW = (obj) => { const ks = Object.keys(obj), t = ks.reduce((s, k) => s + obj[k], 0); let u = U() * t; for (const k of ks) { if ((u -= obj[k]) <= 0) return k; } return ks[ks.length - 1]; };
const pick = (arr) => arr[Math.floor(U() * arr.length)];
const sig = (x) => 1 / (1 + Math.exp(-x));

// Bölgeler: nüfus payı, kentleşme, Kürt nüfus payı, Alevi payı, temel dindarlık, mülteci yoğunluğu, iller
const BOLGE = {
  istanbul: { pay: 0.185, kent: 0.99, kurt: 0.12, alevi: 0.12, din: 0.42, multeci: 0.6, iller: ['İstanbul'] },
  marmara: { pay: 0.11, kent: 0.78, kurt: 0.04, alevi: 0.1, din: 0.45, multeci: 0.25, iller: ['Bursa', 'Kocaeli', 'Tekirdağ', 'Balıkesir', 'Sakarya', 'Edirne'] },
  ege: { pay: 0.125, kent: 0.8, kurt: 0.05, alevi: 0.1, din: 0.38, multeci: 0.25, iller: ['İzmir', 'Manisa', 'Aydın', 'Denizli', 'Muğla', 'Afyonkarahisar'] },
  akdeniz: { pay: 0.13, kent: 0.75, kurt: 0.1, alevi: 0.1, din: 0.5, multeci: 0.7, iller: ['Antalya', 'Adana', 'Mersin', 'Hatay', 'Kahramanmaraş', 'Osmaniye'] },
  icanadolu: { pay: 0.155, kent: 0.8, kurt: 0.04, alevi: 0.18, din: 0.58, multeci: 0.35, iller: ['Ankara', 'Konya', 'Kayseri', 'Eskişehir', 'Sivas', 'Yozgat'] },
  karadeniz: { pay: 0.095, kent: 0.6, kurt: 0.01, alevi: 0.06, din: 0.62, multeci: 0.1, iller: ['Samsun', 'Trabzon', 'Ordu', 'Rize', 'Zonguldak', 'Tokat'] },
  dogu: { pay: 0.07, kent: 0.6, kurt: 0.45, alevi: 0.18, din: 0.65, multeci: 0.3, iller: ['Erzurum', 'Van', 'Malatya', 'Elazığ', 'Ağrı', 'Tunceli'] },
  guneydogu: { pay: 0.13, kent: 0.72, kurt: 0.68, alevi: 0.03, din: 0.68, multeci: 0.9, iller: ['Gaziantep', 'Şanlıurfa', 'Diyarbakır', 'Mardin', 'Batman', 'Adıyaman'] },
};
const DEPREM23 = new Set(['Hatay', 'Kahramanmaraş', 'Osmaniye', 'Adana', 'Gaziantep', 'Şanlıurfa', 'Diyarbakır', 'Adıyaman', 'Malatya', 'Elazığ']);
const DEPREM99 = new Set(['İstanbul', 'Kocaeli', 'Sakarya', 'Bursa']);
const ALTS = ['iktidar', 'ana_muhalefet', 'milliyetci', 'kurt_sol', 'oy_yok'];
// Hedef paylar (tüm seçmenler, katılmama dahil; yaklaşık genel düzey)
const HEDEF = { iktidar: 0.43, ana_muhalefet: 0.29, milliyetci: 0.08, kurt_sol: 0.08, oy_yok: 0.12 };
const PARTI_KISA = { iktidar: 'iktidar ittifakı', ana_muhalefet: 'ana muhalefet', milliyetci: 'milliyetçi muhalefet', kurt_sol: 'Kürt siyasi hareketi' };
// Türkçe özel ad ekleri: yönelme (-(y)a/-(y)e), bulunma (-da/-de/-ta/-te)
const lastV = (w) => { const m = w.toLocaleLowerCase('tr').match(/[aeıioöuü](?=[^aeıioöuü]*$)/); return m ? m[0] : 'e'; };
const back = (w) => 'aıou'.includes(lastV(w));
const endsV = (w) => /[aeıioöuü]$/i.test(w);
const yon = (w) => `${w}'${endsV(w) ? 'y' : ''}${back(w) ? 'a' : 'e'}`;
const bul = (w) => `${w}'${/[çfhkpsşt]$/i.test(w) ? 't' : 'd'}${back(w) ? 'a' : 'e'}`;
const PARTI_AD = { iktidar: 'iktidar ittifakına (sağ-muhafazakâr)', ana_muhalefet: 'ana muhalefete (merkez sol)', milliyetci: 'milliyetçi muhalefete', kurt_sol: 'Kürt siyasi hareketine', oy_yok: 'hiçbir partiye (sandığa gitmezdi)' };

const AD = {
  kadin: { turk: ['Ayşe', 'Fatma', 'Emine', 'Hatice', 'Zeynep', 'Elif', 'Merve', 'Esra', 'Selin', 'Büşra', 'Derya', 'Gülsüm', 'Sevgi', 'Özlem', 'Nur'], kurt: ['Rojda', 'Berfin', 'Zelal', 'Hêvî', 'Gülistan', 'Leyla', 'Nesrin', 'Dilan', 'Fatma', 'Ayşe'] },
  erkek: { turk: ['Mehmet', 'Mustafa', 'Ahmet', 'Ali', 'Hüseyin', 'Hasan', 'İbrahim', 'Murat', 'Emre', 'Burak', 'Yusuf', 'Kemal', 'Osman', 'Serkan', 'Can'], kurt: ['Rojhat', 'Baran', 'Welat', 'Azad', 'Serhat', 'Mehmet', 'Abdullah', 'Ramazan', 'Şiyar', 'Ahmet'] },
};

function person(i) {
  const p = { kisi: i + 1 };
  // --- Doğum, köken -------------------------------------------------------
  const yas = Math.round(clamp(18 + Math.abs(norm()) * 22 + U() * 8, 18, 88));
  const dogum = 2023 - yas;
  const kadin = bern(0.505);
  const dogumBolge = pickW(Object.fromEntries(Object.entries(BOLGE).map(([k, b]) => [k, b.pay * (k === 'istanbul' ? 0.45 : 1.12)])));
  const B0 = BOLGE[dogumBolge];
  const kurt = bern(B0.kurt), alevi = bern(kurt ? 0.12 : B0.alevi), arap = !kurt && dogumBolge === 'guneydogu' && bern(0.08);
  const dogumKirsal = bern((1 - B0.kent) + (2023 - dogum) * 0.008);
  const aileSES = clamp(0.32 + 0.22 * norm() + (dogumKirsal ? -0.12 : 0.08) + (dogum - 1960) * 0.003 + (dogumBolge === 'guneydogu' || dogumBolge === 'dogu' ? -0.08 : 0));
  const aileDin = clamp(B0.din + 0.18 * norm() + (dogumKirsal ? 0.12 : -0.05) + (alevi ? -0.25 : 0) - (dogum - 1960) * 0.002);
  const kardes = Math.max(0, Math.round(5.5 - (dogum - 1940) * 0.06 + (dogumKirsal ? 1.5 : 0) + (kurt ? 1.2 : 0) + norm() * 1.2));
  // Babanın parti ailesi (siyasal sosyalleşme, Jennings & Niemi)
  const babaParti = pickW({
    iktidar: 1.3 * aileDin * (alevi ? 0.15 : 1) * (kurt ? 0.6 : 1) + 0.15,
    ana_muhalefet: (1.1 - aileDin) * (alevi ? 3.2 : 1) * (kurt ? 0.3 : 1) * (dogumBolge === 'ege' ? 1.7 : 1),
    milliyetci: 0.32 * (kurt || alevi ? 0.05 : 1) * (dogumBolge === 'icanadolu' || dogumBolge === 'akdeniz' || dogumBolge === 'karadeniz' ? 1.6 : 1),
    kurt_sol: kurt ? 1.6 * (1.1 - aileDin * 0.6) : 0.01,
    oy_yok: 0.15,
  });
  // --- Çocukluk: travma (ACE), sert ceza, felaket ---------------------------
  const yoksul = 1 - aileSES;
  const ace = {
    yoksulluk_aclik: bern(0.08 + 0.35 * yoksul ** 2),
    aile_ici_siddet: bern(0.1 + 0.12 * yoksul + (aileDin > 0.7 ? 0.03 : 0)),
    ebeveyn_kaybi: bern(0.05 + (dogum < 1965 ? 0.05 : 0) + 0.03 * yoksul),
    bosanma: bern(0.02 + (dogum > 1985 ? 0.06 : 0) + (aileDin < 0.3 ? 0.04 : 0)),
    madde_bagimliligi_evde: bern(0.04 + 0.04 * yoksul),
    zorunlu_goc: kurt && dogum >= 1960 && dogum <= 2000 && (dogumBolge === 'guneydogu' || dogumBolge === 'dogu') && bern(0.22),
  };
  const sertCeza = bern(clamp(0.18 + 0.35 * aileDin + 0.15 * yoksul + (dogumKirsal ? 0.08 : 0) - (dogum - 1960) * 0.004));
  const teror = (dogumBolge === 'guneydogu' || dogumBolge === 'dogu') && dogum >= 1960 && dogum <= 2003 && bern(0.3);
  const sehitYakini = !kurt && bern(0.04 + (dogumBolge === 'karadeniz' || dogumBolge === 'icanadolu' ? 0.03 : 0));
  const travma = Object.values(ace).filter(Boolean).length + (sertCeza ? 1 : 0);
  // --- Yetişkinlik: iç göç, eğitim, iş, gelir -------------------------------
  const goc = dogumBolge !== 'istanbul' && bern(0.16 + (dogumKirsal ? 0.12 : 0) + (ace.zorunlu_goc ? 0.35 : 0) + (dogumBolge === 'guneydogu' || dogumBolge === 'dogu' || dogumBolge === 'karadeniz' ? 0.08 : 0));
  const bolge = goc ? pickW({ istanbul: 0.5, marmara: 0.15, ege: 0.12, akdeniz: 0.12, icanadolu: 0.11 }) : dogumBolge;
  const B = BOLGE[bolge];
  const il = goc ? pick(B.iller) : pick(B0.iller.filter((x) => B.iller.includes(x)).length ? B.iller : B.iller);
  const kirsal = !goc && dogumKirsal && bern(0.7);
  const yerlesim = kirsal ? 'kirsal' : (bolge === 'istanbul' || ['Ankara', 'İzmir', 'Bursa', 'Antalya', 'Adana', 'Gaziantep', 'Konya'].includes(il)) ? 'metropol' : 'kent';
  const egitimSkor = 0.9 * aileSES + 0.025 * (dogum - 1950) / 1 * 0.6 - (kadin && dogum < 1975 ? 0.35 : 0) - (kadin && (dogumBolge === 'guneydogu' || dogumBolge === 'dogu') ? 0.2 : 0) - (dogumKirsal ? 0.2 : 0) - 0.06 * travma + 0.35 * norm();
  const egitim = egitimSkor < 0.35 ? 'ilkokul' : egitimSkor < 0.95 ? 'lise' : egitimSkor < 1.45 ? 'universite' : 'lisansustu';
  const egit01 = { ilkokul: 0, lise: 0.4, universite: 0.8, lisansustu: 1 }[egitim];
  const ogrenci = yas < 25 && egit01 >= 0.4 && bern(0.45);
  const emekli = yas >= 58 && bern(kadin ? 0.55 : 0.85);
  const calisiyor = !ogrenci && !emekli && bern(kadin ? 0.25 + 0.45 * egit01 : 0.8);
  const meslek = ogrenci ? 'ogrenci' : emekli ? 'emekli' : !calisiyor ? (kadin ? 'ev_kadini' : 'issiz') : kirsal && bern(0.5) ? 'ciftci'
    : egit01 >= 0.8 ? pickW({ memur: 0.35, ozel_sektor_beyaz_yaka: 0.5, serbest_meslek: 0.15 }) : pickW({ isci: 0.55, esnaf: 0.25, memur: 0.08, sofor_kurye: 0.12 });
  const gelirSkor = 0.45 * egit01 + 0.2 * aileSES + (calisiyor ? 0.15 : 0) + (['istanbul', 'marmara', 'ege'].includes(bolge) ? 0.08 : 0) + (meslek === 'emekli' ? -0.05 : 0) + 0.15 * norm();
  const gelir = gelirSkor < 0.3 ? 'dusuk' : gelirSkor < 0.62 ? 'orta' : 'yuksek';
  const isKaybi = !emekli && !ogrenci && bern(0.08 + (meslek === 'issiz' ? 0.5 : 0) + (gelir === 'dusuk' ? 0.06 : 0));
  const borc = clamp(0.25 + 0.3 * (gelir === 'dusuk' ? 1 : gelir === 'orta' ? 0.5 : 0) + (isKaybi ? 0.2 : 0) + 0.15 * norm());
  const deprem99 = DEPREM99.has(il) && dogum < 1995;
  const deprem23 = DEPREM23.has(il) && bern(0.75);
  const depremKayip = deprem23 && bern(0.25);
  // --- Değerler ve algılar (Stenner, Fromm, Beck) ---------------------------
  const otoriterGizli = clamp(0.25 + 0.35 * aileDin + 0.18 * (sertCeza ? 1 : 0) + 0.04 * travma - 0.25 * egit01 + (kirsal ? 0.05 : 0) + 0.15 * norm());
  const din = clamp(0.65 * aileDin + 0.2 * otoriterGizli - 0.12 * egit01 + (alevi ? -0.15 : 0) + 0.13 * norm());
  const dindarlik = din < 0.33 ? 'dusuk' : din < 0.62 ? 'orta' : 'yuksek';
  const tehditGizli = clamp(0.2 + 0.3 * (teror ? 1 : 0) + 0.25 * (sehitYakini ? 1 : 0) + 0.25 * B.multeci * (kurt ? 0.3 : 1) + 0.25 * otoriterGizli + 0.05 * travma + (depremKayip ? 0.1 : 0) + 0.12 * norm());
  const ilgi = clamp(0.35 + 0.35 * egit01 + (kadin ? -0.08 : 0.05) + 0.004 * (yas - 18) - 0.03 * travma + 0.18 * norm());
  // --- Evlilik, çocuklar, medya ---------------------------------------------
  const evli = bern(yas < 25 ? 0.18 : yas < 35 ? 0.62 : yas < 65 ? 0.8 : 0.6);
  const cocuk = evli ? Math.max(0, Math.round(1.2 + (yas > 40 ? 1 : 0) + (kirsal ? 0.8 : 0) + (kurt ? 1 : 0) - egit01 + norm() * 0.9)) : 0;
  const dijitalSkor = clamp(1.1 - 0.018 * (yas - 18) + 0.35 * egit01 + 0.1 * norm());
  const medyaHukumete = sig(-0.6 + 2.6 * (babaParti === 'iktidar' ? 1 : 0) + 1.8 * din - 1.4 * egit01 + 0.02 * (yas - 40) - (alevi ? 1.2 : 0) - (kurt ? 0.8 : 0) + 0.8 * norm());
  const medya = dijitalSkor > 0.62 && bern(0.6) ? 'sosyal' : bern(0.15 * egit01) ? 'haber_sitesi' : 'tv';
  const medyaKaynagi = medya === 'sosyal' ? (bern(medyaHukumete) ? 'hukumete_yakin_hesaplar' : 'muhalif_hesaplar') : bern(medyaHukumete) ? 'hukumete_yakin_kanal' : bern(0.7) ? 'muhalif_kanal' : 'tarafsiz';
  // --- Oy: gizli faydalar (üretim modeli; karar modelinden farklı yapı) -----
  const kisiselTat = ALTS.map(() => 0.6 * norm());   // gözlenmeyen kişisel eğilim
  const fam = (k) => (babaParti === k ? 1 : 0);
  const ekonomiZarar = clamp(0.35 * (isKaybi ? 1 : 0) + 0.35 * borc + (gelir === 'dusuk' ? 0.15 : 0) + 0.1 * norm());
  const sadakat = babaParti === 'iktidar' ? 0.6 : 0;   // partizan güdümlü akıl yürütme: zarar iktidarı daha az cezalandırır
  const Ubase = (o = {}) => ({
    iktidar: 1.9 * din + 1.1 * otoriterGizli * (1 + tehditGizli) + 1.3 * fam('iktidar') + 0.9 * (medyaKaynagi.startsWith('hukumete') ? 1 : 0)
      - 1.5 * ekonomiZarar * (1 - sadakat) - 1.6 * (alevi ? 1 : 0) - 1.4 * (kurt ? 1 : 0) * (1 - 0.6 * din) + 0.5 * (kirsal ? 1 : 0)
      + 0.012 * (yas - 40) - 0.4 * egit01 + (depremKayip ? -0.5 : 0) + (o.iktidar || 0),
    ana_muhalefet: 1.8 * (alevi ? 1 : 0) + 1.4 * (1 - din) + 0.6 * egit01 + 1.2 * fam('ana_muhalefet') + 0.9 * ekonomiZarar
      + 0.6 * (medyaKaynagi.startsWith('muhalif') ? 1 : 0) + (bolge === 'ege' ? 0.6 : bolge === 'istanbul' ? 0.25 : 0) - 0.9 * (kurt ? 1 : 0) + (o.ana_muhalefet || 0),
    milliyetci: 0.9 * otoriterGizli * tehditGizli * 2 + 1.1 * fam('milliyetci') + 0.7 * B.multeci * tehditGizli + (kadin ? -0.3 : 0.25) + (yas < 35 ? 0.35 : 0)
      + (sehitYakini ? 0.8 : 0) - 2.5 * (kurt ? 1 : 0) - 1.2 * (alevi ? 1 : 0) * 0.5 + (o.milliyetci || 0),
    kurt_sol: (kurt ? 3.2 - 1.6 * din : -3) + 1.3 * (ace.zorunlu_goc ? 1 : 0) + 0.8 * (teror && kurt ? 1 : 0) + 1.0 * fam('kurt_sol') + (yas < 35 ? 0.4 : 0)
      + (alevi && !kurt ? 0.2 : 0) + (o.kurt_sol || 0),
    oy_yok: 1.6 * (1 - ilgi) + (yas < 25 ? 0.6 : 0) + 0.12 * travma + 0.5 * (ekonomiZarar > 0.6 ? 1 : 0) + (goc && bern(0.3) ? 0.5 : 0) - 0.6 * egit01 + (o.oy_yok || 0),
  });
  const ub = Ubase();
  return { p, ub, kisiselTat, ctx: { yas, dogum, kadin, dogumBolge, kurt, alevi, arap, dogumKirsal, aileSES, aileDin, kardes, babaParti, ace, sertCeza, teror, sehitYakini, travma, goc, bolge, il, kirsal, yerlesim, egitim, egit01, meslek, gelir, isKaybi, borc, deprem99, deprem23, depremKayip, otoriterGizli, din, dindarlik, tehditGizli, ilgi, evli, cocuk, dijitalSkor, medya, medyaKaynagi, medyaHukumete, ekonomiZarar } };
}

// 1) Kişileri üret
const people = Array.from({ length: N }, (_, i) => person(i));
const gumbel = () => -Math.log(-Math.log(U() || 1e-12));
const softmax = (V) => { const m = Math.max(...V), e = V.map((v) => Math.exp(v - m)), s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); };
// 2) Toplam paylara kalibre sabitler (ilk tur: sosyal etkisiz)
const asc = Object.fromEntries(ALTS.map((a) => [a, 0]));
const structP = () => people.map((x) => softmax(ALTS.map((a, j) => x.ub[a] + asc[a] + x.kisiselTat[j])));
for (let it = 0; it < 60; it++) {
  const P = structP();
  ALTS.forEach((a, j) => { const m = P.reduce((s, q) => s + q[j], 0) / N; asc[a] += 0.8 * Math.log(HEDEF[a] / m); });
}
let P0 = structP();
// 3) Bölge "resmî sonuçları" (yapısal paylar), mahalle payları, eş ve tartışma ağı
const bolgePay = {};
people.forEach((x, i) => { const k = x.ctx.il; (bolgePay[k] ||= { n: 0, s: ALTS.map(() => 0) }); bolgePay[k].n++; P0[i].forEach((q, j) => { bolgePay[k].s[j] += q; }); });
const ilPay = Object.fromEntries(Object.entries(bolgePay).map(([k, v]) => [k, v.s.map((s) => s / v.n)]));
const dir = (alpha) => { const g = alpha.map((a) => { let s = 0; for (let k = 0; k < Math.max(1, Math.round(a)); k++) s -= Math.log(U() || 1e-12); return s; }); const t = g.reduce((a, b) => a + b, 0); return g.map((v) => v / t); };
const choose = (V) => { const W = V.map((v) => v + gumbel()); return W.indexOf(Math.max(...W)); };
for (const [i, x] of people.entries()) {
  const c = x.ctx;
  // Mahalle: il payı etrafında homofilik konum (benzerler benzer mahallelerde)
  c.mahalle = P0[i].map((q, j) => 0.55 * ilPay[c.il][j] + 0.45 * q);
  // Eş: homogami (eşin yapısal eğilimi kişininkiyle ρ≈0.78) + kendi tadı; eşin seçimi
  if (c.evli) {
    const other = people[Math.floor(U() * N)];
    const Vs = ALTS.map((a, j) => 0.78 * (x.ub[a] + x.kisiselTat[j]) + 0.22 * (other.ub[a] + other.kisiselTat[j]) + asc[a] + 0.4 * norm());
    c.esOyu = ALTS[choose(Vs)];
  }
  // Tartışma ağı: 3–8 kişi, eğilimler kişininkine ve mahalleye benzer (homofili), ölçüm hatalı beyan
  const k = 3 + Math.round(5 * c.ilgi);
  const net = ALTS.map(() => 0);
  for (let q = 0; q < k; q++) { const w = dir(c.mahalle.map((m, j) => 1 + 6 * (0.5 * m + 0.5 * P0[i][j]))); net[choose(w.map((v) => Math.log(v + 1e-6) * 3))]++; }
  c.ag = net.map((v) => v / k);
  c.agBuyuklugu = k;
}
// 4) Sosyal etkiyle nihai oy (eş + ağ + mahalle; nedensel ama kısmi) ve önceki seçim
const SOS = { es: 1.1, ag: 1.2, mahalle: 0.8 };
const finalV = (x) => ALTS.map((a, j) => x.ub[a] + asc[a] + x.kisiselTat[j] + (x.ctx.esOyu === a ? SOS.es : 0) + SOS.ag * (x.ctx.ag[j] - 0.2) + SOS.mahalle * Math.log(x.ctx.mahalle[j] + 0.03));
// Sosyal terimler toplam payları kaydırır → sabitleri yeniden kalibre et
for (let it = 0; it < 40; it++) {
  const P = people.map((x) => softmax(finalV(x)));
  ALTS.forEach((a, j) => { const m = P.reduce((s, q) => s + q[j], 0) / N; asc[a] += 0.8 * Math.log(HEDEF[a] / m); });
}
for (const x of people) {
  const V = finalV(x);
  x.ctx.secim = ALTS[choose(V)];
  // Önceki seçim (5 yıl önce): kalıcı eğilim + o günkü koşullar (ekonomik zarar henüz yoktu)
  const Vp = ALTS.map((a, j) => V[j] + (a === 'iktidar' ? 1.2 * x.ctx.ekonomiZarar * 0.8 : 0) + 0.9 * norm());
  x.ctx.onceki = ALTS[choose(Vp)];
}

// 5) Ölçülen (ankette sorulabilir) sütunlar — ölçüm hatası ile
const tri = (v, a, b) => (v < a ? 'dusuk' : v < b ? 'orta' : 'yuksek');
const r2 = (x) => Math.round(x * 100) / 100;
const rows = people.map(({ p, ctx: c }) => {
  const otoriterOlcum = Math.round(clamp(c.otoriterGizli + 0.12 * norm()) * 4) / 4;   // 4 maddelik çocuk yetiştirme bataryası
  const ideo = clamp(0.5 + 0.35 * (c.din - 0.5) + 0.3 * (c.otoriterGizli - 0.4) + (c.alevi ? -0.2 : 0) + (c.kurt ? -0.15 : 0) + 0.15 * norm());
  const ekoAlgi = clamp(-0.35 - 0.9 * c.ekonomiZarar + (c.babaParti === 'iktidar' ? 0.55 : 0) + (c.medyaKaynagi.startsWith('hukumete') ? 0.3 : 0) + 0.25 * norm(), -1, 1);
  const guven = clamp(0.35 + (c.medyaKaynagi.startsWith('hukumete') ? 0.3 : -0.1) + (c.babaParti === 'iktidar' ? 0.15 : 0) - 0.04 * c.travma - (c.alevi || c.kurt ? 0.12 : 0) + 0.15 * norm());
  return {
    kisi: p.kisi, yas: c.yas, cinsiyet: c.kadin ? 'kadin' : 'erkek', egitim: c.egitim, gelir: c.gelir, yerlesim: c.yerlesim,
    ideoloji: ideo < 0.38 ? 'sol' : ideo < 0.6 ? 'merkez' : 'sag', dindarlik: c.dindarlik,
    dijital: tri(c.dijitalSkor, 0.4, 0.7), medya: c.medya, medya_kaynagi: c.medyaKaynagi,
    kurumsal_guven: tri(guven, 0.35, 0.6), bilissel_ihtiyac: c.ilgi > 0.55 ? 'yuksek' : 'dusuk',
    kanaat_onderi: c.ilgi > 0.7 && c.agBuyuklugu >= 7 ? 'evet' : 'hayir',
    azinlik_kimlik: c.kurt || c.alevi ? 'evet' : 'hayir', etnik_koken: c.kurt ? 'kurt' : c.arap ? 'arap' : 'turk', inanc: c.alevi ? 'alevi' : 'sunni',
    otoriterlik: otoriterOlcum, ekonomi_algisi: r2(ekoAlgi), hane_algisi: r2(clamp(-0.2 - 1.1 * c.ekonomiZarar + 0.2 * norm(), -1, 1)),
    tehdit_algisi: r2(clamp(c.tehditGizli + 0.1 * norm())), travma_skoru: c.travma, cocuklukta_sert_ceza: c.sertCeza ? 1 : 0,
    zorunlu_goc: c.ace.zorunlu_goc ? 1 : 0, teror_maruziyeti: c.teror ? 1 : 0, sehit_yakini: c.sehitYakini ? 1 : 0,
    deprem_maruziyeti: c.deprem23 ? (c.depremKayip ? 2 : 1) : c.deprem99 ? 1 : 0, is_kaybi: c.isKaybi ? 1 : 0, borc_yuku: r2(c.borc),
    ic_goc: c.goc ? 1 : 0, meslek: c.meslek, medeni_durum: c.evli ? 'evli' : 'bekar', cocuk_sayisi: c.cocuk,
    es_oyu: c.esOyu || '', ebeveyn_oyu: c.babaParti, onceki: c.onceki,
    ...Object.fromEntries(ALTS.map((a, j) => ['ag_' + a, r2(c.ag[j])])),
    ...Object.fromEntries(ALTS.map((a, j) => ['cevre_' + a, r2(c.mahalle[j])])),
    il: c.il, bolge_adi: c.bolge, secim: c.secim,
  };
});

// 6) Hayat öyküsü (anlatı) — kişinin oyunu SÖYLEMEZ (dil modeli testinde sızıntı olmasın)
function story({ p, ctx: c }, row) {
  const ad = pick(AD[c.kadin ? 'kadin' : 'erkek'][c.kurt ? 'kurt' : 'turk']);
  const dogIl = pick(BOLGE[c.dogumBolge].iller);
  const s = [];
  s.push(`${ad}, ${c.dogum} yılında ${c.dogumKirsal ? yon(dogIl) + ' bağlı bir köyde' : bul(dogIl)}, ${c.kardes + 1} çocuklu ${c.aileSES < 0.25 ? 'yoksul' : c.aileSES < 0.5 ? 'dar gelirli' : c.aileSES < 0.75 ? 'orta halli' : 'varlıklı'} bir ${c.kurt ? 'Kürt ' : c.arap ? 'Arap ' : ''}${c.alevi ? 'Alevi ' : ''}ailede doğdu.`);
  s.push(`Evde din ${c.aileDin > 0.66 ? 'hayatın merkezindeydi' : c.aileDin > 0.4 ? 'gelenek olarak yaşanırdı' : 'pek konuşulmazdı'}; babası yıllarca ${PARTI_AD[c.babaParti]} oy verdi.`);
  const t = [];
  if (c.ace.yoksulluk_aclik) t.push('çocukluğunda evde yiyecek sıkıntısı çekildiği dönemler oldu');
  if (c.ace.aile_ici_siddet) t.push('evde şiddete tanık oldu');
  if (c.ace.ebeveyn_kaybi) t.push(`${pick(['babasını', 'annesini'])} küçük yaşta kaybetti`);
  if (c.ace.bosanma) t.push('anne babası ayrıldı');
  if (c.ace.madde_bagimliligi_evde) t.push('evde alkol sorunu vardı');
  if (c.sertCeza) t.push('itaat bekleyen sert bir terbiyeyle, dayakla büyütüldü');
  if (c.ace.zorunlu_goc) t.push("doksanlarda köyleri boşaltılınca ailesiyle birlikte zorla göç etmek zorunda kaldı");
  if (c.teror) t.push('çatışmaların sürdüğü yıllarda bölgede büyüdü, yakın çevresinde can kayıpları yaşandı');
  if (c.sehitYakini) t.push('askerdeyken şehit düşen bir yakını var');
  s.push(t.length ? `${t.slice(0, 1)[0][0].toUpperCase() + t[0].slice(1)}${t.length > 1 ? '; ' + t.slice(1).join('; ') : ''}.` : 'Çocukluğu görece sakin geçti.');
  if (c.goc) s.push(`${c.ace.zorunlu_goc ? 'Sonra iş için' : 'Gençken iş bulmak için'} ${yon(c.il)} göç etti${c.yerlesim === 'metropol' ? ' ve büyükşehrin çeperinde bir mahalleye yerleşti' : ''}.`);
  s.push({ ilkokul: c.yas > 55 && c.kadin ? 'Okula ancak birkaç yıl gidebildi.' : 'İlkokuldan sonra okulu bıraktı.', lise: 'Liseyi bitirdi.', universite: 'Üniversiteyi bitiren ailedeki ilk kişilerden oldu.', lisansustu: 'Yüksek lisans yaptı.' }[c.egitim]);
  s.push({ ogrenci: 'Hâlâ öğrenci.', emekli: 'Emekli; maaşı geçinmeye zor yetiyor.', ev_kadini: 'Evin ve çocukların bakımını üstleniyor.', issiz: 'Şu an iş arıyor.', ciftci: 'Çiftçilik yapıyor; mazot ve gübre fiyatları her yıl derdi.', isci: 'Fabrikada/şantiyede işçi.', esnaf: 'Küçük bir dükkânı var.', memur: 'Devlet memuru.', ozel_sektor_beyaz_yaka: 'Özel sektörde masa başı çalışıyor.', serbest_meslek: 'Serbest meslek sahibi.', sofor_kurye: 'Şoför/kurye olarak çalışıyor.' }[c.meslek]);
  if (c.isKaybi) s.push('Son iki yılda işini kaybetti.');
  if (c.borc > 0.6) s.push('Kredi kartı ve ihtiyaç kredisi borçları birikti; ay sonunu getirmekte zorlanıyor.');
  if (c.deprem23) s.push(c.depremKayip ? "2023 depreminde evini ve yakınlarını kaybetti; yardımların geç geldiğini düşünüyor." : '2023 depremini yaşadı, aylarca çadırda/konteynerde kaldı.');
  else if (c.deprem99) s.push('1999 depremini yaşadı; o geceyi hâlâ unutamıyor.');
  if (c.evli) s.push(`Evli${c.cocuk ? ', ' + c.cocuk + ' çocuğu var' : ''}. Eşi ${row.es_oyu === 'oy_yok' ? 'siyasetle pek ilgilenmez' : 'siyasette ' + PARTI_KISA[row.es_oyu] + ' yanlısı'}.`);
  else s.push('Bekâr.');
  const agBas = ALTS.map((a, j) => [a, c.ag[j]]).sort((x, y) => y[1] - x[1])[0];
  s.push(`Siyaseti en çok ${c.agBuyuklugu} kişilik bir çevreyle konuşuyor; bu çevrenin çoğu ${agBas[0] === 'oy_yok' ? 'siyasetten uzak' : PARTI_KISA[agBas[0]] + ' yanlısı'}.`);
  s.push({ hukumete_yakin_kanal: 'Haberleri hükümete yakın kanallardan izliyor.', muhalif_kanal: 'Haberleri muhalif kanallardan izliyor.', tarafsiz: 'Haber için ana akım eğlence kanallarına bakıyor, siyaset programı izlemiyor.', hukumete_yakin_hesaplar: 'Gündemi sosyal medyada hükümete yakın hesaplardan takip ediyor.', muhalif_hesaplar: 'Gündemi sosyal medyada muhalif gazeteci ve hesaplardan takip ediyor.' }[c.medyaKaynagi]);
  if (c.tehditGizli > 0.65) s.push(`Ülkenin ${c.kurt ? 'huzurunun' : 'güvenliğinin ve sınırlarının'} tehlikede olduğunu düşünüyor${BOLGE[c.bolge].multeci > 0.5 && !c.kurt ? '; mahallesine gelen sığınmacılardan rahatsız' : ''}.`);
  if (c.otoriterGizli > 0.65) s.push('Çocukların her şeyden önce büyüklerine saygı ve itaat öğrenmesi gerektiğine inanıyor.');
  else if (c.otoriterGizli < 0.25) s.push('Çocukların merak ve bağımsızlıkla yetişmesi gerektiğini savunuyor.');
  s.push(c.ilgi > 0.6 ? 'Siyaseti yakından takip eder.' : c.ilgi < 0.3 ? 'Siyasete ilgisi az; "hepsi aynı" der.' : 'Siyaseti ara sıra takip eder.');
  return s.join(' ');
}

const OUT = new URL('./sentetik/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const cols = Object.keys(rows[0]);
const esc = (v) => (String(v).includes(';') ? `"${v}"` : String(v));
writeFileSync(new URL('TR_secmen.csv', OUT), [cols.join(';'), ...rows.map((rw) => cols.map((k) => esc(rw[k])).join(';'))].join('\n') + '\n');
writeFileSync(new URL('TR_secmen_oyku.jsonl', OUT), people.map((x, i) => JSON.stringify({ kisi: rows[i].kisi, oyku: story(x, rows[i]) })).join('\n') + '\n');
// Resmî sonuç benzeri il payları (yüzde) — topluluk bağlamı için
writeFileSync(new URL('TR_il_sonuclari.csv', OUT), ['il;' + ALTS.join(';'), ...Object.entries(ilPay).map(([k, v]) => k + ';' + v.map((q) => (q * 100).toFixed(1)).join(';'))].join('\n') + '\n');
const dist = Object.fromEntries(ALTS.map((a) => [a, Math.round(rows.filter((x) => x.secim === a).length / N * 1000) / 10]));
console.log(`${N} kişi yazıldı → tests/data/sentetik/ (TR_secmen.csv, TR_secmen_oyku.jsonl, TR_il_sonuclari.csv)`, dist);
