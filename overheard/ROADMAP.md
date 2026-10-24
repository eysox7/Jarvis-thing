# Overheard — Yol haritası

Her 10 dakikalık turda sıradaki tamamlanmamış adım uygulanır, testler çalıştırılır,
commit'lenir ve `claude/overheard-app-development-bg76id` dalına push'lanır.

## Tamamlananlar

- [x] **1. Çekirdek sunucu** — Node.js (sıfır bağımlılık), yerleşik SQLite, oturumlar,
      pilot şehirler, başlangıç mekânları, check-in, **ortak mekân kuralı** (kilitli sözlerin
      metni sunucudan hiç çıkmaz), söz bırakma (orada olma şartı), yeni mekân açma,
      tepkiler, şikâyet/otomatik gizleme, engelleme, söz üzerinden mesajlaşma, SSE ile canlı
      mesaj, hız sınırları, CSP/Origin denetimi. API testleri.
- [x] **2. Arayüz** — Leaflet haritası, konuşma balonu işaretçileri (kilitli/açık/senin/aynı
      anda), tıklayınca büyük balon olarak açılma, uzaklaşınca mekân baloncukları, çakışan
      etiketlerin noktaya inmesi, keşif modu (yürüdükçe check-in), demo ışınlanma, söz bırakma,
      Mekânlarım (ortak mekânlar + seni bekleyen kilitli mekânlar), Mesajlar, Profil, TR/EN,
      PWA kabuğu.
- [x] **3. Google Maps entegrasyonu** — `GOOGLE_MAPS_API_KEY` tanımlıysa Google Maps JS API +
      `OverlayView` ile aynı konuşma balonları ve `InfoWindow` ile açılan büyük balon; anahtar
      yoksa, betik yüklenemezse ya da anahtar reddedilirse otomatik Leaflet/OSM. Ortak plan
      (`maps/common.js`), iki uyarlayıcı (`maps/leaflet.js`, `maps/google.js`), tek cephe (`map.js`).
      CSP, Google alan adlarına yalnızca anahtar varken izin verir.
- [x] **4. Uçtan uca tarayıcı testleri** — Playwright: iki kullanıcıyla söz → kilitli görme →
      mekâna gitme → açma → tepki → canlı mesajlaşma; Mekânlarım; dil değişimi; Google Maps
      uyarlayıcısı (test için küçük bir Google Maps taklidiyle), Google yüklenemezse Leaflet'e
      dönüş, CSP. `npm run test:e2e`.
- [x] **5. "Ben de duydum" tanıkları** — 👂 artık bir tanıklık iddiası: yalnızca söz söylendiği
      sırada (±2 saat) o mekânda check-in'i olan basabilir. Tanıklar balonda listelenir; söz
      sahibi ve tanıklar birbirine yazabilir. Konuşmalar iki kişi arasında söz başına tek
      (kim başlatırsa başlatsın); şema v2 göçü (mesajlar korunarak tablo yeniden kurulur).
- [x] **6. Anonim paylaşım** — Söz bırakırken "anonim" seçeneği; balonda ve konuşmalarda ad
      yerine "Anonim kulak". Sahibi konuşmada "Kimliğimi göster" ile adını açar (karşı tarafa
      canlı bildirim). Anonim yazar, kimliği açılmadan söz üzerinden engellenebilir. Şema v3.
- [x] **7. Keşif motivasyonu** — Haftalık keşif serisi, bu hafta açılan mekânlar, şehir başına
      keşif çubukları, 9 rozet (ilk adım, kâşif, haritacı, şehirlerarası, ilk söz, anlatıcı,
      tanık, bağlantı, seri). Rozet kazandıran eylemler (check-in, söz, 👂, mesaj) yanıtında
      `newBadges` döner, arayüz kutlar. Alt sayfa modal olmaktan çıktı: sekme çubuğu açık
      sayfanın altında kullanılabilir.
- [x] **8. Yakındaki sözler dürtmesi** — Haritada kalıcı kart: "4 kilitli söz seni bekliyor ·
      650 m · Moda Sahili" + yol tarifi; kapatılınca sıradaki mekân. Keşif modunda kilitli bir
      mekâna 300 m ve 100 m yaklaşınca "Sıcak!" ipucu.
- [x] **9. Moderasyon** — Sözlerde ve mekân adlarında telefon, e-posta, bağlantı, TR plakası ve
      @kişi maskesi; küfür ilk harfi kalacak biçimde maskelenir (leetspeak/uzatma dahil);
      nefret söylemi reddedilir (mesajlarda da). `OVERHEARD_ADMINS` ile moderatörler: şikâyet
      edilen/gizlenen sözleri görme, geri yükleme, silme, yazarı yasaklama (yasaklı okur ama
      yazamaz). Şema v4.
