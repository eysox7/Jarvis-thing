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

## Sıradakiler

- [ ] **11. Konum sahteciliğine karşı** — İmkânsız seyahat (hız) denetimi, düşük doğruluklu
      konumları reddetme, şüpheli check-in işaretleme.
- [ ] **12. Ölçek** — Harita verisini görünür alana (bbox) göre çekme, sayfalama, indeksler.

## Kalite turları (tüm adımlar bitince)

Erişilebilirlik denetimi, mobil Safari uyumluluğu, performans profili, hata mesajları, kopya
metinler, karanlık mod ince ayarları.
