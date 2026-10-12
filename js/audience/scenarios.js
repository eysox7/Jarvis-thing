// Hazır örnek senaryolar: her alandan bir kurum iletişimi. Kitle sekmesinde tek dokunuşla
// yüklenir; ajan da audience_catalog → senaryolar ile görebilir. Metinler kurgusaldır.

export const SCENARIOS = {
  asi_kampanyasi: {
    ad: 'Sağlık: grip aşısı kampanyası', kurum: 'kamu_bakanlik', kanallar: ['tv', 'sms'],
    metin: 'Grip aşısı olmazsanız sevdiklerinizi riske atarsınız. Araştırmaya göre aşı olanlar %40 daha az hastalanıyor. Aile hekiminize başvurun.',
  },
  deprem_tahliye: {
    ad: 'Kriz: deprem sonrası tahliye uyarısı', kurum: 'belediye', kanallar: ['sms', 'sosyal', 'radyo_podcast'],
    metin: 'Acil uyarı: artçı deprem riski nedeniyle hasarlı binalara girmeyin. En yakın toplanma alanına gidin, yaşlı komşularınıza yardım edin.',
  },
  secim_mitingi: {
    ad: 'Siyaset: iktidar partisi seçim mesajı', kurum: 'parti_iktidar', kanallar: ['tv', 'sosyal'],
    metin: 'Güçlü Türkiye için istikrar şart. Milli iradeye karşı oyun oynayanlara sandıkta hesap soracağız!',
  },
  muhalefet_ekonomi: {
    ad: 'Siyaset: muhalefet ekonomi eleştirisi', kurum: 'parti_muhalefet', kanallar: ['sosyal', 'yuz_yuze'],
    metin: 'Emekçinin maaşı enflasyona eziliyor. TÜİK verilerine göre gıda fiyatları bir yılda %70 arttı. Adil bir ekonomi mümkün.',
  },
  marka_indirim: {
    ad: 'Ticaret: büyük marka indirim kampanyası', kurum: 'holding_marka', kanallar: ['influencer', 'sosyal'],
    metin: 'Efsane indirim başladı! Tüm ürünlerde %50 fırsat, hemen sipariş ver, stoklarla sınırlı 🔥',
  },
  iklim_stk: {
    ad: 'Çevre: STK iklim çağrısı', kurum: 'stk', kanallar: ['sosyal', 'yuz_yuze'],
    metin: 'Kuraklık kapıda. Barajlardaki su seviyesi son 10 yılın en düşüğünde. Gelecek kuşaklar için su tasarrufu herkesin görevi.',
  },
  universite_burs: {
    ad: 'Eğitim: üniversite burs duyurusu', kurum: 'universite', kanallar: ['haber_sitesi', 'sosyal'],
    metin: 'Yeni burs programımızla ilk kez dezavantajlı bölgelerden gelen kadın öğrencilere tam burs sağlıyoruz. Herkes için eşit fırsat.',
  },
  kulup_transfer: {
    ad: 'Spor: kulüp transfer açıklaması', kurum: 'spor_kulubu', kanallar: ['sosyal', 'tv'],
    metin: 'Yıldız golcümüz takımımıza katıldı! Şampiyonluk yolunda birlikte başaracağız, taraftarımızı stadyuma bekliyoruz.',
  },
  bagimsiz_sorusturma: {
    ad: 'Medya: bağımsız medyadan yolsuzluk haberi', kurum: 'bagimsiz_medya', kanallar: ['sosyal', 'haber_sitesi'],
    metin: 'Belgelere göre ihale 3 kat pahalıya verildi. Yolsuzluk iddialarına karşı kamuoyunun hesap sorma hakkı var.',
  },
  diyanet_bayram: {
    ad: 'Din: bayram dayanışma çağrısı', kurum: 'dini_kurum', kanallar: ['yuz_yuze', 'tv'],
    metin: 'Bayram, paylaşmanın ve dayanışmanın vaktidir. Zekat ve kurban bağışlarınızla ihtiyaç sahibi ailelerin yanında olun.',
  },
};
