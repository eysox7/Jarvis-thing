// Karar alanları: her alan, kuramlardan türetilmiş FAYDA TERİMLERİ listesidir.
// Rastgele fayda kuramı (McFadden 1974): kişi i'nin seçenek j'den aldığı fayda
//     U_ij = ASC_j + Σ_k θ_k · z_k(persona_i, seçenek_j, bağlam) + ε_ij   (ε ~ Gumbel)
// ⇒ P_ij = exp(V_ij) / Σ_l exp(V_il)   (çok terimli logit).
// Her terimin `onsel` katsayısı kuramın öngördüğü yön/büyüklüktür; veri geldiğinde estimate.js
// bu öncüller etrafında MAP tahmini yapar (veri azken kuram, veri çokken veri konuşur).
//
// Terim: { id, ad, kuram, onsel, z(f, p, a, ctx) → sayı }
//   f   persona özellikleri (personas.features)   p  ham persona
//   a   seçenek {id, ad, tur?, ...özellikler}      ctx  seçim bağlamı (+ türetilmiş alanlar)

import { comm } from './communication.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const IDEO = { sol: -1, merkez: 0, sag: 1 };

/* ============================== SİYASET ============================== */
// Persona'nın iki boyutlu siyasi uzaydaki konumu: ekonomi (sol-sağ) ve kültür (liberal-muhafazakâr).
// Thomas teoremi (Chicago okulu): "İnsanlar bir durumu gerçek olarak tanımlarsa, sonuçları da
// gerçek olur." Kişinin KENDİ beyan ettiği konum / algı varsa demografiden türetilen tahminin yerine o kullanılır.
export function politicalPosition(f, p) {
  const sv = (k) => (p && Number.isFinite(+p[k]) && p[k] !== '' && p[k] !== null ? clamp(+p[k], -1, 1) : null);
  return {
    ekonomi: sv('konum_ekonomi') ?? clamp(0.75 * f.ideoloji + 0.35 * (f.gelir - 0.5), -1, 1),
    kultur: sv('konum_kultur') ?? clamp(0.55 * (f.dindarlik * 2 - 1) + 0.35 * f.ideoloji + 0.15 * (f.yas - 0.5) - 0.15 * (f.yerlesim - 0.5), -1, 1),
  };
}
const perceived = (p, k, d) => (p && p[k] !== undefined && p[k] !== null && p[k] !== '' && Number.isFinite(+p[k]) ? +p[k] : d);
// Otoriter yatkınlık (Adorno vd. 1950 → Stenner 2005): doğrudan ölçek yoksa vekil — dindarlık,
// düşük eğitim, düşük bilişsel ihtiyaç, yaş, kırsallık. Kişi verisinde 'otoriterlik' (0..1) varsa o kullanılır.
export const authoritarian = (f, p) => clamp(perceived(p, 'otoriterlik', 0.35 * f.dindarlik + 0.25 * (1 - f.egitim) + 0.15 * (1 - f.nfc) + 0.15 * f.yas + 0.1 * (1 - f.yerlesim)), 0, 1) - 0.5;
// Normatif tehdit (Stenner) + güvencesizlik (Fromm, Özgürlükten Kaçış): bağlam tehdidi ve kişinin ekonomik kaygısı
const threat = (f, p, ctx) => 1 + clamp(num(ctx?.tehdit), 0, 2) + 0.5 * Math.max(0, -perceived(p, 'ekonomi_algisi', num(ctx?.ekonomi_algisi, -0.2))) * (1 - f.gelir);
const mainMedia = (p) => p?.medya || null;
const partyPos = (a) => ({ ekonomi: num(a.ekonomi ?? a.konum?.ekonomi), kultur: num(a.kultur ?? a.konum?.kultur) });
const isAbstain = (a) => a.tur === 'cekimser' || a.id === 'oy_kullanmama';
// Konu önemi (issue salience): kriz döneminde ekonomi ekseni ağır basar. Ortalama 1'e normalize.
function issueWeights(ctx) {
  const k = ctx?.konu_onemi;
  if (!k) return { ekonomi: 1, kultur: 1 };
  const e = Math.max(0, num(k.ekonomi, 1)), c = Math.max(0, num(k.kultur, 1)), m = (e + c) / 2 || 1;
  return { ekonomi: e / m, kultur: c / m };
}