- [x] **10. Dağıtım** — Dockerfile (üretim ayarları, yetkisiz kullanıcı, kalıcı birim,
      HEALTHCHECK), Caddy ile otomatik HTTPS sunan docker-compose örneği, `/healthz`,
      `OVERHEARD_TRUST_PROXY` (hız sınırı gerçek istemci adresine göre), HTTPS'te HSTS,
      `npm run backup` (VACUUM INTO). README'de dağıtım rehberi.
- [x] **11. Konum sahteciliğine karşı** — 200 m'den belirsiz konum mekân açmaz; son güvenilir
      konuma göre 5 km'den uzun ve 1000 km/sa'ten hızlı sıçramalar "imkânsız seyahat" olarak
      işaretlenir (uçuşla mümkün yolculuklar geçer); 24 saatte 3 olaydan sonra 24 saat mekân
      açılmaz; saatte en fazla 30 yeni mekân. Söz bırakma da aynı denetimden geçer. Moderatör
      panelinde şüpheli hesaplar. Demo modunda (ışınlanma) varsayılan olarak kapalı. Şema v5.
- [x] **12. Ölçek** — Mekân söz sayıları SQL'de (liste sınırından bağımsız); şehir haritası en
      yeni 300 sözü getirir, yakın bakışta görünür alanın sözleri `/api/overheards?bbox=` ile
      ayrıca çekilip önbellekte birleştirilir (en fazla 1500); mesajlar 100'erli sayfalanır
      ("Önceki mesajlar").

## Sıradakiler

Yol haritasındaki adımlar tamamlandı; sıradaki işler kalite turlarıdır.

## Kural değişikliği (kullanıcı geri bildirimi)

- [x] **Yerel / herkese açık sözler.** "Bir kez git, sonsuza dek oku" kaldırıldı. Yerel sözler
      (varsayılan) yalnızca o mekânda şu an bulunanlara açık; ayrılınca ya da konum 30 dk
      güncellenmeyince yeniden kilitlenir. Herkese açık sözler herkese, her yerden açık. Söz
      bırakırken seçilir. Check-in yanıtı varış/ayrılış bildirir; arayüz bildirim gösterir ve
      haritayı yeniler. Uğranan mekânlar rozet ve keşif ilerlemesi için sayılmaya devam eder.
      Şema v6.

## Kalite turlarında yapılanlar

- Geniş ekran düzeni (bant, kart, sekme çubuğu ortalı), alt sayfada odak yönetimi.
- Misafir hesabını kalıcı hesaba çevirme (`/api/auth/upgrade`): ilerleme korunur.
- Konum izni verilmişse açılışta sessiz konum + check-in.
- İlk açılışta üç adımlık tanıtım (misafir olarak başla / giriş / önce haritaya bak).
- Kullanıcı başına en fazla 5 canlı bağlantı; süresi dolan oturumların temizliği.
- Dil anahtarları TR/EN eşit, ESLint temel kurallarla temiz; tarayıcı testlerindeki yarış durumları giderildi.

## Yayın öncesi ve büyüme (ikinci tur)

- [x] **13. KVKK/GDPR** — Kayıtta açık onay (18+, kullanım koşulları, gizlilik politikası; zamanı
      saklanır), misafirde bilgilendirme. "Verilerimi indir" (tüm kişisel veriler tek JSON) ve
      "Hesabımı sil" (parolayla; tüm veriler kademeli silinir). Kesin konum 24 saat, şüpheli konum
      kayıtları 90 gün saklanır (saatlik bakım). `privacy.html` ve `terms.html` taslakları. Şema v7.
      Keşif modu artık geçici konum hatasında kapanmıyor (yalnızca izin reddinde).
- [x] **14. "Şu an burada N kişi"** — Taze konum bildirimlerinden mekân başına isimsiz kişi sayısı;
      haritadaki mekân balonunda 👥, söz balonlarında (kilitli olanlarda da) ve Mekânlarım'da.
- [x] **15. Mekân odası** — O an aynı mekânda bulunanların grup sohbeti: yalnızca oradayken okunur
      ve yazılır, mesajlar 12 saat sonra silinir, kişisel veriler maskelenir, engellenenler
      görünmez, mesajlar o an oradakilere canlı (SSE) gider. Haritada oda düğmesi (yanında kişi
      sayısı), varış bildiriminde "Odaya gir", Mekânlarım'da giriş; ayrılınca oda kapanır. Şema v8.
- [x] **16. Paylaşılabilir kartlar** — Herkese açık sözden 1080×1920 hikâye görseli (konuşma balonu,
      yer, logo; yazar adı yok). Telefonda sistem paylaşım menüsü, masaüstünde indirme. Yerel
      sözlerde paylaş düğmesi yok.
