# overheard

> Duyduğunu bırak. Yalnızca orada bulunanlar okur.

Overheard, insanların sokakta, vapurda, kampüste, kafede **kulak misafiri oldukları sözleri**
haritaya bıraktığı bir uygulama. Her söz, duyulduğu mekânda bir konuşma balonu olarak durur.

Fark yaratan kural: **Ortak mekân (Mutual Place).** Bir sözü okuyabilmek için o mekânda bizzat
bulunmuş olman gerekir. Söz sahibi de oradaydı (paylaşmak için orada olmak şart), yani okuyabildiğin
her söz, yazanla aranızdaki bir ortak mekândan gelir. Haritanın geri kalanı kilitli balonlarla dolu:
okumak istiyorsan yürü, dışarı çık, oraya git.

Ve sonra o sözün sahibine yazabilirsin: "Ben de oradaydım, o masada mıydın?" Böylece uygulama hem
insanları yürümeye hem de tanışmaya teşvik eder.

## Neler var

- **Harita ve baloncuklar.** Yakından bakınca tek tek söz balonları, uzaktan bakınca mekân
  balonları. Bir balona dokununca büyük bir konuşma balonu olarak açılır. Çakışan balonlar
  küçük noktalara iner.
- **Kilitli sözler.** Gitmediğin mekânların sözleri bulanık, kilitli balonlardır. Metin sunucudan
  hiç gelmez (yalnızca uzunluğu), yani tarayıcıyı kurcalayarak da okunamaz. Balonda mekânın adı,
  ne kadar uzakta olduğun ve Google Maps'te **yürüyerek yol tarifi** vardır.
- **Check-in ve keşif modu.** "Konumum" düğmesi bulunduğun mekânlarda check-in yapar; keşif modu
  açıkken yürüdükçe otomatik check-in yapılır ve mekânların kilidi açılır.
- **Seni bekleyen sözler.** Haritanın altındaki kart en yakın kilitli mekânı ve orada kaç sözün
  beklediğini gösterir; keşif modunda yaklaştıkça "Sıcak!" ipuçları gelir.
- **Söz bırakma.** Yalnızca o mekândayken. Yakında kayıtlı mekân yoksa yeriyle birlikte yeni
  mekânı sen açarsın.
- **Aynı anda oradaydınız.** Söz bırakıldığında sen de oradaysan balonda "Sen de oradaydın!"
  rozeti çıkar. Ayrıca yazanla kaç ortak mekânınız olduğu görünür.
- **"Ben de duydum" tanıkları.** 👂 yalnızca söz söylendiği sırada orada olanlara açıktır;
  basanlar balonda tanık olarak listelenir. Söz sahibi ve tanıklar birbirine yazabilir: aynı anı
  paylaşan yabancılar arasında doğal bir tanışma.
- **Anonim paylaşım.** İstersen adın görünmez ("Anonim kulak"); biri sana yazarsa kimliğini o
  konuşmada açıp açmamak sana kalır.
- **Söz üzerinden mesajlaşma.** Her konuşma bir söze bağlıdır; sohbet başlığında sözün kendisi ve
  ortak mekânlarınız durur. Mesajlar canlı (Server-Sent Events) gelir.
- **Keşif motivasyonu.** Haftalık seri, şehir başına keşif yüzdesi ve rozetler (ilk adım, kâşif,
  haritacı, şehirlerarası, tanık, bağlantı…). Her yeni mekân bir adım daha.
- **Moderasyon.** Sözlerde telefon, e-posta, bağlantı, plaka ve @kişi otomatik gizlenir; küfür
  maskelenir, nefret söylemi reddedilir. Moderatör paneli: gizlenen sözleri gözden geçirme, geri
  yükleme, silme, yasaklama.
- **Güvenlik.** Şikâyet (eşikte otomatik gizleme), engelleme, hız sınırları, CSP, Origin denetimi,
  özetlenmiş oturum belirteçleri, scrypt ile parola. Yazanın gerçek konumu saklanmaz/gösterilmez;
  balonlar mekân dairesi içinde sabit ama rastgele bir noktada durur.
- **Türkçe / English**, karanlık mod, ana ekrana eklenebilir (PWA).

## Pilot şehirler

| Şehir | Neden |
| --- | --- |
| İstanbul | Vapur iskeleleri, Kadıköy–Moda, İstiklal, kampüsler: kulak misafirliğinin başkenti |
| Ankara | Kızılay, Tunalı, 7. Cadde, ODTÜ ve Bilkent kampüsleri |
| İzmir | Kordon, Kemeraltı, Alsancak, Bostanlı sahili |
| Austin, Texas | 6th Street, South Congress, UT kampüsü, Zilker: yürünebilir, sosyal, genç |
| New York | Konseptin doğduğu şehir: *Overheard in New York* (2003) |
| Los Angeles | Bugün en büyük "overheard" topluluklarından birine ev sahipliği yapıyor |