export { isAbstain };
export const SIYASET = {
  id: 'siyaset', ad: 'Siyasi karar (oy verme)',
  seceneOzellikleri: {
    ekonomi: '-1 (sol) .. 1 (sağ) ekonomik konum', kultur: '-1 (liberal) .. 1 (muhafazakâr) kültürel konum',
    kimlik: '"sol" | "merkez" | "sag" — parti kimliği tabanı', iktidar: 'boolean — görevdeki parti mi',
    lider: '0..1 lider/aday değerlendirmesi (valens)', anket: '0..1 beklenen oy payı (stratejik oy)',
    guclu_lider: '0..1 "güçlü lider / düzen" vaadi', duzen_karsiti: 'boolean — düzen karşıtı / popülist parti',
    tur: '"cekimser" → oy kullanmama seçeneği',
  },
  baglam: { bolge_paylari: '{bölge: {seçenek_id: %}} bölge/il/ilçe sonuçları — kişinin p.bolge alanıyla topluluk bağlamı', ekonomi_algisi: '-1 (kötü) .. 1 (iyi) genel ekonomik algı (varsayılan -0.2)', konu_onemi: '{ekonomi: ağırlık, kultur: ağırlık} hangi eksen daha belirleyici (ör. kriz: {ekonomi: 2, kultur: 0.6})', iktidar_suresi_yil: 'görevdeki partinin iktidar süresi (yorgunluk etkisi)', onceki_paylar: '{seçenek_id|etiket: yüzde} önceki seçim sonucu — personalara geçmiş oy atanır', tehdit: '0..2 normatif/güvenlik tehdidi algısı (terör, göç, kriz)', medya_yanliligi: '{medya türü veya kişinin medya_kaynagi etiketi: {seçenek_id: -1..1}} medya sahipliği/yanlılığı' },
  terimler: [
    { id: 'yakinlik', ad: 'Mekânsal yakınlık', kuram: 'Downs (1957) — mekânsal oy modeli', onsel: 1.6,
      z: (f, p, a, ctx) => { if (isAbstain(a)) return 0; const v = politicalPosition(f, p), q = partyPos(a), w = issueWeights(ctx); return -(w.ekonomi * (v.ekonomi - q.ekonomi) ** 2 + w.kultur * (v.kultur - q.kultur) ** 2); } },
    { id: 'yon', ad: 'Yönsel oy', kuram: 'Rabinowitz & Macdonald (1989)', onsel: 0.7,
      z: (f, p, a, ctx) => { if (isAbstain(a)) return 0; const v = politicalPosition(f, p), q = partyPos(a), w = issueWeights(ctx); return w.ekonomi * v.ekonomi * q.ekonomi + w.kultur * v.kultur * q.kultur; } },
    { id: 'parti_kimligi', ad: 'Parti kimliği', kuram: 'Campbell vd. (1960) — Michigan modeli', onsel: 1.3,
      // Ölçülmüş parti kimliği varsa (p.parti_kimligi: -1 güçlü sol/demokrat .. 1 güçlü sağ/cumhuriyetçi) o kullanılır
      z: (f, p, a) => {
        if (isAbstain(a) || !a.kimlik) return 0;
        const pk = perceived(p, 'parti_kimligi', null);
        if (pk !== null) return a.kimlik === 'sag' ? pk : a.kimlik === 'sol' ? -pk : -Math.abs(pk) * 0.5;
        return a.kimlik === p.ideoloji ? 0.5 + f.yas : 0;
      } },
    { id: 'ekonomik_oy', ad: 'Geriye dönük ekonomik oy', kuram: 'Fiorina (1981); Lewis-Beck (1988)', onsel: 1.4,
      z: (f, p, a, ctx) => (a.iktidar ? perceived(p, 'ekonomi_algisi', num(ctx.ekonomi_algisi, -0.2)) + 0.5 * perceived(p, 'hane_algisi', f.gelir - 0.4) : 0) },
    { id: 'kurumsal_guven', ad: 'Sistem güveni', kuram: 'Easton (1965) — yaygın destek', onsel: 1.0,
      z: (f, p, a) => (a.iktidar ? f.kurumsal_guven - 0.5 : 0) },
    { id: 'iktidar_yorgunlugu', ad: 'İktidar yorgunluğu / değişim isteği', kuram: 'Maliyet-of-ruling (Paldam 1986); kuşak etkisi', onsel: 0.9,
      z: (f, p, a, ctx) => (a.iktidar ? -Math.min(1, num(ctx.iktidar_suresi_yil) / 20) * (0.4 + 0.6 * (1 - f.yas)) : 0) },
    { id: 'lider', ad: 'Lider / valens', kuram: 'Stokes (1963) — valens meseleleri', onsel: 1.5,
      z: (f, p, a) => (isAbstain(a) ? 0 : num(a.lider, 0.5) - 0.5) },
    { id: 'stratejik', ad: 'Stratejik oy', kuram: 'Duverger (1954); Cox (1997)', onsel: 0.45,
      z: (f, p, a) => (isAbstain(a) || a.anket === undefined ? 0 : Math.log(num(a.anket) + 0.02) * (0.5 + 0.5 * f.nfc)) },
    { id: 'otoriter_dinamik', ad: 'Otoriter dinamik', kuram: 'Adorno vd. (1950) Otoriter Kişilik; Fromm (1941); Stenner (2005) yatkınlık × tehdit', onsel: 0.9,
      z: (f, p, a, ctx) => (isAbstain(a) ? 0 : authoritarian(f, p) * (partyPos(a).kultur + num(a.guclu_lider)) * threat(f, p, ctx)) },
    { id: 'muzakere', ad: 'Müzakereci akıl', kuram: 'Habermas (1981) iletişimsel eylem — içerik kişilikten ağır basar', onsel: 0.6,
      z: (f, p, a, ctx) => { if (isAbstain(a)) return 0; const v = politicalPosition(f, p), q = partyPos(a); return (0.6 * f.nfc + 0.4 * f.leader) * (-((v.ekonomi - q.ekonomi) ** 2 + (v.kultur - q.kultur) ** 2) - 0.5 * (num(a.lider, 0.5) - 0.5)); } },
    { id: 'medya_yanliligi', ad: 'Medya sahipliği ve yanlılığı', kuram: 'Herman & Chomsky (1988) propaganda modeli; Smythe; Hall okuma konumu ile ağırlıklı — DellaVigna & Kaplan (2007): ağır izleyicide ~0,1–0,3 logit', onsel: 0.3,
      z: (f, p, a, ctx) => { const s = ctx?.medya_yanliligi?.[p?.medya_kaynagi ?? mainMedia(p)]?.[a.id]; return s === undefined ? 0 : num(s) * (0.4 + 0.6 * f.kurumsal_guven); } },
    { id: 'arac', ad: 'Araç mesajdır', kuram: 'McLuhan (1964); Innis — sosyal medya düzen karşıtlığını, TV yerleşik düzeni besler', onsel: 0.4,
      z: (f, p, a) => { const m = mainMedia(p) === 'sosyal' ? 1 : mainMedia(p) === 'tv' ? -0.5 : 0; return m * (a.iktidar ? -1 : a.duzen_karsiti ? 1 : 0); } },
    { id: 'kimlik_siyaseti', ad: 'Marjinal kimlik ve karşı-hegemonya', kuram: 'Crenshaw (1989) kesişimsellik; Gramsci karşı-hegemonya; Hall — marjinal gruplar kültürel liberal/çoğulcu partiye yönelir', onsel: 0.8,
      z: (f, p, a) => (isAbstain(a) || !p?.azinlik_kimlik ? 0 : (f.marginal - 0.2) * -partyPos(a).kultur) },
    { id: 'cinsiyet_acigi', ad: 'Kuşaksal cinsiyet açığı', kuram: 'Inglehart & Norris (2000); Immerzeel vd. (2015) — feminist/kesişimsel', onsel: 0.5,
      z: (f, p, a) => (isAbstain(a) || !p?.cinsiyet ? 0 : (f.kadin - 0.5) * -partyPos(a).kultur * (0.4 + 0.6 * (1 - f.yas))) },
    { id: 'katilmama', ad: 'Katılmama eğilimi', kuram: 'Riker & Ordeshook (1968) — oy hesabı', onsel: 1.2,
      z: (f, p, a) => (isAbstain(a) ? 0.9 * (1 - f.yas) + 0.9 * (1 - f.kurumsal_guven) - 0.7 * f.egitim + 0.6 * (1 - Math.abs(f.ideoloji)) - 1.9 : 0) },
  ],
};

