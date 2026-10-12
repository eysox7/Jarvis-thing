// Kurum ve alan profilleri. "Kurumlarla uyumlu" olmanın anlamı: her tahmin, mesajı kimin
// gönderdiğini (sahiplik, ideolojik konum, iktidar yapısındaki yeri, alan uzmanlığı) hesaba
// katar; kurum kendi profilini tanımlayabilir ve kendi nüfus verisiyle örneklemi ezer.
// Profiller jenerik türlerdir — gerçek bir kurumu temsil etmez; kurum kendi değerlerini girer.

/**
 * Alanlar ("her alanda tahmin"). Her alan:
 *  interest(f)   — persona özelliklerinden ilgi/ilgilenim (0..1) — Kullanımlar & Doyumlar
 *  frames        — çerçeve etkinlik çarpanları (Çerçeveleme)
 *  controversy   — taban tartışmalılık (Suskunluk Sarmalı)
 *  ideological   — ideolojik mesafenin ne kadar belirleyici olduğu (0..1)
 *  expertise     — uzman kaynağa duyarlılık
 */
export const DOMAINS = {
  siyaset: { label: 'Siyaset', interest: (f) => 0.35 + 0.25 * f.egitim + 0.2 * f.yas + 0.2 * Math.abs(f.ideoloji), frames: { catisma: 1.3, ahlaki: 1.2, sorumluluk: 1.1, ekonomik: 1.1 }, controversy: 0.8, ideological: 1, expertise: 0.3 },
  saglik: { label: 'Sağlık', interest: (f) => 0.4 + 0.35 * f.yas + 0.15 * f.kadin, frames: { kayip: 1.3, korku: 1.15, insan_hikayesi: 1.2, kazanc: 1 }, controversy: 0.35, ideological: 0.35, expertise: 1 },
  ticaret: { label: 'Ticaret / pazarlama', interest: (f) => 0.3 + 0.3 * f.gelir + 0.2 * f.dijital + 0.1 * (1 - f.yas), frames: { kazanc: 1.3, umut: 1.15, insan_hikayesi: 1.1, ekonomik: 1.2 }, controversy: 0.15, ideological: 0.15, expertise: 0.4 },
  egitim: { label: 'Eğitim', interest: (f) => 0.35 + 0.3 * f.egitim + 0.2 * (1 - f.yas), frames: { umut: 1.2, kazanc: 1.15, sorumluluk: 1.1 }, controversy: 0.4, ideological: 0.45, expertise: 0.8 },
  kultur: { label: 'Kültür / eğlence', interest: (f) => 0.45 + 0.25 * (1 - f.yas) + 0.15 * f.dijital, frames: { insan_hikayesi: 1.3, umut: 1.15 }, controversy: 0.2, ideological: 0.25, expertise: 0.2 },
  spor: { label: 'Spor', interest: (f) => 0.35 + 0.3 * (1 - f.kadin) + 0.15 * (1 - f.yas), frames: { catisma: 1.25, umut: 1.2, insan_hikayesi: 1.15 }, controversy: 0.3, ideological: 0.1, expertise: 0.2 },
  bilim: { label: 'Bilim / teknoloji', interest: (f) => 0.25 + 0.35 * f.egitim + 0.25 * f.dijital + 0.15 * f.nfc, frames: { kazanc: 1.15, umut: 1.2, ekonomik: 1.05 }, controversy: 0.3, ideological: 0.3, expertise: 1 },
  kriz: { label: 'Kriz / afet iletişimi', interest: (f) => 0.75 + 0.15 * f.yas, frames: { korku: 1.1, sorumluluk: 1.3, insan_hikayesi: 1.2, kayip: 1.15 }, controversy: 0.45, ideological: 0.3, expertise: 0.9 },
  cevre: { label: 'Çevre / iklim', interest: (f) => 0.3 + 0.25 * (1 - f.yas) + 0.2 * f.egitim + 0.1 * (f.ideoloji < 0 ? 1 : 0), frames: { kayip: 1.2, ahlaki: 1.15, umut: 1.15, korku: 1.05 }, controversy: 0.55, ideological: 0.6, expertise: 0.8 },
  finans: { label: 'Finans / ekonomi', interest: (f) => 0.35 + 0.3 * f.gelir + 0.2 * f.egitim, frames: { ekonomik: 1.3, kayip: 1.2, kazanc: 1.15 }, controversy: 0.4, ideological: 0.5, expertise: 0.8 },
  din: { label: 'Din / değerler', interest: (f) => 0.2 + 0.65 * f.dindarlik, frames: { ahlaki: 1.4, insan_hikayesi: 1.1, sorumluluk: 1.1 }, controversy: 0.6, ideological: 0.7, expertise: 0.5 },
  kamu_hizmeti: { label: 'Kamu hizmeti / yerel yönetim', interest: (f) => 0.45 + 0.2 * f.yas + 0.15 * f.yerlesim, frames: { sorumluluk: 1.2, ekonomik: 1.15, insan_hikayesi: 1.1 }, controversy: 0.4, ideological: 0.55, expertise: 0.5 },
};