- [x] **17. Haftanın en iyileri** — `/api/cities/:id/best`: son 7 günde en çok tepki alan herkese açık
      sözler (yereller hariç, girişsiz de görülür). Şehir şeridinin başındaki 🏆 ile açılır; her
      söz haritada açılabilir ve paylaşılabilir.
- [x] **18. 24 saatlik sözler** — Söz bırakırken "24 saat sonra kaybolsun"; süresi dolan söz
      haritadan, aramadan ve haftanın en iyilerinden kalkar, tepki/yeni konuşma alamaz. Üzerinden
      konuşma başlamışsa sohbet bağlamı için saklanır, başlamamışsa saatlik bakımda silinir. Şema v9.

## Üçüncü tur

- [x] **19. Mekân QR kodu** — Kapalı alanlar (kafe, kütüphane, kampüs) için mekân başına imzalı QR
      (HMAC; sır veritabanında kalıcı ya da `OVERHEARD_QR_SECRET`). Okutunca kaba konum yeter (3 km
      doğruluk, mekâna 1 km yakınlık); içeride konum oynasa da 2 saate kadar orada sayılırsın,
      uzaklaşınca ya da konum 30 dk eskiyince çıkarsın. Kişi sayısına, mekân odasına ve söz bırakmaya
      dahil. Moderatör panelinde mekân arama, QR önizleme, A5 poster (PNG) ve SVG indirme.
      Bağımlılıksız QR üreticisi (`server/qr.js`, sürüm 1–10), testlerde gerçek bir QR okuyucuyla
      doğrulanır. Şema v10.
- [x] **20. Bağlamı anlayan denetim** — `ANTHROPIC_API_KEY` varsa herkese açık metinler (söz, yeni
      mekân adı, mekân odası mesajı) yayımlanmadan önce Claude API'ye (resmî `@anthropic-ai/sdk`,
      isteğe bağlı bağımlılık) sorulur: kişiyi tanınır kılan ayrıntı, listede olmayan nefret söylemi,
      taciz, tehdit, müstehcenlik, reklam. Düşük düşünme çabası, JSON şemasına bağlı yanıt, sunucu
      taraflı yedek model, toplam süre sınırı; ret (`refusal`) yayımlanmaz, hata/zaman aşımı/hız
      sınırında kelime listesiyle yayımlanır. Yalnızca metin gider. Yazar kategoriye göre neden
      görür; moderatör panelinde sayaçlar. Testler sahte istemciyle; istek biçimi gerçek SDK ile
      yerel bir sahte sunucuya karşı doğrulandı.