/* ============================== TİCARET ============================== */
const isOutside = (a) => a.tur === 'disarida' || a.id === 'satin_almama';
export const TICARET = {
  id: 'ticaret', ad: 'Satın alma kararı',
  seceneOzellikleri: {
    fiyat: 'sayı — fiyat (TL)', referans_fiyat: 'sayı — alışılmış/önceki fiyat (kayıp kaçınma)',
    kalite: '0..1', marka: '0..1 marka gücü', puan: '0..1 kullanıcı puanı / popülerlik',
    yerli: 'boolean', yesil: '0..1 sürdürülebilirlik', mevcut: 'boolean — kişinin şu an kullandığı',
    online: 'boolean — yalnızca çevrimiçi satılıyor', reklam: '0..1 kişinin gördüğü reklam/broşür (ölçülmüş maruziyet)', teshir: '0..1 mağaza içi teşhir/raf öne çıkarma',
    isletme_maliyeti: 'sayı — kullanım/işletme maliyeti (yıllık; dayanıklı mallar)', indirim_yuzde: 'sayı — ilan edilen indirim %', taksit: 'boolean — taksit imkânı',
    seckinlik: '0..1 kültürel seçkinlik / "yüksek beğeni" kodu', statu: '0..1 statü görünürlüğü (başkalarınca görülen tüketim)',
    tur: '"disarida" → satın almama seçeneği',
  },
  baglam: { kategori_yuku: '0..1 kategorinin bütçe yükü (dışarıda kalma eğilimi, varsayılan 0.4)', onceki_paylar: '{seçenek_id: yüzde} mevcut pazar payları — personalara şu anki marka atanır (sadakat)' },
  hazirla: (alts) => {
    const med = (k) => { const v = alts.filter((a) => !isOutside(a) && num(a[k]) > 0).map((a) => num(a[k])).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : 1; };
    return { fiyat_medyan: med('fiyat'), isletme_medyan: med('isletme_maliyeti') };
  },
  terimler: [
    { id: 'fiyat', ad: 'Fiyat duyarlılığı', kuram: 'Mikroekonomik talep; gelir etkisi', onsel: 1.6,
      z: (f, p, a, ctx) => (isOutside(a) || !(num(a.fiyat) > 0) ? 0 : -Math.log(num(a.fiyat) / ctx.fiyat_medyan) * (1.5 - f.gelir)) },
    { id: 'isletme', ad: 'İşletme maliyeti (geleceğin iskontosu)', kuram: 'Becker (1965) hane üretimi; Hausman (1979) örtük iskonto oranı — tüketici gelecekteki maliyeti eksik tartar', onsel: 0.8,
      z: (f, p, a, ctx) => (isOutside(a) || !(num(a.isletme_maliyeti) > 0) ? 0 : -Math.log(num(a.isletme_maliyeti) / ctx.isletme_medyan) * (0.6 + 0.4 * f.nfc + 0.3 * f.egitim)) },
    { id: 'kayip_kacinma', ad: 'Kayıp kaçınma / referans fiyat', kuram: 'Kahneman & Tversky (1979); Thaler (1985)', onsel: 1.5,
      z: (f, p, a) => { if (isOutside(a) || !(num(a.referans_fiyat) > 0) || !(num(a.fiyat) > 0)) return 0; const g = (num(a.referans_fiyat) - num(a.fiyat)) / num(a.referans_fiyat); return g >= 0 ? g : 2.25 * g; } },
    { id: 'indirim', ad: 'İndirim belirginliği', kuram: 'Promosyon etkisi; işlem faydası (Thaler 1985)', onsel: 0.9,
      z: (f, p, a) => (isOutside(a) ? 0 : Math.min(0.7, num(a.indirim_yuzde) / 100) * (1.1 - 0.4 * f.nfc - 0.3 * f.gelir)) },
    { id: 'taksit', ad: 'Taksit / ödeme esnekliği', kuram: 'Zihinsel muhasebe; likidite kısıtı', onsel: 0.8,
      z: (f, p, a) => (a.taksit ? Math.max(0.05, 0.9 - f.gelir) : 0) },
    { id: 'kalite', ad: 'Algılanan kalite', kuram: 'Zeithaml (1988)', onsel: 2.0,
      z: (f, p, a) => (isOutside(a) ? 0 : (num(a.kalite, 0.5) - 0.5) * (0.5 + 0.4 * f.egitim + 0.4 * f.gelir)) },
    { id: 'marka', ad: 'Marka değeri (sezgisel ipucu)', kuram: 'Keller (1993); sezgisel işleme', onsel: 1.3,
      z: (f, p, a) => (isOutside(a) ? 0 : (num(a.marka, 0.5) - 0.5) * (1.3 - 0.6 * f.nfc)) },
    { id: 'sosyal_kanit', ad: 'Sosyal kanıt', kuram: 'Cialdini (1984)', onsel: 1.1,
      z: (f, p, a) => (isOutside(a) || a.puan === undefined ? 0 : (num(a.puan) - 0.5) * (0.6 + 0.6 * (1 - f.yas) + 0.3 * (p.medya === 'sosyal' ? 1 : 0))) },
    { id: 'yerli', ad: 'Tüketici etnosentrizmi', kuram: 'Shimp & Sharma (1987)', onsel: 0.7,
      z: (f, p, a) => (a.yerli ? 0.2 + 0.5 * Math.max(0, f.ideoloji) + 0.4 * f.dindarlik - 0.2 * f.egitim : 0) },
    { id: 'yesil', ad: 'Sürdürülebilir tüketim', kuram: 'Değer-inanç-norm (Stern 2000)', onsel: 0.8,
      z: (f, p, a) => (isOutside(a) ? 0 : num(a.yesil) * (0.3 * (1 - f.yas) + 0.4 * f.egitim + 0.3 * Math.max(0, -f.ideoloji) + 0.2 * f.gelir - 0.25)) },
    { id: 'kultur_endustrisi', ad: 'Kültür endüstrisi (kitle markası)', kuram: 'Horkheimer & Adorno (1944); Marcuse (1964) — kitle medyasının ürettiği standart istek', onsel: 0.5,
      z: (f, p, a) => (isOutside(a) || a.marka === undefined ? 0 : (num(a.marka) - 0.5) * (['tv', 'sosyal'].includes(mainMedia(p)) ? 1 : 0.3) * (1.2 - 0.6 * f.nfc)) },
    { id: 'arama_maliyeti', ad: 'Bilgi arama maliyeti', kuram: 'Stigler (1961) bilginin ekonomisi (Chicago okulu)', onsel: 0.5,
      z: (f, p, a) => (isOutside(a) || a.marka === undefined ? 0 : (num(a.marka) - 0.5) * (1 - f.dijital)) },
    { id: 'kulturel_sermaye', ad: 'Kültürel sermaye / ayrım', kuram: 'Bourdieu (1979) Ayrım — beğeni sınıf habitusunun işaretidir', onsel: 0.8,
      z: (f, p, a) => (a.seckinlik === undefined ? 0 : num(a.seckinlik) * 2 * (0.6 * f.egitim + 0.4 * f.gelir - 0.4)) },
    { id: 'gosteris', ad: 'Gösterişçi tüketim / gösterge değeri', kuram: 'Veblen (1899); Baudrillard (1970); Charles, Hurst & Roussanov (2009)', onsel: 0.7,
      z: (f, p, a) => (a.statu === undefined ? 0 : num(a.statu) * (0.5 * f.marginal + 0.3 * f.yerlesim + 0.4 * (1 - f.yas) - 0.3)) },
    { id: 'statuko', ad: 'Statüko / marka sadakati', kuram: 'Samuelson & Zeckhauser (1988)', onsel: 1.0,
      z: (f, p, a) => (a.mevcut ? 0.5 + 0.5 * f.yas : 0) },
    { id: 'erisim', ad: 'Kanal erişimi (dijital)', kuram: 'Teknoloji kabul modeli (Davis 1989)', onsel: 1.2,
      z: (f, p, a) => (a.online ? f.dijital - 0.55 : 0) },
    { id: 'disarida', ad: 'Satın almama (bütçe kısıtı)', kuram: 'Dış seçenek; gelir kısıtı', onsel: 1.2,
      z: (f, p, a, ctx) => (isOutside(a) ? num(ctx.kategori_yuku, 0.4) * (1.4 - f.gelir) - 0.4 : 0) },
  ],
};

