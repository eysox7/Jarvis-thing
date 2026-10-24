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
  okunur ("yeraltında duyulanlar"); rahatsız edici bulunan söz telefondan silinebilir.
- **Saha günlüğü** (Yeraltı sekmesinin altında): telefon bulundu, bağlandı, söz istendi/alındı,
  gönderilemedi, sunucuya ulaştı... İki telefonla denerken ne olduğunu gösterir.
- **Söz ayrıntısı**: tepkiler (😂 😮 ❤️, o sırada oradaysan 👂), yazana mesaj, şikâyet, yazarı engelleme.
- **Mesajlar**: sözler üzerinden başlayan konuşmalar, okunmamış rozeti, anonim sözün sahibi için
  "kimliğimi göster".
- **Profil**: sayılar, rozetler, kullanım koşulları ve gizlilik politikası, çıkış, **uygulama içinden
  hesap silme** (sunucudaki hesap ve telefondaki anahtar, yeraltı deposu, önbellekler).

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

İçerik denetimi: internetsiz sözler sunucuya varmadan okunduğu için sunucunun kuralları telefonda da
uygulanır (`lib/core/moderation.dart`, listeler sunucudan üretilir). Nefret söylemi içeren söz
yazılamaz; gelirse alınmaz, saklanmaz ve yayılmaz. Kişisel veri (telefon, e-posta, plaka, @kişi,
bağlantı) ve küfür imzalanmadan önce maskelenir, gelen sözlerde de maskeli gösterilir. Bir test,
Dart ve Node sürümlerinin aynı sonucu verdiğini denetler.

## Derleme

Gerekenler: Flutter 3.47+ (Dart 3.13), Android SDK (platform 36 ve 37, build-tools 36), JDK 17+.

```bash
cd overheard/mobile
flutter pub get
flutter analyze
flutter test                      # 28 test: birim, ekran, denetim eşliği ve gerçek sunucuyla uçtan uca (node gerekir)
flutter build apk --release --split-per-abi --target-platform android-arm64 \
  --dart-define=OVERHEARD_URL=https://overheard.ornek.com
```

- `OVERHEARD_URL` giriş ekranındaki sunucu adresinin varsayılanıdır (ekranda değiştirilebilir).
- Sürüm derlemesi yalnızca `https://` sunucuya bağlanır. Yerel ağdaki `http://` bir sunucuyla
  denemek için derlemeden önce `export ORG_GRADLE_PROJECT_overheardCleartext=true` (hata ayıklama
  derlemesinde zaten açık).
- `lib/l10n/web_strings.g.dart` (web uygulamasının metinleri) ve `lib/core/wordlists.g.dart`
  (sunucunun denetim listeleri) üretilir: `node tool/gen_shared.mjs`.

## Play Store'a hazırlık

1. Yükleme anahtarı oluştur (bir kez; dosyayı ve parolaları güvenli bir yerde sakla, depoya ekleme):
   ```bash
   keytool -genkeypair -v -keystore ~/overheard-upload.jks -storetype JKS -keyalg RSA -keysize 2048 \
     -validity 10000 -alias upload
   ```
2. `android/key.properties` (depoda yok sayılır):
   ```
   storeFile=/home/sen/overheard-upload.jks
   storePassword=...
   keyAlias=upload
   keyPassword=...
   ```
   Dosya varsa sürüm derlemesi bu anahtarla, yoksa hata ayıklama anahtarıyla (pilot) imzalanır.
3. Play Store `.aab` ister:
   `flutter build appbundle --release --dart-define=OVERHEARD_URL=https://overheard.ornek.com`
   → `build/app/outputs/bundle/release/app-release.aab`. Play App Signing'i aç (Google dağıtım
   anahtarını tutar, sen yükleme anahtarıyla imzalarsın).
4. Play Console beyanları:
   - **Ön plan hizmeti** (`connectedDevice`): "Telefon cepteyken yakındaki telefonlarla Bluetooth
     üzerinden internetsiz söz aktarımı (yeraltı modu); kullanıcı açar, kalıcı bildirim görünür."
     Kısa bir ekran kaydı istenir (yeraltı modunu açma → bildirim → başka telefona söz geçmesi).
   - **Konum**: yalnızca uygulama açıkken (check-in ve "o sırada oradaydım" kanıtı); arka plan
     konumu kullanılmaz.
   - **Kullanıcı içeriği (UGC)**: uygulama içi şikâyet, engelleme, moderasyon paneli, kullanım
     koşulları kabulü, nefret söylemi filtresi ve kişisel veri maskesi var.
   - **Hesap silme**: uygulama içinde (Profil → Hesabımı sil). Play uygulamasız silme için bir web
     adresi de ister: web uygulamasında da aynı seçenek var (sunucu adresi → Profil → Hesabımı sil).
   - **Veri güvenliği** formu: konum (yaklaşık/kesin, uygulama işlevi için), kullanıcı içeriği
     (sözler, mesajlar), hesap bilgisi (kullanıcı adı); üçüncü tarafla paylaşım yok; aktarım
     şifreli (https); silme isteği desteklenir.

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