/** Çerçeveler (Semetko & Valkenburg + Kahneman–Tversky kazanç/kayıp). */
export const FRAMES = {
  notr: 'Nötr bilgilendirme',
  kazanc: 'Kazanç çerçevesi (yaparsan kazanırsın)',
  kayip: 'Kayıp çerçevesi (yapmazsan kaybedersin)',
  korku: 'Korku çağrısı',
  umut: 'Umut / ilham',
  ahlaki: 'Ahlaki / değer çerçevesi',
  ekonomik: 'Ekonomik sonuçlar',
  catisma: 'Çatışma',
  insan_hikayesi: 'İnsan hikâyesi',
  sorumluluk: 'Sorumluluk atfı',
};

/** Kanallar: taban erişim + hangi ana medya kullanıcısına ulaştığı + ana akım mı (Propaganda Modeli). */
export const CHANNELS = {
  tv: { label: 'Televizyon', reach: { tv: 0.85, sosyal: 0.3, haber_sitesi: 0.35, yazili: 0.55, radyo_podcast: 0.4 }, mainstream: 1, digital: 0 },
  sosyal: { label: 'Sosyal medya', reach: { tv: 0.15, sosyal: 0.8, haber_sitesi: 0.45, yazili: 0.1, radyo_podcast: 0.35 }, mainstream: 0.3, digital: 1 },
  haber_sitesi: { label: 'Haber sitesi', reach: { tv: 0.15, sosyal: 0.4, haber_sitesi: 0.8, yazili: 0.3, radyo_podcast: 0.3 }, mainstream: 0.6, digital: 1 },
  yazili: { label: 'Yazılı basın', reach: { tv: 0.15, sosyal: 0.05, haber_sitesi: 0.2, yazili: 0.85, radyo_podcast: 0.15 }, mainstream: 0.9, digital: 0 },
  radyo_podcast: { label: 'Radyo / podcast', reach: { tv: 0.2, sosyal: 0.25, haber_sitesi: 0.25, yazili: 0.25, radyo_podcast: 0.85 }, mainstream: 0.5, digital: 0.5 },
  influencer: { label: 'Influencer / içerik üretici', reach: { tv: 0.05, sosyal: 0.7, haber_sitesi: 0.2, yazili: 0.02, radyo_podcast: 0.2 }, mainstream: 0.2, digital: 1 },
  sms: { label: 'SMS / e-posta', reach: { tv: 0.55, sosyal: 0.55, haber_sitesi: 0.55, yazili: 0.55, radyo_podcast: 0.55 }, mainstream: 0.5, digital: 0.5 },
  yuz_yuze: { label: 'Yüz yüze / saha', reach: { tv: 0.2, sosyal: 0.15, haber_sitesi: 0.15, yazili: 0.2, radyo_podcast: 0.15 }, mainstream: 0, digital: 0 },
};