/* ============================== GÜNDELİK HAYAT ============================== */
export const GUNDELIK = {
  id: 'gundelik', ad: 'Gündelik / sağduyu kararı',
  seceneOzellikleri: {
    fayda: '0..1 beklenen fayda', maliyet: '0..1 maliyet/çaba', risk: '0..1 algılanan risk',
    gecikmeli_fayda: '0..1 faydanın ne kadarı gelecekte', sure: 'dakika — harcanan zaman (yolculuk, bekleme, işlem)', norm: '0..1 çevrede yapanların oranı (betimleyici norm)',
    varsayilan: 'boolean — hiçbir şey yapmazsan olan', aliskanlik: '0..1 alışkanlık gücü',
    zorluk: '0..1 uygulama zorluğu', dijital: 'boolean — dijital beceri gerektirir',
    kurum_onerisi: 'boolean — bir otorite/kurum öneriyor', kayip_cercevesi: 'boolean — seçenek bir kaybı önleme olarak sunuluyor',
    kitlik: '0..1 sınırlı süre/stok algısı', 
  },
  baglam: { onceki_paylar: '{seçenek_id: yüzde} şu anki davranış dağılımı (alışkanlık/sadakat)' },
  hazirla: (alts) => { const v = alts.filter((a) => a.sure !== undefined).map((a) => num(a.sure)).sort((x, y) => x - y); return { sure_medyan: v.length ? v[Math.floor(v.length / 2)] : 60 }; },
  terimler: [
    { id: 'fayda', ad: 'Beklenen fayda', kuram: 'Beklenen fayda (von Neumann–Morgenstern)', onsel: 2.2,
      z: (f, p, a) => num(a.fayda, 0.5) - 0.5 },
    { id: 'maliyet', ad: 'Maliyet / çaba', kuram: 'Fayda-maliyet; gelir kısıtı', onsel: 1.6,
      z: (f, p, a) => -num(a.maliyet) * (1.3 - 0.6 * f.gelir) },
    { id: 'zaman', ad: 'Zamanın fırsat maliyeti', kuram: 'Becker (1965) zamanın tahsisi — zamanın değeri gelirle artar (Chicago okulu)', onsel: 1.2,
      z: (f, p, a, ctx) => (a.sure === undefined ? 0 : -Math.log1p(num(a.sure) / Math.max(1, num(ctx.sure_medyan, 60))) * (0.6 + 0.8 * f.gelir)) },
    { id: 'risk', ad: 'Risk kaçınma', kuram: 'Beklenti kuramı (Kahneman & Tversky 1979)', onsel: 1.3,
      z: (f, p, a) => -num(a.risk) * (0.5 + 0.6 * f.yas + 0.4 * (1 - f.gelir)) },
    { id: 'simdiki_zaman', ad: 'Şimdiki zaman yanlılığı', kuram: 'Hiperbolik iskonto (Laibson 1997)', onsel: 1.2,
      z: (f, p, a) => -num(a.gecikmeli_fayda) * num(a.fayda, 0.5) * (0.9 - 0.5 * f.nfc - 0.2 * f.egitim) },
    { id: 'sosyal_norm', ad: 'Sosyal norm', kuram: 'Planlı davranış (Ajzen 1991); Cialdini (1990)', onsel: 1.5,
      z: (f, p, a) => (a.norm === undefined ? 0 : (num(a.norm) - 0.5) * (0.6 + 0.4 * (1 - f.nfc) + 0.3 * f.dindarlik)) },
    { id: 'varsayilan', ad: 'Varsayılan etkisi', kuram: 'Johnson & Goldstein (2003); Thaler & Sunstein (Chicago); meta-analiz d=0,68 (Jachimowicz vd. 2019)', onsel: 1.2,
      z: (f, p, a) => (a.varsayilan ? 1.2 - 0.5 * f.nfc : 0) },
    { id: 'aliskanlik', ad: 'Alışkanlık', kuram: 'Verplanken & Aarts (1999)', onsel: 1.1,
      z: (f, p, a) => num(a.aliskanlik) * (0.5 + 0.5 * f.yas) },
    { id: 'algilanan_kontrol', ad: 'Algılanan davranışsal kontrol', kuram: 'Ajzen (1991)', onsel: 1.2,
      z: (f, p, a) => -num(a.zorluk) * (1.1 - 0.4 * f.egitim) - (a.dijital ? (0.6 - f.dijital) : 0) },
    { id: 'kayip_cercevesi', ad: 'Kayıp çerçevesi', kuram: 'Çerçeveleme etkisi (Tversky & Kahneman 1981)', onsel: 0.7,
      z: (f, p, a) => (a.kayip_cercevesi ? 0.5 + 0.5 * (1 - f.nfc) : 0) },
    { id: 'kitlik', ad: 'Kıtlık / aciliyet', kuram: 'Kıtlık ilkesi (Cialdini; Worchel 1975)', onsel: 0.6,
      z: (f, p, a) => num(a.kitlik) * (0.8 - 0.4 * f.nfc) },
    { id: 'sifir_fiyat', ad: 'Sıfır fiyat (bedava) etkisi', kuram: 'Shampanier, Mazar & Ariely (2007)', onsel: 0.7,
      z: (f, p, a) => (a.maliyet !== undefined && num(a.maliyet) === 0 ? 1 : 0) },
    { id: 'kurum_onerisi', ad: 'Otoriteye güven', kuram: 'Kaynak güvenilirliği (Hovland); yönetimsellik (Foucault) — uyum içselleştirilmiş güvenle', onsel: 1.3,
      z: (f, p, a) => (a.kurum_onerisi ? f.kurumsal_guven - 0.45 : 0) },
    { id: 'risk_toplumu', ad: 'Düşünümsel kuşku', kuram: 'Beck (1986) risk toplumu — eğitimli ama güvensiz kesim uzman önerisine direnir', onsel: 0.6,
      z: (f, p, a) => (a.kurum_onerisi ? -f.egitim * (1 - f.kurumsal_guven) : 0) },
    { id: 'otoriteye_uyum', ad: 'Otoriteye uyum', kuram: 'Adorno vd. (1950); Fromm (1941) — otoriter yatkınlık resmî buyruğa uyar', onsel: 0.5,
      z: (f, p, a) => (a.kurum_onerisi || a.varsayilan ? authoritarian(f, p) : 0) },
    { id: 'bakim_yuku', ad: 'Bakım yükü ve zaman', kuram: 'Feminist ekonomi — ücretsiz bakım emeği kadının zamanını kısar', onsel: 0.3,
      z: (f, p, a, ctx) => (a.sure === undefined || !p?.cinsiyet ? 0 : -f.kadin * Math.log1p(num(a.sure) / Math.max(1, num(ctx.sure_medyan, 60)))) },
  ],
};

