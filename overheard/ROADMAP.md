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

## Sıradakiler

- [ ] **3. Google Maps entegrasyonu** — `GOOGLE_MAPS_API_KEY` tanımlıysa Google Maps JS API +
      `OverlayView` ile aynı baloncuklar; yoksa Leaflet/OSM. Harita sağlayıcısını soyutla
      (`map.js` arayüzü korunur). Kilitli sözlerde "Yol tarifi" zaten Google Maps'e gider.
- [ ] **4. Uçtan uca tarayıcı testi** — Playwright ile iki kullanıcı: biri söz bırakır, diğeri
      kilitli görür, mekâna gidip açar, tepki verir, mesaj atar; mesaj SSE ile canlı düşer.
      `npm run test:e2e`.
- [ ] **5. "Ben de duydum" tanıkları** — Aynı sözü 👂 ile işaretleyen ve o sırada orada bulunan
      kişiler birbirini görür; tanıklar arasında da konuşma açılabilir.
- [ ] **6. Anonim paylaşım** — Söz bırakırken "anonim" seçeneği; balonda kullanıcı adı yerine
      "anonim kulak", mesajlaşmada kimlik söz sahibi isterse açılır.
- [ ] **7. Keşif motivasyonu** — Rozetler (ilk mekân, 5 mekân, 3 şehir…), haftalık keşif serisi,
      şehir keşif yüzdesi, profilde ilerleme çubuğu.
- [ ] **8. Yakındaki sözler dürtmesi** — "250 m ötede 4 kilitli söz var" kartı; keşif modunda
      yaklaştıkça ipucu.
- [ ] **9. Moderasyon** — TR/EN küfür/hakaret filtresi, telefon/e-posta/plaka gibi kişisel veri
      maskesi, yönetici uçları (gizlenen sözleri gözden geçirme).
- [ ] **10. Dağıtım** — Dockerfile, `/healthz`, üretim ayarları rehberi (HTTPS, güvenli çerez,
      ters vekil), yedekleme notları.
- [ ] **11. Konum sahteciliğine karşı** — İmkânsız seyahat (hız) denetimi, düşük doğruluklu
      konumları reddetme, şüpheli check-in işaretleme.
- [ ] **12. Ölçek** — Harita verisini görünür alana (bbox) göre çekme, sayfalama, indeksler.

## Kalite turları (tüm adımlar bitince)

Erişilebilirlik denetimi, mobil Safari uyumluluğu, performans profili, hata mesajları, kopya
metinler, karanlık mod ince ayarları.