/**
 * Kurum türleri. Alanlar:
 *  sahiplik       devlet | sermaye | bagimsiz | uye  (Propaganda Modeli: sahiplik filtresi)
 *  ideoloji       -1 (sol) .. 1 (sağ) algılanan konum (Düşmanca Medya Etkisi)
 *  hegemonik      0..1 iktidar yapısına gömülülük (Gramsci / Hall)
 *  guvenilirlik   0..1 taban güvenilirlik
 *  uzmanlik       {alan: 0..1} alan uzmanlığı
 *  ticari         0..1 ticari motivasyon (Kültür Endüstrisi, reklam filtresi)
 *  kanallar       tipik kanallar
 */
export const INSTITUTIONS = {
  kamu_bakanlik: { ad: 'Merkezi kamu kurumu (bakanlık)', sahiplik: 'devlet', ideoloji: 0.4, hegemonik: 0.95, guvenilirlik: 0.55, uzmanlik: { saglik: 0.8, egitim: 0.7, kriz: 0.8, finans: 0.6, kamu_hizmeti: 0.7 }, ticari: 0, kanallar: ['tv', 'sms', 'sosyal'] },
  belediye: { ad: 'Belediye / yerel yönetim', sahiplik: 'devlet', ideoloji: 0, hegemonik: 0.6, guvenilirlik: 0.55, uzmanlik: { kamu_hizmeti: 0.9, kriz: 0.6, cevre: 0.5, kultur: 0.5 }, ticari: 0, kanallar: ['sosyal', 'yuz_yuze', 'sms'] },
  universite: { ad: 'Üniversite / akademi', sahiplik: 'bagimsiz', ideoloji: -0.2, hegemonik: 0.45, guvenilirlik: 0.7, uzmanlik: { bilim: 0.95, saglik: 0.8, egitim: 0.9, cevre: 0.8, finans: 0.6 }, ticari: 0.1, kanallar: ['haber_sitesi', 'sosyal', 'radyo_podcast'] },
  bilim_kurumu: { ad: 'Bilim / araştırma kurumu', sahiplik: 'devlet', ideoloji: 0, hegemonik: 0.6, guvenilirlik: 0.68, uzmanlik: { bilim: 1, saglik: 0.7, cevre: 0.8, kriz: 0.7 }, ticari: 0, kanallar: ['haber_sitesi', 'tv'] },
  uluslararasi: { ad: 'Uluslararası kuruluş', sahiplik: 'uye', ideoloji: -0.3, hegemonik: 0.55, guvenilirlik: 0.55, uzmanlik: { saglik: 0.9, cevre: 0.85, finans: 0.7, kriz: 0.8 }, ticari: 0, kanallar: ['haber_sitesi', 'sosyal'] },
  holding_marka: { ad: 'Büyük şirket / marka', sahiplik: 'sermaye', ideoloji: 0.1, hegemonik: 0.75, guvenilirlik: 0.45, uzmanlik: { ticaret: 0.9, finans: 0.6, bilim: 0.3, kultur: 0.4 }, ticari: 1, kanallar: ['tv', 'sosyal', 'influencer'] },
  kobi: { ad: 'Küçük işletme / KOBİ', sahiplik: 'sermaye', ideoloji: 0, hegemonik: 0.2, guvenilirlik: 0.55, uzmanlik: { ticaret: 0.7 }, ticari: 0.9, kanallar: ['sosyal', 'yuz_yuze'] },
  anaakim_medya: { ad: 'Ana akım medya kuruluşu', sahiplik: 'sermaye', ideoloji: 0.3, hegemonik: 0.85, guvenilirlik: 0.4, uzmanlik: { siyaset: 0.6, spor: 0.6, kultur: 0.6, kriz: 0.5 }, ticari: 0.8, kanallar: ['tv', 'haber_sitesi'] },
  bagimsiz_medya: { ad: 'Bağımsız / alternatif medya', sahiplik: 'bagimsiz', ideoloji: -0.4, hegemonik: 0.15, guvenilirlik: 0.5, uzmanlik: { siyaset: 0.7, cevre: 0.6, finans: 0.5 }, ticari: 0.3, kanallar: ['sosyal', 'haber_sitesi', 'radyo_podcast'] },
  stk: { ad: 'Sivil toplum kuruluşu (STK)', sahiplik: 'uye', ideoloji: -0.3, hegemonik: 0.2, guvenilirlik: 0.6, uzmanlik: { cevre: 0.85, egitim: 0.6, saglik: 0.5, kriz: 0.7 }, ticari: 0, kanallar: ['sosyal', 'yuz_yuze'] },
  parti_iktidar: { ad: 'Siyasi parti (iktidar)', sahiplik: 'uye', ideoloji: 0.7, hegemonik: 0.95, guvenilirlik: 0.45, uzmanlik: { siyaset: 0.8, kamu_hizmeti: 0.6 }, ticari: 0, kanallar: ['tv', 'sosyal', 'yuz_yuze'] },
  parti_muhalefet: { ad: 'Siyasi parti (muhalefet)', sahiplik: 'uye', ideoloji: -0.5, hegemonik: 0.35, guvenilirlik: 0.45, uzmanlik: { siyaset: 0.8, kamu_hizmeti: 0.5 }, ticari: 0, kanallar: ['sosyal', 'yuz_yuze', 'haber_sitesi'] },
  dini_kurum: { ad: 'Dini kurum / cemaat', sahiplik: 'uye', ideoloji: 0.8, hegemonik: 0.7, guvenilirlik: 0.55, uzmanlik: { din: 1, kultur: 0.5, egitim: 0.4 }, ticari: 0, kanallar: ['yuz_yuze', 'tv', 'radyo_podcast'] },
  hastane: { ad: 'Hastane / sağlık kuruluşu', sahiplik: 'bagimsiz', ideoloji: 0, hegemonik: 0.5, guvenilirlik: 0.7, uzmanlik: { saglik: 1, kriz: 0.6 }, ticari: 0.4, kanallar: ['yuz_yuze', 'sosyal', 'sms'] },
  spor_kulubu: { ad: 'Spor kulübü', sahiplik: 'uye', ideoloji: 0, hegemonik: 0.4, guvenilirlik: 0.5, uzmanlik: { spor: 1, kultur: 0.4 }, ticari: 0.6, kanallar: ['sosyal', 'tv'] },
  influencer: { ad: 'Bireysel içerik üretici', sahiplik: 'bagimsiz', ideoloji: 0, hegemonik: 0.25, guvenilirlik: 0.4, uzmanlik: { kultur: 0.6, ticaret: 0.6 }, ticari: 0.7, kanallar: ['influencer', 'sosyal'] },
};

