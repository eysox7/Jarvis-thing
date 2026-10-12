// Hazır karar senaryoları (kurgusal): Karar sekmesinde ve testlerde başlangıç noktası.
export const DECISION_PRESETS = {
  secim: {
    ad: 'Siyaset: genel seçim', alan: 'siyaset', baglam: { ekonomi_algisi: -0.3 },
    secenekler: [
      { id: 'A', ad: 'İktidar partisi (sağ-muhafazakâr)', ekonomi: 0.4, kultur: 0.7, kimlik: 'sag', iktidar: true, lider: 0.6, anket: 0.38 },
      { id: 'B', ad: 'Ana muhalefet (merkez sol)', ekonomi: -0.4, kultur: -0.4, kimlik: 'sol', lider: 0.5, anket: 0.28 },
      { id: 'C', ad: 'Milliyetçi sağ', ekonomi: 0.3, kultur: 0.4, kimlik: 'sag', lider: 0.5, anket: 0.1 },
      { id: 'D', ad: 'Liberal merkez', ekonomi: 0.2, kultur: -0.3, kimlik: 'merkez', lider: 0.55, anket: 0.08 },
      { id: 'X', ad: 'Oy kullanmama', tur: 'cekimser' },
    ],
  },
  telefon: {
    ad: 'Ticaret: akıllı telefon pazarı', alan: 'ticaret', baglam: { kategori_yuku: 0.5 },
    secenekler: [
      { id: 'P', ad: 'Premium marka', fiyat: 45000, kalite: 0.9, marka: 0.95, puan: 0.8 },
      { id: 'O', ad: 'Orta segment', fiyat: 22000, kalite: 0.7, marka: 0.6, puan: 0.75, referans_fiyat: 25000 },
      { id: 'Y', ad: 'Yerli uygun fiyatlı', fiyat: 12000, kalite: 0.5, marka: 0.4, puan: 0.6, yerli: true },
      { id: 'N', ad: 'Şimdilik almıyorum', tur: 'disarida' },
    ],
  },
  market: {
    ad: 'Ticaret: market alışverişi kanalı', alan: 'ticaret', baglam: { kategori_yuku: 0.2 },
    secenekler: [
      { id: 'zincir', ad: 'Zincir süpermarket', fiyat: 100, kalite: 0.65, marka: 0.7, puan: 0.6, mevcut: true },
      { id: 'indirim', ad: 'İndirim marketi', fiyat: 80, kalite: 0.5, marka: 0.5, puan: 0.65 },
      { id: 'online', ad: 'Online market', fiyat: 105, kalite: 0.7, marka: 0.6, puan: 0.7, online: true },
      { id: 'pazar', ad: 'Semt pazarı', fiyat: 85, kalite: 0.75, marka: 0.3, puan: 0.7, yerli: true },
    ],
  },
  asi: {
    ad: 'Gündelik: mevsimsel aşı', alan: 'gundelik',
    secenekler: [
      { id: 'evet', ad: 'Aşı olurum', fayda: 0.8, maliyet: 0.2, risk: 0.25, gecikmeli_fayda: 0.7, norm: 0.5, kurum_onerisi: true, zorluk: 0.2 },
      { id: 'hayir', ad: 'Olmam', fayda: 0.4, risk: 0.2, varsayilan: true, aliskanlik: 0.3 },
    ],
  },
  ulasim: {
    ad: 'Gündelik: işe gidiş', alan: 'gundelik',
    secenekler: [
      { id: 'araba', ad: 'Özel araç', fayda: 0.75, maliyet: 0.7, risk: 0.2, aliskanlik: 0.6, norm: 0.5 },
      { id: 'toplu', ad: 'Toplu taşıma', fayda: 0.55, maliyet: 0.2, risk: 0.15, norm: 0.55, zorluk: 0.3 },
      { id: 'bisiklet', ad: 'Bisiklet / yürüyüş', fayda: 0.5, maliyet: 0.05, risk: 0.35, gecikmeli_fayda: 0.5, norm: 0.15, zorluk: 0.5 },
    ],
  },
  tasarruf: {
    ad: 'Gündelik: bireysel emeklilik (otomatik katılım)', alan: 'gundelik',
    secenekler: [
      { id: 'kal', ad: 'Sistemde kal', fayda: 0.7, maliyet: 0.35, risk: 0.2, gecikmeli_fayda: 0.95, varsayilan: true, kurum_onerisi: true },
      { id: 'cik', ad: 'Cayma hakkını kullan', fayda: 0.5, risk: 0.05, norm: 0.4 },
    ],
  },
};