export const DECISION_DOMAINS = { siyaset: SIYASET, ticaret: TICARET, gundelik: GUNDELIK };

/** Kampanya/iletişim terimi tüm alanlarda ortak: kitle motorundan gelen kişi başı etki. */
export const ILETISIM = {
  id: 'iletisim', ad: 'İletişim/kampanya etkisi', kuram: 'Kitle motoru (20 iletişim kuramı)', onsel: 1.5,
  z: (f, p, a, ctx, i) => (ctx.iletisim && ctx.iletisim[a.id] ? ctx.iletisim[a.id][i] || 0 : 0),
};

/**
 * İletişim kuramları (kitle motorunun 20 kuramı) her alanda karar faydasının parçasıdır:
 * kişinin her seçeneğin kamusal iletişimine maruziyeti, o iletişimin kişide ürettiği tutum ve
 * mesajı egemen/karşıt okuma konumu. Değerler communication.js'de aynı personalar için hesaplanır.
 */
export const ILETISIM_TERIMLERI = [
  { id: 'iletisim_maruziyet', ad: 'Mesaja maruziyet ve gündem', kuram: 'Lasswell; gündem belirleme (McCombs & Shaw); propaganda modeli; dijital uçurum; iki aşamalı akış', onsel: 0.7,
    z: (f, p, a) => comm(p, a, 'm') },
  // Ölçülmüş maruziyet (reklam broşürü, raf teşhiri): kültür endüstrisinin "sahte ihtiyaç" üretimi
  // (Marcuse; Horkheimer & Adorno) ve ELM çevresel yolu — etkisi düşük bilişsel ihtiyaçta güçlü.
  { id: 'reklam_teshir', ad: 'Reklam ve teşhir maruziyeti', kuram: 'Kültür endüstrisi (Horkheimer & Adorno); sahte ihtiyaçlar (Marcuse); salt maruziyet (Zajonc); ELM çevresel yol', onsel: 1.0,
    z: (f, p, a) => (a.reklam === undefined && a.teshir === undefined ? 0 : (num(a.reklam) + 0.8 * num(a.teshir)) * (1.2 - 0.4 * f.nfc)) },
  { id: 'iletisim_tutum', ad: 'İletişimin ürettiği tutum', kuram: 'ELM; çerçeveleme; kaynak güvenilirliği; seçici maruziyet; ekme; tepkisellik; hegemonya', onsel: 1.4,
    z: (f, p, a) => comm(p, a, 't') },
  { id: 'hall_okuma', ad: 'Mesajın okunma konumu', kuram: 'Kodlama/kodaçımlama (Stuart Hall); kültürel hegemonya (Gramsci)', onsel: 0.9,
    z: (f, p, a) => comm(p, a, 'o') },
];

