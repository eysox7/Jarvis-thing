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

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const IDEO = { sol: -1, merkez: 0, sag: 1 };

/* ============================== SİYASET ============================== */
// Persona'nın iki boyutlu siyasi uzaydaki konumu: ekonomi (sol-sağ) ve kültür (liberal-muhafazakâr).
export function politicalPosition(f) {
  return {
    ekonomi: clamp(0.75 * f.ideoloji + 0.35 * (f.gelir - 0.5), -1, 1),
    kultur: clamp(0.55 * (f.dindarlik * 2 - 1) + 0.35 * f.ideoloji + 0.15 * (f.yas - 0.5) - 0.15 * (f.yerlesim - 0.5), -1, 1),
  };
}
const partyPos = (a) => ({ ekonomi: num(a.ekonomi ?? a.konum?.ekonomi), kultur: num(a.kultur ?? a.konum?.kultur) });
const isAbstain = (a) => a.tur === 'cekimser' || a.id === 'oy_kullanmama';

export const SIYASET = {
  id: 'siyaset', ad: 'Siyasi karar (oy verme)',
  seceneOzellikleri: {
    ekonomi: '-1 (sol) .. 1 (sağ) ekonomik konum', kultur: '-1 (liberal) .. 1 (muhafazakâr) kültürel konum',
    kimlik: '"sol" | "merkez" | "sag" — parti kimliği tabanı', iktidar: 'boolean — görevdeki parti mi',
    lider: '0..1 lider/aday değerlendirmesi (valens)', anket: '0..1 beklenen oy payı (stratejik oy)',
    tur: '"cekimser" → oy kullanmama seçeneği',
  },
  baglam: { ekonomi_algisi: '-1 (kötü) .. 1 (iyi) genel ekonomik algı (varsayılan -0.2)' },
  terimler: [
    { id: 'yakinlik', ad: 'Mekânsal yakınlık', kuram: 'Downs (1957) — mekânsal oy modeli', onsel: 1.6,
      z: (f, p, a) => { if (isAbstain(a)) return 0; const v = politicalPosition(f), q = partyPos(a); return -((v.ekonomi - q.ekonomi) ** 2 + (v.kultur - q.kultur) ** 2); } },
    { id: 'yon', ad: 'Yönsel oy', kuram: 'Rabinowitz & Macdonald (1989)', onsel: 0.7,
      z: (f, p, a) => { if (isAbstain(a)) return 0; const v = politicalPosition(f), q = partyPos(a); return v.ekonomi * q.ekonomi + v.kultur * q.kultur; } },
    { id: 'parti_kimligi', ad: 'Parti kimliği', kuram: 'Campbell vd. (1960) — Michigan modeli', onsel: 1.3,
      z: (f, p, a) => (!isAbstain(a) && a.kimlik && a.kimlik === p.ideoloji ? 0.5 + f.yas : 0) },
    { id: 'ekonomik_oy', ad: 'Geriye dönük ekonomik oy', kuram: 'Fiorina (1981); Lewis-Beck (1988)', onsel: 1.4,
      z: (f, p, a, ctx) => (a.iktidar ? num(ctx.ekonomi_algisi, -0.2) + 0.5 * (f.gelir - 0.4) : 0) },
    { id: 'kurumsal_guven', ad: 'Sistem güveni', kuram: 'Easton (1965) — yaygın destek', onsel: 1.0,
      z: (f, p, a) => (a.iktidar ? f.kurumsal_guven - 0.5 : 0) },
    { id: 'lider', ad: 'Lider / valens', kuram: 'Stokes (1963) — valens meseleleri', onsel: 1.5,
      z: (f, p, a) => (isAbstain(a) ? 0 : num(a.lider, 0.5) - 0.5) },
    { id: 'stratejik', ad: 'Stratejik oy', kuram: 'Duverger (1954); Cox (1997)', onsel: 0.45,
      z: (f, p, a) => (isAbstain(a) || a.anket === undefined ? 0 : Math.log(num(a.anket) + 0.02) * (0.5 + 0.5 * f.nfc)) },
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
    online: 'boolean — yalnızca çevrimiçi satılıyor', tur: '"disarida" → satın almama seçeneği',
  },
  baglam: { kategori_yuku: '0..1 kategorinin bütçe yükü (dışarıda kalma eğilimi, varsayılan 0.4)' },
  hazirla: (alts) => {
    const prices = alts.filter((a) => !isOutside(a) && num(a.fiyat) > 0).map((a) => num(a.fiyat)).sort((x, y) => x - y);
    return { fiyat_medyan: prices.length ? prices[Math.floor(prices.length / 2)] : 1 };
  },
  terimler: [
    { id: 'fiyat', ad: 'Fiyat duyarlılığı', kuram: 'Mikroekonomik talep; gelir etkisi', onsel: 1.6,
      z: (f, p, a, ctx) => (isOutside(a) || !(num(a.fiyat) > 0) ? 0 : -Math.log(num(a.fiyat) / ctx.fiyat_medyan) * (1.5 - f.gelir)) },
    { id: 'kayip_kacinma', ad: 'Kayıp kaçınma / referans fiyat', kuram: 'Kahneman & Tversky (1979); Thaler (1985)', onsel: 1.5,
      z: (f, p, a) => { if (isOutside(a) || !(num(a.referans_fiyat) > 0) || !(num(a.fiyat) > 0)) return 0; const g = (num(a.referans_fiyat) - num(a.fiyat)) / num(a.referans_fiyat); return g >= 0 ? g : 2.25 * g; } },
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
    gecikmeli_fayda: '0..1 faydanın ne kadarı gelecekte', norm: '0..1 çevrede yapanların oranı (betimleyici norm)',
    varsayilan: 'boolean — hiçbir şey yapmazsan olan', aliskanlik: '0..1 alışkanlık gücü',
    zorluk: '0..1 uygulama zorluğu', dijital: 'boolean — dijital beceri gerektirir',
    kurum_onerisi: 'boolean — bir otorite/kurum öneriyor',
  },
  baglam: {},
  terimler: [
    { id: 'fayda', ad: 'Beklenen fayda', kuram: 'Beklenen fayda (von Neumann–Morgenstern)', onsel: 2.2,
      z: (f, p, a) => num(a.fayda, 0.5) - 0.5 },
    { id: 'maliyet', ad: 'Maliyet / çaba', kuram: 'Fayda-maliyet; gelir kısıtı', onsel: 1.6,
      z: (f, p, a) => -num(a.maliyet) * (1.3 - 0.6 * f.gelir) },
    { id: 'risk', ad: 'Risk kaçınma', kuram: 'Beklenti kuramı (Kahneman & Tversky 1979)', onsel: 1.3,
      z: (f, p, a) => -num(a.risk) * (0.5 + 0.6 * f.yas + 0.4 * (1 - f.gelir)) },
    { id: 'simdiki_zaman', ad: 'Şimdiki zaman yanlılığı', kuram: 'Hiperbolik iskonto (Laibson 1997)', onsel: 1.2,
      z: (f, p, a) => -num(a.gecikmeli_fayda) * num(a.fayda, 0.5) * (0.9 - 0.5 * f.nfc - 0.2 * f.egitim) },
    { id: 'sosyal_norm', ad: 'Sosyal norm', kuram: 'Planlı davranış (Ajzen 1991); Cialdini (1990)', onsel: 1.5,
      z: (f, p, a) => (a.norm === undefined ? 0 : (num(a.norm) - 0.5) * (0.6 + 0.4 * (1 - f.nfc) + 0.3 * f.dindarlik)) },
    { id: 'varsayilan', ad: 'Varsayılan etkisi', kuram: 'Johnson & Goldstein (2003); Thaler & Sunstein', onsel: 1.1,
      z: (f, p, a) => (a.varsayilan ? 1.2 - 0.5 * f.nfc : 0) },
    { id: 'aliskanlik', ad: 'Alışkanlık', kuram: 'Verplanken & Aarts (1999)', onsel: 1.1,
      z: (f, p, a) => num(a.aliskanlik) * (0.5 + 0.5 * f.yas) },
    { id: 'algilanan_kontrol', ad: 'Algılanan davranışsal kontrol', kuram: 'Ajzen (1991)', onsel: 1.2,
      z: (f, p, a) => -num(a.zorluk) * (1.1 - 0.4 * f.egitim) - (a.dijital ? (0.6 - f.dijital) : 0) },
    { id: 'kurum_onerisi', ad: 'Otoriteye güven', kuram: 'Kaynak güvenilirliği (Hovland); kurumsal güven', onsel: 1.3,
      z: (f, p, a) => (a.kurum_onerisi ? f.kurumsal_guven - 0.45 : 0) },
  ],
};

export const DECISION_DOMAINS = { siyaset: SIYASET, ticaret: TICARET, gundelik: GUNDELIK };

/** Kampanya/iletişim terimi tüm alanlarda ortak: kitle motorundan gelen kişi başı etki. */
export const ILETISIM = {
  id: 'iletisim', ad: 'İletişim/kampanya etkisi', kuram: 'Kitle motoru (20 iletişim kuramı)', onsel: 1.5,
  z: (f, p, a, ctx, i) => (ctx.iletisim && ctx.iletisim[a.id] ? ctx.iletisim[a.id][i] || 0 : 0),
};

export { IDEO };
