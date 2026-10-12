# Influence — Klon Arenası

> Klonun, senin yerine aynı kararı verir mi?

Kullanıcı açık rızasını verir, verilerini yükler, yapay zeka klonu **telefonun içinde** eğitilir.
Klon, hiç görmediği sorularda sahibinin ne seçtiğini tahmin eder ve buna **senkron oranı** denir.
Sonra arkadaşlar klonlarını Arena'da kapıştırır.

Statik bir PWA. Derleme yok, sunucu yok. Telefonda aç ve **Ana ekrana ekle** de.

```bash
python3 -m http.server 8080      # depo kökünde
# telefonda / tarayıcıda: http://<bilgisayar-ip>:8080/influence/
```

> Yerel model (WebGPU) ve service worker için **HTTPS** gerekir (veya `localhost`).
> En kolayı GitHub Pages: `Settings → Pages`; adres `…github.io/<repo>/influence/` olur.

## Akış

| Adım | Ne olur |
|---|---|
| **Rıza** | KVKK aydınlatma metni ve açık rıza. Zorunlu kalemler: klon oluşturma, 18+. İsteğe bağlı kalemler: dosya işleme, kart paylaşımı. Rıza sürümü, metnin SHA-256 özeti ve zaman damgası kaydedilir. |
| **Kimlik** | Takma ad, hologram rengi, kısa tanıtım. Otomatik klon kodu atanır (`IN-4821`). |
| **Besle** | 40 ikilemlik karar testi. Her 4 sorudan biri (10 soru) **klondan gizlenir**. İstenirse WhatsApp dışa aktarımı, not, JSON, CSV de yüklenebilir. WhatsApp'ta yalnızca kullanıcının kendi mesajları tutulur, diğer kişilerinkiler hemen atılır. |
| **Senkron** | Klon, gizli 10 soruda sahibini tahmin eder. Çekirdek ve nöral motor için ayrı skor tutulur, kıyas noktası yazı-tura (%50). |
| **Arena** | 3 mod ve etki sıralaması (aşağıda). |

## Yerel yapay zeka: iki katman

1. **Çekirdek klon.** 8 eksenli kişilik DNA'sı üzerinde lojistik regresyon (risk, sosyallik,
   mantık/duygu, sabır, yenilik, sadakat, tutumluluk, rekabet). Milisaniyede eğitilir, her
   telefonda ve internetsiz çalışır. Gerekçesini en çok etkileyen eksenlerden kurar
   ("Ben risk alan ve yenilik arayan biriyim; o yüzden…").
2. **Nöral klon.** [WebLLM](https://github.com/mlc-ai/web-llm) ile WebGPU üzerinde telefonda
   çalışan küçük bir dil modeli. Model bir kez indirilir, sonra önbellekten açılır.
   Arayüz donmasın diye ayrı bir worker'da çalışır.
   - Gemma 3 1B (~0,7 GB) · **Qwen2.5 1.5B (~1,6 GB, varsayılan)** · Qwen3 1.7B (~2 GB)
   - İstem şunlardan kurulur: kimlik, kısa tanıtım, DNA, soruya en benzer 8 geçmiş karar,
     yüklenen mesajlardan BM25 ile bulunan 3 alıntı ve yazım tarzı özeti ("kısa yazar, sık 😂").
   - Alternatif olarak aynı ağdaki **Ollama / LM Studio** kullanılabilir (OpenAI uyumlu uç nokta).

**Hibrit** motor: çekirdek klon %75'in üzerinde eminse çekirdek karar verir, değilse karar LLM'e
bırakılır. LLM hata verirse veya biçimi bozarsa sistem çekirdeğe düşer, uygulama kırılmaz.

## Arena modları

- **🎯 Kim Seni Daha İyi Tanıyor?** Arkadaşın ve klonun, gizli 10 soruda senin ne seçtiğini
  tahmin eder. Hangisi daha çok tutturursa kazanır.
- **⚔️ Klon Düellosu.** İki klon 5 raund boyunca sahiplerinin gerçek cevaplarını tahmin eder.
  Herkesin sınav soruları aynı olduğundan iki klon aynı soruda yarışır. Eşitlik olursa
  doğru tahminlerdeki güven toplamına bakılır.
- **🌀 Aynı İkilem.** İki klon aynı soruya (rastgele ya da elle yazılmış) kendi ağızlarından cevap verir.
  Sonuçta karar uyumu (40 soru üzerinden), DNA benzerliği ve üst üste çizilmiş radar gösterilir.
- **Etki sıralaması.** Senkron×100 + 20×düello zaferi + 10×arkadaşını yenme.

**Klon kartı paylaşımı.** Kart bir bağlantı (`#klon=…`, yaklaşık 550 karakter) ya da `.influence.json`
dosyası olarak gönderilir; içinde takma ad, DNA, test seçimleri ve kısa tanıtım bulunur.
Ham dosyalar ve mesajlar karta **hiçbir zaman girmez**. Bağlantıyı açan kişi önce kendi rızasını verir,
sonra kartı kadrosuna ekler.

## Testler

```bash
npm test     # depo kökünde; Influence testleri dahil tüm paketleri koşar
```

`tests/influence.test.mjs` uygulamayı gerçek Chromium'da, mobil ekran boyutunda baştan sona dener:
rıza kapısı → 40 karar → klon → senkron (tutarlı bir kişide ≥%80) → WhatsApp yükleme
(başkasının mesajı tutulmuyor) → bağlantıyla gelen arkadaş klonu → düello → "kim tanıyor"
→ nöral motor (sahte LLM ile; istemde DNA, geçmiş kararlar ve alıntılar var mı, arkadaş klonuna
kendi dosyaların sızıyor mu) → yeniden açılışta kalıcılık → rıza geri çekilince her şeyin silinmesi.

**Test edilmeyen kısım:** gerçek WebLLM indirme ve GPU üzerinde çıkarım. Test ortamının CDN ve
Hugging Face erişimi kapalı. Bu yüzden ilk deneme gerçek bir telefonda yapılmalı.

## Dosyalar

```
js/dilemmas.js  40 ikilem + eksen vektörleri, sınav seti kuralı
js/clone.js     çekirdek model: eğitim, tahmin, gerekçe, DNA, uyum, serbest metin etiketleyici
js/llm.js       WebLLM / yerel sunucu, cevap çözümleyici   (llm-worker.js: WebGPU iş parçacığı)
js/decide.js    çekirdek / nöral / hibrit karar ve senkron testi, istem kurma
js/ingest.js    dosya çözümleme, WhatsApp, yazım tarzı, BM25 arama
js/consent.js   aydınlatma metni + açık rıza (TASLAK)
js/share.js     klon kartı: bağlantı / dosya, içe aktarma doğrulaması
js/arena.js     savaş modları ve sıralama
js/app.js       ekranlar ve kablolama
```

## Yayına almadan önce

- Rıza metni **taslaktır**. Bir KVKK avukatına okutulmalı, `[köşeli parantezli]` alanlar
  (veri sorumlusu, başvuru adresi) doldurulmalı.
- Veriler sunucuda saklanacaksa aydınlatma metnindeki "cihazda kalır" ifadeleri, aktarım ve
  saklama süresi bölümleri ile yurt dışı aktarım (KVKK md. 9) yeniden yazılmalı.
- Kart bağlantısı imzasız. Kötü niyetli biri sahte bir kart üretebilir; skorlar bu yüzden
  sunucu tarafında doğrulanana kadar "eğlencelik" sayılmalı.