/**
 * SOSYAL BAĞLAM — karar bireyin kafasında değil, ilişkileri içinde verilir.
 * Columbia okulu (Lazarsfeld, Berelson & Gaudet 1944; Berelson vd. 1954): "Bir kişi siyasi olarak
 * nasıl düşünüyorsa sosyal olarak da öyledir"; Huckfeldt & Sprague (1995): bağlam ve tartışma ağları;
 * Zuckerman (2005) "Sosyal mantık": hane içi uyum; Jennings & Niemi (1968): aileden aktarım;
 * Chicago okulu (Park; Cooley/Mead): mahalle ekolojisi ve referans grupları. Üç düzey:
 *   aile      p.aile_tercihi = eşin / ebeveynin / hanenin tercihi (seçenek kimliği)
 *   ağ        p.ag_paylari = {seçenek: pay} — kişinin konuştuğu çevrede her seçeneğin payı (0..1 ya da %)
 *   topluluk  p.cevre_paylari = {seçenek: %} ya da p.bolge + baglam.bolge_paylari = {bölge: {seçenek: %}}
 * Topluluk etkisi topluluğa gömülülükle güçlenir (kırsal, yaşlı, dindar — cemaat; Harteveld & van der Brug).
 */
const share01 = (v) => { const x = num(v, NaN); return Number.isFinite(x) ? (x > 1 ? x / 100 : x) : null; };
const embedded = (f) => 0.4 * (1 - f.yerlesim) + 0.3 * f.yas + 0.3 * f.dindarlik;
export const SOSYAL_TERIMLERI = [
  { id: 'aile', ad: 'Aile / hane etkisi', kuram: 'Zuckerman (2005) sosyal mantık; Jennings & Niemi (1968) aileden aktarım', onsel: 1.5,
    z: (f, p, a) => (p?.aile_tercihi !== undefined && p.aile_tercihi !== null && String(p.aile_tercihi) === a.id ? 1 : 0) },
  { id: 'ag', ad: 'Tartışma ağı', kuram: 'Huckfeldt & Sprague (1995); Lazarsfeld vd. (1944) Columbia okulu; Katz iki aşamalı akış', onsel: 1.5,
    z: (f, p, a) => { const v = share01(p?.ag_paylari?.[a.id]); return v === null ? 0 : v; } },
  { id: 'topluluk', ad: 'Topluluk / mahalle bağlamı', kuram: 'Park — insan ekolojisi (Chicago); Berelson vd. (1954); Huckfeldt (1986) bağlam etkisi', onsel: 0.7,
    z: (f, p, a, ctx) => {
      const src = p?.cevre_paylari || (p?.bolge !== undefined ? ctx?.bolge_paylari?.[p.bolge] : null);
      const v = src ? share01(src[a.id]) : null;
      return v === null ? 0 : Math.log(v + 0.02) * (0.6 + 0.8 * embedded(f));
    } },
];