/** Kullanıcının verdiği kısmi kurum tanımını tam profile tamamlar. */
export function resolveInstitution(inst) {
  if (!inst) return { id: 'genel', ...INSTITUTIONS.stk, ad: 'Belirtilmemiş kaynak', guvenilirlik: 0.5, hegemonik: 0.5, ideoloji: 0 };
  if (typeof inst === 'string') {
    const base = INSTITUTIONS[inst];
    if (!base) throw new Error(`bilinmeyen kurum: ${inst}. Kullanılabilir: ${Object.keys(INSTITUTIONS).join(', ')}`);
    return { id: inst, ...base };
  }
  const base = inst.tur && INSTITUTIONS[inst.tur] ? INSTITUTIONS[inst.tur] : INSTITUTIONS.stk;
  const num = (v, d, lo = 0, hi = 1) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
  return {
    ...base,
    ...inst,
    id: inst.id || inst.tur || 'ozel',
    ad: inst.ad || base.ad,
    ideoloji: num(inst.ideoloji, base.ideoloji, -1, 1),
    hegemonik: num(inst.hegemonik, base.hegemonik),
    guvenilirlik: num(inst.guvenilirlik, base.guvenilirlik),
    ticari: num(inst.ticari, base.ticari),
    uzmanlik: { ...base.uzmanlik, ...(inst.uzmanlik || {}) },
  };
}