Her şehir için başlangıç mekânları `server/data/places.js` içinde. Yeni bir şehir eklemek için
`server/data/cities.js` ve `places.js` dosyalarına satır eklemek yeterli.

## Çalıştırma

Gereken tek şey **Node.js 22.13+** (yerleşik `node:sqlite` kullanılır; çalışma zamanı bağımlılığı yok).

```bash
cd overheard
npm start            # http://localhost:8787
npm test             # API testleri
npm run test:e2e     # tarayıcıda uçtan uca testler (Playwright + Chromium)
```

### Google Maps

`GOOGLE_MAPS_API_KEY` verilirse harita Google Maps JavaScript API ile çizilir: balonlar
`OverlayView` ile aynı görünümde, açılan balon `InfoWindow` içinde. Anahtar yoksa, betik
yüklenemezse ya da Google anahtarı reddederse uygulama kendiliğinden OpenStreetMap'e (Leaflet)
döner. Kilitli sözlerdeki "Yol tarifi" her iki durumda da Google Maps yürüyüş rotasını açar.

Anahtar tarayıcıya gider (Maps JS anahtarları doğası gereği herkese açıktır). Google Cloud
konsolunda anahtarı **HTTP yönlendiren** kısıtıyla yalnızca kendi alan adınıza ve yalnızca
*Maps JavaScript API*'ye kısıtlayın.

```bash
GOOGLE_MAPS_API_KEY=AIza... OVERHEARD_DEMO=0 npm start
```

Ortam değişkenleri:

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `PORT` | `8787` | |
| `OVERHEARD_DB` | `data/overheard.db` | SQLite dosyası |
| `OVERHEARD_DEMO` | `1` | Demo modu: örnek sözler, misafir hesabı, haritaya uzun basınca ışınlanma. Üretimde `0`. |
| `OVERHEARD_SECURE_COOKIES` | `0` | HTTPS arkasında `1` yap |
| `GOOGLE_MAPS_API_KEY` | — | Tanımlıysa harita Google Maps ile çizilir (yoksa OpenStreetMap) |
| `OVERHEARD_ADMINS` | — | Moderasyon paneline erişecek kullanıcı adları, virgülle (`ayse,mert`) |

### Demo modunda deneme

1. Uygulamayı aç, **Profil → Giriş yap → Hesapsız dene (misafir)**.
2. Haritada yakınlaş: balonların çoğu 🔒 kilitli.
3. Bir kilitli balona dokun → **Buraya ışınlan** (ya da haritada bir yere uzun bas / sağ tıkla).
4. Mekânın kilidi açılır, sözler okunur hâle gelir. Tepki ver, **Mesaj at**.
5. Ortadaki **“ Duydum** düğmesiyle kendi sözünü bırak.

## Dağıtım

**Docker + otomatik HTTPS (Caddy):**

```bash
cd overheard
OVERHEARD_DOMAIN=overheard.example.com \
OVERHEARD_ADMINS=ayse \
GOOGLE_MAPS_API_KEY=AIza... \
docker compose up -d
```

İmaj üretim ayarlarıyla gelir: demo kapalı (`OVERHEARD_DEMO=0`), güvenli çerez + HSTS açık,
veritabanı `/data` biriminde, uygulama yetkisiz `node` kullanıcısıyla çalışır, `/healthz`
sağlık denetimi tanımlı. Compose dosyası Caddy'yi önüne koyar ve `OVERHEARD_TRUST_PROXY=1`
ile hız sınırları gerçek istemci adresine göre işler.

**Docker olmadan:** Node.js 22.13+ olan bir sunucuda
`OVERHEARD_DEMO=0 OVERHEARD_SECURE_COOKIES=1 OVERHEARD_TRUST_PROXY=1 npm start`, önüne HTTPS
sonlandıran bir ters vekil (Caddy/nginx). Konum API'si tarayıcıda yalnızca HTTPS'te çalışır.

**Yedekleme:** `npm run backup [klasör]` çalışan veritabanının tutarlı bir kopyasını alır
(SQLite `VACUUM INTO`). Konteynerde: `docker compose exec app node server/backup.js /data/backups`.
Bunu günlük bir zamanlayıcıya bağlayıp yedekleri sunucu dışına kopyalayın.

| Ek değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `OVERHEARD_TRUST_PROXY` | `0` | Ters vekil arkasında `1`: istemci adresi `X-Forwarded-For`'un son öğesi |
| `OVERHEARD_RATE_SCALE` | `1` | Hız sınırı çarpanı |
| `OVERHEARD_ANTI_SPOOF` | demo kapalıysa `1` | Konum sahteciliği denetimleri |

## Mimari