/**
 * Silikon terimi: dil modelinin bu kişiyi canlandırarak verdiği seçim olasılığı faydaya log-olasılık
 * olarak girer (log-doğrusal havuz / uzmanlar çarpımı). Katsayısı veriden öğrenilir: 0 = dil modeli
 * bilgi katmıyor, 1 = olasılıklarına olduğu gibi güven. Kuram terimleriyle AYNI fayda fonksiyonunda —
 * dil modeli ayrı bir tahminci değil, modelin bir bileşenidir. p.__silikon ensemble.attachSilicon ile dolar.
 */
export const SILIKON = {
  id: 'silikon', ad: 'Dil modeli sağduyusu (silikon örneklem)', kuram: 'Argyle vd. (2023) silikon örneklem; log-doğrusal havuz', onsel: 0.5,
  z: (f, p, a) => { const P = p?.__silikon?.[a.id]; return P === undefined ? 0 : Math.log(Math.max(0.01, P)); },
};

/**
 * Geçmiş davranış (durum bağımlılığı): önceki oy / marka / davranış en güçlü tek yordayıcıdır
 * (Heckman 1981; seçmen sadakati, marka sadakati). p.onceki = önceki seçimin kimliği.
 * Öğrenilen modelde 'onceki=X' demografik anahtarı ayrıca seçenekler arası GEÇİŞ matrisini öğrenir.
 */
export const GECMIS = {
  id: 'gecmis', ad: 'Geçmiş davranış / sadakat', kuram: 'Durum bağımlılığı (Heckman 1981); akılcı bağımlılık (Becker & Murphy 1988, Chicago); alışkanlık', onsel: 2.0,
  z: (f, p, a) => (p.onceki !== undefined && p.onceki !== null && String(p.onceki) === a.id ? 1 : 0),
};

export { IDEO };
