// Karar bankası. Her seçeneğin 8 eksende bir "iz" vektörü var; klon bu izler
// üzerinden kişinin ağırlıklarını öğrenir. Eksenler clone.js'teki TRAITS ile aynı sırada.

export const DILEMMAS = [
  { id: 'd01', q: 'Cumartesi akşamı boş vaktin var.', a: { t: 'Kalabalık bir partiye giderim', v: { sosyal: 1, yenilik: 0.5 } }, b: { t: 'Evde dizi + battaniye', v: { sosyal: -1 } } },
  { id: 'd02', q: 'Elinde 50.000 TL birikim var.', a: { t: 'Hisse/kripto ile büyütmeyi denerim', v: { risk: 1, tutum: -0.5 } }, b: { t: 'Vadeli hesapta güvende tutarım', v: { risk: -1, sabir: 0.5, tutum: 0.5 } } },
  { id: 'd03', q: 'Restoranda menüye bakıyorsun.', a: { t: 'Hiç denemediğim bir yemek', v: { yenilik: 1, risk: 0.5 } }, b: { t: 'Her zamanki favorim', v: { yenilik: -1 } } },
  { id: 'd04', q: 'Yakın arkadaşın senden sınavda kopya istiyor.', a: { t: 'Yardım ederim, arkadaşlık önemli', v: { sadakat: 1, risk: 0.5 } }, b: { t: 'Reddederim, kural kuraldır', v: { sadakat: -0.5, mantik: 0.5, risk: -0.5 } } },
  { id: 'd05', q: 'Yüksek maaşlı iş teklifi, ama hiç tanımadığın bir şehirde.', a: { t: 'Kabul, yeni bir başlangıç', v: { risk: 1, yenilik: 1 } }, b: { t: 'Reddederim, düzenim ve çevrem burada', v: { sadakat: 0.5, risk: -1, yenilik: -0.5 } } },
  { id: 'd06', q: 'Grup projesinde biri hiç çalışmıyor.', a: { t: 'Hocaya/yöneticiye söylerim', v: { rekabet: 1, mantik: 0.5, sadakat: -0.5 } }, b: { t: 'Onun kısmını da sessizce yaparım', v: { sadakat: 1, rekabet: -1 } } },
  { id: 'd07', q: 'Bir oyunda fena yeniliyorsun.', a: { t: 'Sonuna kadar zorlarım, pes yok', v: { rekabet: 1 } }, b: { t: 'Eğlenmeye bakarım, skor önemsiz', v: { rekabet: -1 } } },
  { id: 'd08', q: 'Uzun süredir istediğin telefon indirimde, ama ihtiyacın yok.', a: { t: 'Alırım, kendimi ödüllendiririm', v: { tutum: -1, sabir: -0.5 } }, b: { t: 'Almam, para kenarda dursun', v: { tutum: 1, sabir: 0.5 } } },
  { id: 'd09', q: 'Tatil planı yapıyorsun.', a: { t: 'Her şeyi önceden planlı tur', v: { risk: -1, mantik: 0.5 } }, b: { t: 'Sırt çantası, plansız macera', v: { risk: 1, yenilik: 1 } } },
  { id: 'd10', q: 'Önemli bir karar vereceksin.', a: { t: 'Artı-eksi listesi yaparım', v: { mantik: 1 } }, b: { t: 'İçgüdüme güvenirim', v: { mantik: -1 } } },
  { id: 'd11', q: 'Arkadaşın, sevmediğin birini de doğum gününe çağırmış.', a: { t: 'Yine de giderim, arkadaşım için', v: { sadakat: 1, sosyal: 0.5 } }, b: { t: 'Bahane bulup gitmem', v: { sadakat: -0.5, sosyal: -0.5 } } },
  { id: 'd12', q: 'Bugün 1.000 TL mi, bir yıl sonra 2.000 TL mi?', a: { t: 'Bugün 1.000 TL', v: { sabir: -1 } }, b: { t: 'Bir yıl sonra 2.000 TL', v: { sabir: 1, mantik: 0.5 } } },
  { id: 'd13', q: 'Yeni bir hobi seçiyorsun.', a: { t: 'Dalış, paraşüt gibi adrenalin', v: { risk: 1, yenilik: 0.5 } }, b: { t: 'Satranç, kitap kulübü', v: { risk: -1, mantik: 0.5 } } },
  { id: 'd14', q: 'Grup sohbetinde tartışma çıktı.', a: { t: 'Fikrimi açıkça savunurum', v: { rekabet: 1, sosyal: 0.5 } }, b: { t: 'Sessiz kalırım, ortamı germem', v: { rekabet: -1 } } },
  { id: 'd15', q: 'Zam isteme zamanı.', a: { t: 'Başka teklif alıp pazarlık ederim', v: { rekabet: 1, risk: 0.5 } }, b: { t: 'Verileni kabul ederim, sadık kalırım', v: { sadakat: 1, rekabet: -0.5, risk: -0.5 } } },
  { id: 'd16', q: 'Sinemaya gidiyorsunuz, film seçimi sende.', a: { t: 'Herkesin sevdiği gişe filmi', v: { sosyal: 0.5, yenilik: -0.5 } }, b: { t: 'Az bilinen bağımsız film', v: { yenilik: 1 } } },
  { id: 'd17', q: 'Spor salonu üyeliği alacaksın.', a: { t: 'Yıllık: ucuz ve bağlayıcı', v: { sabir: 1, tutum: 0.5 } }, b: { t: 'Aylık: esnek kalsın', v: { sabir: -1 } } },
  { id: 'd18', q: 'Arkadaşın 5.000 TL borç istiyor.', a: { t: 'Veririm, arkadaşım o', v: { sadakat: 1, tutum: -0.5, risk: 0.5 } }, b: { t: 'Kibarca reddederim', v: { tutum: 1, sadakat: -0.5 } } },
  { id: 'd19', q: 'Dizinin finali yarın; önüne spoiler videosu düştü.', a: { t: 'Tıklarım, merak ediyorum', v: { sabir: -1 } }, b: { t: 'Kaydırırım, beklerim', v: { sabir: 1 } } },
  { id: 'd20', q: 'Yeni bir dil öğreneceksin.', a: { t: 'Uygulamayla her gün 10 dakika', v: { sabir: 1, mantik: 0.5 } }, b: { t: 'O ülkeye gidip içine dalarım', v: { yenilik: 1, risk: 0.5 } } },
  { id: 'd21', q: 'Doğum günün yaklaşıyor.', a: { t: 'Büyük parti', v: { sosyal: 1 } }, b: { t: 'Yakın 2-3 kişiyle sakin yemek', v: { sosyal: -1, sadakat: 0.5 } } },
  { id: 'd22', q: 'Bilgi yarışmasına çağrıldın: ödül büyük ama herkes izleyecek.', a: { t: 'Giderim!', v: { rekabet: 1, risk: 1, sosyal: 0.5 } }, b: { t: 'Teşekkürler, kalsın', v: { risk: -1, sosyal: -0.5 } } },
  { id: 'd23', q: 'Ev arkadaşı seçeceksin.', a: { t: 'Eski, güvendiğim bir arkadaş', v: { sadakat: 1, risk: -0.5 } }, b: { t: 'Yeni tanıştığım ilginç biri', v: { yenilik: 1, risk: 0.5 } } },
  { id: 'd24', q: 'Telefonun bozuldu.', a: { t: 'Önce kendim tamir etmeyi denerim', v: { mantik: 0.5, tutum: 1, risk: 0.5 } }, b: { t: 'Direkt yenisini alırım', v: { tutum: -1 } } },
  { id: 'd25', q: 'Alarm çaldı, dışarıda yağmur var ve bugün spor günü.', a: { t: 'Yine de kalkarım', v: { sabir: 1, rekabet: 0.5 } }, b: { t: '5 dakika daha… bugün iptal', v: { sabir: -1 } } },
  { id: 'd26', q: 'Kendi işini kurma fırsatı çıktı.', a: { t: 'İşimi bırakıp girişirim', v: { risk: 1, rekabet: 0.5 } }, b: { t: 'Önce yan proje olarak denerim', v: { risk: -1, mantik: 0.5 } } },
  { id: 'd27', q: 'Tartışmanın ortasında haksız olduğunu fark ettin.', a: { t: 'Hemen kabul ederim', v: { mantik: 1, rekabet: -0.5 } }, b: { t: 'Konuyu değiştiririm', v: { rekabet: 0.5, mantik: -0.5 } } },
  { id: 'd28', q: 'Tatile kiminle?', a: { t: 'Kalabalık arkadaş grubuyla', v: { sosyal: 1, sadakat: 0.5 } }, b: { t: 'Tek başıma', v: { sosyal: -1, yenilik: 0.5 } } },
  { id: 'd29', q: 'Tuttuğun takım sezonu çok kötü geçiriyor.', a: { t: 'Sonuna kadar destek', v: { sadakat: 1 } }, b: { t: 'Biraz soğurum, kazananı izlerim', v: { sadakat: -1, rekabet: 0.5 } } },
  { id: 'd30', q: 'Birine hediye alacaksın.', a: { t: 'Kişiye özel, uzun düşündüğüm bir şey', v: { mantik: -1, sadakat: 0.5 } }, b: { t: 'Pratik bir şey ya da hediye çeki', v: { mantik: 1 } } },
  { id: 'd31', q: 'İki ödül seçeneği var.', a: { t: 'Kesin küçük ödül', v: { risk: -1 } }, b: { t: '%30 ihtimalle büyük ödül', v: { risk: 1 } } },
  { id: 'd32', q: 'Yeni bir uygulama/teknoloji çıktı.', a: { t: 'İlk deneyenlerden olurum', v: { yenilik: 1, risk: 0.5 } }, b: { t: 'Herkes kullanınca bakarım', v: { yenilik: -1, risk: -0.5 } } },
  { id: 'd33', q: 'Cuma akşamı fazla mesai teklifi geldi.', a: { t: 'Kabul, kariyer önemli', v: { rekabet: 0.5, tutum: 0.5, sosyal: -0.5 } }, b: { t: 'Reddederim, arkadaşlarla planım var', v: { sosyal: 1, sadakat: 0.5 } } },
  { id: 'd34', q: 'Filmde ağlatan bir sahne geldi.', a: { t: 'Duygularımı saklamam', v: { mantik: -1 } }, b: { t: 'Kendimi tutarım', v: { mantik: 1 } } },
  { id: 'd35', q: 'Büyük sunuma 1 gün kaldı.', a: { t: 'Gece boyu son dakika çalışması', v: { sabir: -1, risk: 0.5 } }, b: { t: 'Zaten haftalardır hazırım', v: { sabir: 1, risk: -0.5 } } },
  { id: 'd36', q: 'Kalabalık masada hesap geldi.', a: { t: 'Herkes kendi yediğini öder', v: { tutum: 1, mantik: 0.5 } }, b: { t: 'Eşit bölelim, kafa yormayalım', v: { sosyal: 0.5, tutum: -0.5 } } },
  { id: 'd37', q: 'Sahneye çıkıp yeteneğini gösterme şansın var.', a: { t: 'Çıkarım, kaybetsem de', v: { risk: 1, rekabet: 0.5, sosyal: 0.5 } }, b: { t: 'İzleyici olarak kalırım', v: { risk: -1 } } },
  { id: 'd38', q: 'Eski bir arkadaşın yıllar sonra yazdı.', a: { t: 'Hemen buluşalım derim', v: { sadakat: 1, sosyal: 0.5 } }, b: { t: 'Kısa bir cevap verip geçerim', v: { sadakat: -1 } } },
  { id: 'd39', q: 'Saçını değiştirmek istiyorsun.', a: { t: 'Radikal bir değişiklik', v: { yenilik: 1, risk: 1 } }, b: { t: 'Hep aynı, güvenli', v: { yenilik: -1, risk: -1 } } },
  { id: 'd40', q: 'Ekipte rol seçeceksin.', a: { t: 'Lider olurum', v: { rekabet: 1, sosyal: 0.5 } }, b: { t: 'Arka planda uzman olurum', v: { rekabet: -1, mantik: 0.5 } } },
];

export const BY_ID = Object.fromEntries(DILEMMAS.map((d) => [d.id, d]));

// Her 4 sorudan biri klondan gizlenir (sınav seti). Herkes için aynı sorular
// olduğundan iki klon düelloda aynı soru üzerinde yarışabilir.
export const isHoldout = (id) => Number(id.slice(1)) % 4 === 0;
