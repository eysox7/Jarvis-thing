# Overheard Android uygulaması (Flutter)

Overheard'ün yerli mobil uygulaması. Asıl farkı **yeraltı modu**: metroda internet yokken yazılan
söz Bluetooth/Wi-Fi ile yanındaki Overheard'lü telefonlara kendiliğinden geçer, içlerinden biri
sinyal bulunca sunucuya ulaşır. Sunucu aynıdır (`../server`); uygulama web uygulamasının API'sini
kullanır.

## Neler var

- **Giriş / hesap açma** (oturum, web'deki `oh_session` çerezi; şifreli depoda tutulur).
- **Harita**: şehir seçimi, hatlar (güzergâh çizgisi), mekânlar ve söz balonları. Kilitli (yerel)
  sözlerin metni sunucudan gelmez. Bağlantı yokken son görülen harita gösterilir.
- **Buradayım** (check-in): içinde olduğun mekânlar ve bindiğin hat; yerel sözler açılır.
- **Söz bırak**: bağlantı ve konum varsa söz doğrudan haritaya düşer. Yoksa söz cihaz anahtarıyla
  imzalanıp yeraltı ağına bırakılır.
- **Yeraltı modu**: telefonlar birbirini internetsiz ve dokunmadan bulur (Google Nearby Connections,
  `P2P_CLUSTER`), sözleri telefondan telefona yayar ve bağlantı bulan telefon sunucuya ulaştırır.
  Telefon cepteyken de sürsün diye kalıcı bildirimli ön plan hizmeti çalışır. Gelen sözler hemen
  okunur ("yeraltında duyulanlar").

## Yeraltı modu nasıl çalışır

1. Metroya binerken (durakta, bağlantı varken) **Buradayım**: sunucu seni hatta sayar. Bu, sonra
   yazacağın sözün "o sırada oradaydım" kanıtıdır (hatta 2 saat, mekânda 3 saat geçerli).
2. Tünelde söz yazarsın. Konum ya da bağlantı yoksa söz cihazın imza anahtarıyla (ECDSA P-256,
   SHA-256; özel anahtar telefondan çıkmaz) imzalanır: `"<veri>.<anahtar>.<imza>"`. Paket biçimi web
   uygulamasının kulaktan kulağa paketiyle aynıdır.
3. Yeraltı modu açık telefonlar bağlanınca ellerindeki sözlerin kimliklerini söyler, eksikleri
   ister ve alır (dedikodu protokolü, `lib/mesh/gossip.dart`). Yeni söz bağlı herkese hemen gider.
   Bir söz en fazla 8 telefondan geçer; 6 saatten eski söz kimseye sunulmaz. Kalabalıkta bağlantı
   yuvası sınırlı olduğundan, 30 saniye alışverişsiz kalan bağlantı bırakılır ve o telefona bir
   dakika yeniden bağlanılmaz; böylece sırayla herkese ulaşılır.
4. Bağlantı bulan telefon sözleri `POST /api/overheards/relay` ile gönderir (`hops`: kaç telefondan
   geçtiği). Sunucu imzayı yazarın kayıtlı anahtarıyla, "o sırada oradaydı"yı yazarın check-in'i ya
   da paketteki konumla doğrular. Taşıyan sözü değiştiremez, kimse başkası adına söz uyduramaz; aynı
   söz iki kez kaydedilmez.
5. Haritada internetsiz yazılmış sözler 📡 ile işaretlidir (ileride "gizli söz" oyununa dönüşecek;
   sunucu `offline` ve `hops` alanlarını tutar).

Gizlilik: telefonlar kullanıcı adı yerine her açılışta değişen rastgele bir ad duyurur. Taşınan
sözler yalnızca yanındakilerin zaten okuyacağı metinlerdir; anonim sözde yazar adı pakete girmez.

## Derleme

Gerekenler: Flutter 3.47+ (Dart 3.13), Android SDK (platform 36 ve 37, build-tools 36), JDK 17+.

```bash
cd overheard/mobile
flutter pub get
flutter analyze
flutter test                      # birim + ekran + gerçek sunucuyla uçtan uca (node gerekir)
flutter build apk --release --split-per-abi --target-platform android-arm64 \
  --dart-define=OVERHEARD_URL=https://overheard.ornek.com
```

- `OVERHEARD_URL` giriş ekranındaki sunucu adresinin varsayılanıdır (ekranda değiştirilebilir).
- Sürüm derlemesi yalnızca `https://` sunucuya bağlanır. Yerel ağdaki `http://` bir sunucuyla
  denemek için derlemeden önce `export ORG_GRADLE_PROJECT_overheardCleartext=true` (hata ayıklama
  derlemesinde zaten açık).
- Pilot derleme hata ayıklama anahtarıyla imzalanır; Play Store için kendi anahtarınla
  (`key.properties`) değiştir.
- `lib/l10n/server_strings.g.dart` web uygulamasının hata metinlerinden üretilir:
  `node tool/gen_server_strings.mjs`.

## İki telefonla deneme

1. Sunucuyu çalıştır (`cd overheard && npm start`; aynı Wi-Fi'deki telefonlar için bilgisayarın
   yerel IP'si, ör. `http://192.168.1.20:8787`) ya da yayındaki sunucuyu kullan.
2. APK'yı iki Android telefona kur, ikisinde ayrı hesap aç.
3. Telefon A: bir mekânda **Buradayım** (demo verisinde ör. Kadıköy İskelesi; demo modunda konum
   denetimleri gevşektir).
4. Telefon A'da uçak modunu aç, Bluetooth'u yeniden aç. **Söz bırak** → "yeraltı ağına bırakıldı".
5. İki telefonda **Yeraltı** sekmesinden modu aç (izinleri ver). Birkaç saniye içinde B'de söz
   "📡 1 telefondan geçti" olarak görünür.
6. B'nin bağlantısı varsa söz sunucuya ulaşır; A bağlanınca kendi kopyası "sunucuya ulaştı" olur.

## Sınırlar

- **Yalnızca Android.** Nearby Connections Google Play Hizmetleri ister (Huawei gibi GMS'siz
  telefonlarda çalışmaz). iPhone için bağlantı katmanı (`MeshLink`) Multipeer Connectivity ya da
  BLE GATT ile yazılmalı; Android ↔ iPhone arası yalnızca BLE ile mümkündür. Protokol ve paket
  biçimi platformdan bağımsızdır.
- Bluetooth aktarımı bu ortamda gerçek telefonlarda denenmedi; yayılma protokolü bellek içi ağla,
  imza ve sunucu uyumu gerçek sunucuyla test edildi.
- Uygulama kapatılınca (görev listesinden kaydırılınca) yeraltı modu durur.