- [x] **21. Mekânda tutunma (QR'sız kapalı alan)** — Her mekâna QR asmak pahalı; asıl ihtiyaç
      içeride zayıflayan GPS. Mekâna iyi bir konumla girince bir "çapa" saklanır; sonraki belirsiz
      konumlar çapayla çelişmedikçe (mekân dairesi + 100 m + belirsizlik, en fazla 1 km) 3 saate
      kadar orada sayılırsın. Açıkça dışarıda gösteren konum çapayı siler, belirsiz konumla geri
      girilmez; belirsiz konum yeni mekân açmaz. Uygulama açıkken bir mekândaysan konum 5 dk'da
      bir sessizce tazelenir. QR kayıtları da aynı tabloya taşındı (QR artık isteğe bağlı bir
      ek). Şema v11.
- [x] **22. Overheard Kafe** — Girişte "overheard istiyorum" diyen müşterinin masasını garson
      kafe panelinden açar; sistem rastgele söz seçip masa numarasıyla fiş yazıcısına gönderir, masa
      açık kaldıkça aralıklarla (varsayılan 15 dk, en fazla 4 fiş) yenisini basar; unutulan masa 6
      saatte kapanır. Modlar: kafede yazılanlar (en az 20 dk eski, rastgele masalara) ya da yakın
      çevreden (1,5 km içindeki herkese açık sözler; başka mekânın yerel sözü basılmaz). Gizlenen,
      şikâyet alan, süresi dolan ve yasaklı yazarın sözleri basılmaz; aynı masaya aynı söz iki kez
      gitmez. Fişte yazar yok, saat kaba; altında kafenin QR'ı. Yazıcı ekranı canlı (SSE) dinler,
      `--kiosk-printing` ile sessiz basar. Haritada ☕ işareti. Moderatör kafeyi ve personeli yönetir.
      Şema v12. Sakin semtler için genişleyen arama: yakında söz yoksa 5 km, 15 km, sonra şehrin
      geneli (kafe içi modda da kafenin kendi sözleri bitince yakın çevreye geçilir).

## Sakin semtler (dördüncü tur)

- [x] **23. OpenStreetMap aktarımı** — `npm run import:osm`: ilçe ilçe gündelik buluşma noktaları
      (istasyon, otogar, iskele, semt pazarı, AVM, meydan, park, halı saha, kampüs; alanlı olanlarda
      yarıçap gerçek büyüklükten) ve raylı sistem/metrobüs hatları. Hassas yerler (okul, hastane,
      ibadethane, karakol, cezaevi) alınmaz; var olan mekânla çakışan atlanır; tekrar çalıştırılabilir;
      `--dry-run`, `--from-file`. İstanbul pilot yarıçapı 80 km'ye çıktı (Silivri, Şile dahil).
- [x] **24. Toplu taşıma hatları** — Hat bir mekân (duraklar sırayla, şema v13). Durağa 150 m
      yakın iyi konum biniş; güzergâha 500 m (+belirsizlik) yakın kaldıkça 2 saate kadar hattasın,
      çelişen konum çıkarır. Hat sözleri güzergâh boyunca yerleşir, kişi sayısı ve hat odası var.
      Haritada güzergâh (Leaflet ve Google), kilitli hat sözünde en yakın durağa yol tarifi, biniş
      bildirimi. Hat kafe olamaz; istasyonun yanında yeni mekân açılabilir.
- [x] **25. Semtin ilk sözü** — Hiç sözün olmadığı yerde "Bu civarda henüz söz yok, ilkini sen bırak"
      kartı; bir mekânın ilk sözüne 🚩 Öncü rozeti ve bildirimi.
- [x] **26. Kafe sakin semtlerde** — Kafe içi söz bekleme süresi kafe başına (10–240 dk; herkesin
      birbirini tanıdığı semtlerde uzatmak için). Boş bölge kartı en yakın Overheard Kafe'yi gösterir.

## Bağlantısız yerler (beşinci tur)

- [x] **27. Çevrimdışı söz** — Bağlantı yokken (ya da tünelde konum alınamazken) söz cihazdaki kuyruğa
      (IndexedDB) yazılır; bağlantı gelince, uygulama açılınca ve arka planda eşitlemeyle gönderilir.
      Sunucu o sırada orada olunduğunu zamanında yapılmış giriş/biniş ya da cihazın o anki iyi
      konumuyla doğrular; söz yazıldığı anın saatiyle kaydedilir, en geç 6 saat, aynı söz bir kez.
      Bekleyenler çipi ve listesi; çevrimdışı açılışta son görülen harita (2 saatten eski yerel sözler
      kilitli). Şema v14.
- [x] **28. Kulaktan kulağa (eşten eşe)** — Çevrimdışı söz ekranda QR (L düzeyi, sürüm 1–40;
      QR üreticisi artık sunucu ve tarayıcıda ortak) ya da AirDrop/Quick Share ile yanındakine geçer;
      o internetsiz okur ve taşır, kim önce bağlanırsa sunucuya o ulaştırır. Yazarın cihaz anahtarı
      (ECDSA P-256, WebCrypto; özel anahtar dışa aktarılamaz) imzalar, sunucu doğrular; taşıyan
      değiştiremez, başkası adına söz uyduramaz. Uygulama içi kamera okuyucu (BarcodeDetector ya da
      jsQR); yazara "ulaştı" bildirimi.
- [x] **29. Android uygulaması ve yeraltı modu** — Flutter ile yerli Android uygulaması (`mobile/`):
      giriş, harita (hatlar, mekânlar, söz balonları; çevrimdışı son harita), check-in, söz bırakma.
      Yeraltı modu: Google Nearby Connections (P2P_CLUSTER) ile telefonlar internetsiz ve dokunmadan
      bağlanır; imzalı sözler (28'deki paket biçimi, Dart'ta ECDSA P-256 / RFC 6979) dedikodu
      protokolüyle telefondan telefona yayılır (en fazla 8 atlama, 6 saat; boşta kalan bağlantı
      bırakılır). Bağlantı bulan telefon sunucuya ulaştırır; sunucu kaç telefondan geçtiğini tutar
      (şema v15, `hops`), internetsiz sözler haritada 📡. Telefon cepteyken kalıcı bildirimli hizmet.
      Dart testleri gerçek Node sunucusuyla uçtan uca çalışır.
- [ ] **30. iPhone'da yeraltı modu** — `MeshLink` için Multipeer Connectivity (iPhone ↔ iPhone) ve
      BLE GATT (Android ↔ iPhone) bağlantı katmanı; iOS'ta arka plan Bluetooth kısıtları.
- [ ] **31. Gizli sözler (mini oyun)** — İnternetsiz yazılmış sözler (`offline`, `hops`) özel:
      yeraltında toplanan sözler "gizli söz" olarak açılır, kaç telefondan geçtiği oyunun parçası.

## Kalite turları (tüm adımlar bitince)

Erişilebilirlik denetimi, mobil Safari uyumluluğu, performans profili, hata mesajları, kopya
metinler, karanlık mod ince ayarları.
