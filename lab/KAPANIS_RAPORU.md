# Otonom oturum kapanış raporu

**Oturum:** 2026-10-15, 16:40 → 19:42 UTC (3 saat, 10 dakikada bir uyanış, 18 uyanış)
**Dal:** `ccr-d833b36c-mcm2st`
**Ayrıntılı günlük:** [`lab/crowd-sim/SESSION_LOG.md`](crowd-sim/SESSION_LOG.md)

## İstenen

AlphaGo / AlphaZero mantığını MatrAIx ile birleştirip, insanların kararlarını (pazarlama, siyasi /
kamu politikası kararları) simüle eden bir **sistem ve arayüz**. Test dosyası yazılmaması istendi.

## Teslim edilen: Karar Laboratuvarı — [`lab/decision-lab/`](decision-lab/)

Tarayıcıda çalışan, kurulumsuz bir uygulama. N.E.X.U.S. → Ayarlar → Laboratuvar'dan açılır.

| Sekme | Ne yapar |
|---|---|
| Senaryo | 4 şablon (araç giriş ücreti, emeklilik reformu, fitness uygulaması, elektrikli otomobil) ya da form ile kendi senaryon; açık hedef fonksiyonu |
| Nüfus | Pakette 80 gerçek MatrAIx personası, kendi MatrAIx dosyaların ya da sentetik nüfus; segmentler |
| Tahmin | Kararları seç → segment bazında tepki, zaman serisi, "neden?" tablosu |
| Strateji | AlphaZero (MCTS + policy/value ağı + self-play) tasarım + zamanlama planı; "Neden bu plan?"; sağlamlık testi; Markdown rapor |
| Doğrulama | LLM personalarına sor (N.E.X.U.S. API bağlantılarıyla), özetlet, modeli kalibre et; MatrAIx anket görevi üret ve sonuçlarını oku |

### Sonuçlar (arayüzde, kısa eğitimle, 14. uyanış)

| Senaryo | Nüfus | Başlangıç | En iyi statik | AlphaZero | Sağlamlık |
|---|---|---|---|---|---|
| Araç giriş ücreti | sentetik 300 | 0.446 | 0.575 | 0.671 | %100 |
| Fitness uygulaması | MatrAIx 80 | 0.326 | 0.457 | 0.648 | %100 |
| Emeklilik reformu | MatrAIx 80 | 0.488 | 0.588 | 0.636 | %85 |
| Elektrikli otomobil | sentetik 300 | 0.122 | 0.448 | 0.608 | %100 |

### Yol boyunca bulunan ve düzeltilen önemli şeyler

1. **AlphaZero "yem-ve-değiştir" buldu:** düşük ücretle desteği topla, son ay ücreti üç katına çıkar.
   Etkinlik dönem ortalaması yapıldı. (Simülasyonla öğrenen sistemlerin temel riski.)
2. **AlphaZero sık sık statik en iyinin altında kalıyordu** (fitness 0.362 < 0.451). En iyi statik
   tasarımdan başlatıldı → tüm ayar/tohumlarda statiği geçiyor.
3. **Sağlamlık testi** eklendi: kısa eğitimli bir planın yalnızca %33 dünyada iyi olduğunu ortaya çıkardı.
4. **Gerçek MatrAIx verisi** sandığımdan seyrekti (1052 boyut); eşleme tablosu genişletildi
   (persona başına kural 2.0 → 5.25), "null" değerler tek segmentte.
5. Kalibrasyon segment sırasına bağlıydı (nüfus değişince yanlış gruba uygulanırdı) → segment adına göre.
6. Düşünen modeller (Gemini 2.5 vb.) için LLM cevap sınırı 200 → 2048 token.

### Bilinçli kapsam sınırı

Siyasi tarafta sistem **politikanın tasarımını** ve tepkileri tahmin eder; hedef fonksiyonu en düşük
segmenti ve kutuplaşmayı da ölçer. Psikolojik özelliklere göre bölünmüş seçmen gruplarına ayrı ikna
mesajı optimize eden bir eylem türü **yoktur** (kitlesel manipülasyon aracına dönüşür).

## Ne doğrulandı, ne doğrulanmadı

**Doğrulandı (headless Chromium, scratchpad'deki betiklerle; repoya test eklenmedi):**
- Tüm sekmeler, 4 şablon × 2 nüfus türü uçtan uca, konsol hatası yok; mobil (360 px) yatay taşma yok.
- LLM akışı **sahte** bir API yanıtıyla (persona sorma, özetleme, kalibrasyon).
- MatrAIx görev betiği geçerli YAML/JSON üretiyor (Python ile ayrıştırıldı).
- Ana uygulamanın mevcut testleri: hepsi geçti.

**Doğrulanmadı (bu ortamda mümkün değildi):**
- Gerçek bir LLM ile persona cevapları ve özet kalitesi (API anahtarı yok).
- Üretilen anket görevinin **MatrAIx içinde** koşması (`persona_strategy.json` biçimi örnekten kopyalandı).
- Rapor dosyasının gerçek tarayıcıdaki indirme adı (test tarayıcısı "download" gösterdi).

## Senin yapman gerekenler

1. **Açmak:** GitHub Pages yayınındaysa `<site>/lab/decision-lab/`; yerelde repo kökünde
   `python3 -m http.server 8080` → `http://localhost:8080/lab/decision-lab/`.
2. **LLM doğrulaması:** N.E.X.U.S. → API sekmesinde bir bağlantı (ücretsiz Gemini veya Groq) ekle →
   Doğrulama → Sor → Özetle → Kalibre et → Strateji'yi yeniden çalıştır.
3. **MatrAIx ölçümü:** Doğrulama → "Anket görevini indir" → MatrAIx-Persona-8B kökünde `bash <dosya>.sh`
   → job'u koş → sonuç klasörünü Doğrulama'ya yükle.
4. **Dal:** Değişiklikler `ccr-d833b36c-mcm2st` dalında; PR açılmadı (istenmedi).

## Diğer

- `lab/crowd-sim/`: oturumun ilk saatindeki kalabalık tahliye deneyi (sonra yön değişti). Olduğu gibi
  duruyor; istersen silinebilir.
- `lab/core/`: iki deneyin ortak AlphaZero çekirdeği (`nn.js`, `mcts.js`, `rng.js`).
- Kota: oturum boyunca bir kota/limit hatası görülmedi; 18 uyanışın hepsi çalıştı.