```
overheard/
  server/
    index.js        giriş noktası (HTTP sunucusu)
    backup.js       tutarlı veritabanı yedeği (VACUUM INTO)
    app.js          istek işleyici: statik dosyalar, güvenlik başlıkları, API yönlendirme
    api.js          API uçları
    domain.js       kurallar: ortak mekân, check-in, sözler, mesajlaşma
    db.js           SQLite şeması ve göçler (PRAGMA user_version)
    auth.js         scrypt parolalar, oturumlar
    moderation.js   kişisel veri ve küfür maskesi, nefret söylemi reddi
    events.js       Server-Sent Events (canlı mesaj)
    geo.js          mesafe, sınır kutusu, balon yerleşimi
    data/           pilot şehirler, mekânlar, demo sözleri
  public/           derleme adımı olmayan mobil web uygulaması (ES modülleri)
    js/map.js       harita cephesi: Google Maps ya da Leaflet seçer, gerekirse geri döner
    js/maps/        ortak balon planı + Leaflet ve Google Maps uyarlayıcıları
  test/             node:test ile API testleri, test/e2e/ altında Playwright senaryoları
```

### Görünürlük kuralı

```
okuyabilir(kullanıcı, söz) = kullanıcı sözün sahibi
                           ∨ kullanıcının söz.mekân'da en az bir check-in'i var
```

Kilitli sözler istemciye `{ locked: true, length }` olarak gider; metin, yazar ve tepki
ayrıntıları gönderilmez. Tepki vermek, şikâyet etmek ve mesaj atmak da aynı kurala tabidir.

### API özeti

| Uç | Açıklama |
| --- | --- |
| `GET /api/config` | Pilot şehirler, sınırlar, demo modu |
| `POST /api/auth/register` · `login` · `guest` · `logout` | Hesap |
| `GET /api/me` | Kullanıcı, istatistikler, okunmamış mesaj sayısı |
| `GET /api/cities/:id/map` | Şehrin mekânları ve sözleri (görüntüleyene göre kilitli/açık) |
| `POST /api/checkins` | `{lat, lng, accuracy}` → bulunduğun mekânlar, yeni açılanlar |
| `GET /api/me/places` | Kilidini açtığın mekânlar |
| `POST /api/overheards` | `{text, lat, lng, placeId? , newPlaceName?}` |
| `GET/DELETE /api/overheards/:id` | |
| `POST /api/overheards/:id/reactions` · `report` | `kind: same` yalnızca o sırada orada olanlara |
| `POST /api/overheards/:id/messages` | `{body, to?}`: sahibine ya da (`to`) bir tanığa yazar |
| `GET /api/conversations` · `GET /api/conversations/:id` · `POST …/messages` | |
| `POST /api/conversations/:id/reveal` | Anonim söz sahibi kimliğini açar |
| `POST /api/overheards/:id/block-author` · `POST /api/users/:handle/block` | Engelleme |
| `GET /api/admin/reports` · `POST …/overheards/:id/restore` · `DELETE …/overheards/:id` · `POST …/users/:handle/ban` | Moderasyon (yalnızca `OVERHEARD_ADMINS`) |
| `GET /api/events` | SSE akışı (`dm`, `reveal` olayları) |

## Konum güvenilirliği

Tarayıcıdan gelen konum kriptografik olarak doğrulanamaz. Üretimde (`OVERHEARD_DEMO=0`) şu
denetimler açıktır (`OVERHEARD_ANTI_SPOOF` ile değiştirilebilir):

- 200 m'den belirsiz konum mekân açmaz.
- Son güvenilir konuma göre 5 km'den uzun ve 1000 km/sa'ten hızlı sıçrama "imkânsız seyahat"
  sayılır ve işaretlenir (uçakla mümkün yolculuklar geçer).
- 24 saatte 3 şüpheli olaydan sonra check-in'ler 24 saat mekân açmaz.
- Saatte en fazla 30 yeni mekân açılabilir.
- Şüpheli hesaplar moderatör panelinde listelenir.

## Bilinen sınırlar

- Yukarıdaki denetimler kaba sahteciliği frenler ama kararlı bir kullanıcıyı (yavaş yavaş sahte
  konumla "yürüyen") durduramaz. Kesin çözüm için yerli uygulama + cihaz doğrulaması (App Attest /
  Play Integrity) ya da ortak mekânlarda QR/BLE işaretçileri gerekir.
- Hız sınırları ve canlı bağlantılar tek süreç içindedir; yatay ölçeklemede paylaşılan bir depo
  (ör. Redis) gerekir.
- Harita karoları CARTO/OpenStreetMap'ten gelir; yoğun kullanımda kendi karo sunucunuz ya da
  ücretli bir sağlayıcı gerekir.

Yol haritası ve sıradaki adımlar: [ROADMAP.md](ROADMAP.md).
