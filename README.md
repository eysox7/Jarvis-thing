# N.E.X.U.S.

**N**eural **EX**ecution & **U**tility **S**ystem — telefon için kişisel yapay zeka asistanı.

Tek bir statik web uygulaması. Kurulum yok, derleme (build) adımı yok, sunucu yok.
Tarayıcıda açılır, ana ekrana eklenince yerli uygulama gibi çalışır.

> Tasarım önceliği: **işlevsellik**. Süs yok, iş var.

---

## Ne yapar

- **Görevleri yönetir.** "Yarın 15:00'te fatura öde görevi ekle, önceliği yüksek olsun"
  dediğinde görevi açar, tarihini çözer, listeye yazar.
- **Ne yapacağını önce açıklar.** Her turda bir *plan* üretir; sohbette "🧭 Planım"
  kartı olarak görürsün. Sonra araçları çalıştırır, her aracın girdisi ve çıktısı
  açılır kart hâlinde önünde durur. Kara kutu yok.
- **Riskli işlerde izin ister.** Silme, konum alma, dış siteye istek atma, paylaşma
  gibi araçlar onay penceresi açar (Ayarlar'dan kapatılabilir).
- **Her API servisine bağlanır.** Gemini, Groq, OpenAI, Anthropic, OpenRouter,
  Mistral, DeepSeek, xAI, Together, Cerebras, Fireworks, Perplexity, NVIDIA NIM,
  Ollama, LM Studio ve OpenAI-uyumlu **her** özel endpoint.
- **Yedekli çalışır.** Bağlantıları sıraya dizersin; ilki hata verirse (kota doldu,
  anahtar bozuk, servis çöktü) otomatik olarak bir alttakine geçer.
- **Tamamen sesle kullanılır.** Eller serbest modda telefona hiç dokunmazsın: adını
  söyle, isteğini söyle, cevabı dinle. Onay pencereleri de sesle cevaplanır.
- **İnsanların kararlarını tahmin eder.** Seçimde kime oy verecekleri (katılım ve geçerli oy
  payları dahil), hangi ürünü alacakları, gündelik bir kararda ne yapacakları. Kuram-temelli
  bir rastgele fayda modeli kurumun verisinden öğrenir, doğruluğunu görülmemiş veride ölçer ve
  raporlar. Ayrıntı: [Karar tahmini](#karar-tahmini).
- **Kitle tepkisini tahmin eder.** Bir duyurunun, kampanyanın ya da haberin kime ulaşacağını,
  nasıl okunacağını ve tutumu nasıl değiştireceğini; MatrAIx tarzı sentetik persona nüfusu
  üzerinde ana akım **ve** eleştirel iletişim kuramlarıyla birlikte simüle eder. Kurum kendi
  profilini ve geçmiş verisini girerek modeli kendine kalibre eder. Ayrıntı: [Kitle tahmini](#kitle-tahmini).
- **Çevrimdışı açılır.** Service worker sayesinde uygulama kabuğu önbellekte;
  görevlerin ve notların internetsiz de elinin altında (yalnızca model çağrısı ağ ister).

## Kurulum

Hiçbir bağımlılığı yok. Üç seçenek:

**1. Telefonda doğrudan (en kolay)**
Depoyu GitHub Pages'te yayınla: `Settings → Pages → Branch: main → /(root)`.
Çıkan adresi telefonda aç → tarayıcı menüsü → **Ana ekrana ekle**.

**2. Yerelde**
```bash
python3 -m http.server 8080
# tarayıcıda: http://localhost:8080
```

**3. Herhangi bir statik host**
Netlify, Vercel, Cloudflare Pages: dosyaları at, yeter. Build komutu yok.

> HTTPS gerekir: mikrofon, bildirim ve service worker yalnızca güvenli bağlamda
> (veya `localhost`'ta) çalışır.

## İlk çalıştırma

1. **API** sekmesi → **+ Bağlantı ekle**
2. Sağlayıcıyı seç (ücretsiz başlamak için **Google Gemini** veya **Groq**), anahtarını yapıştır
3. **↻ Modelleri çek** → listeden model seç → **⚡ Bağlantıyı test et** → **Kaydet**
4. Sohbete dön ve yaz.

Birden fazla bağlantı ekleyip **▲ ▼** ile sıraya diz: üstteki asıl, altındakiler yedek.

### Ücretsiz anahtar alınabilecek yerler

| Sağlayıcı | Adres |
|---|---|
| Google Gemini | https://aistudio.google.com/apikey |
| Groq | https://console.groq.com/keys |
| OpenRouter | https://openrouter.ai/keys |

## Sadece sesle kullanım (eller serbest)

Sohbet ekranındaki **🎧** düğmesine bir kez bas — sonrası tamamen sesle:

```
sen:    Nexus
nexus:  Efendim?
sen:    yarın öğlen anneme çiçek göndermeyi göreve ekle
nexus:  (planını söyler, görevi ekler)  Tamamdır, yarın 12:00 için ekledim.
        ↑ ardından kendiliğinden yeniden dinlemeye döner
```

Tek cümlede de olur: *"Nexus, yarın öğlen anneme çiçek göndermeyi göreve ekle."*

**Riskli işlerde onay da sesle.** Silme, konum alma gibi bir araç çalışmadan önce
sorar: *"geolocate aracını çalıştırayım mı? Evet mi, hayır mı?"* — "evet"/"hayır"
dersin, yeter. Anlamazsa bir kez daha sorar, yine anlamazsa ekrana bırakır.
Asistan bir bilgi eksik bulursa (`ask_user`) onu da sesli sorar; seçenek sunduysa
"İzmir olsun" gibi serbest konuşman en yakın seçeneğe eşlenir.

### Sesli kontrol komutları

Bunlar modele gitmez, anında çalışır:

| Dersen | Olur |
|---|---|
| `dur` / `sus` / `kes` | Konuşmayı ve çalışan işi durdurur |
| `tekrarla` / `ne dedin` | Son cevabı yeniden okur |
| `yeni sohbet` | Geçmişi temizler |
| `ne yapabilirsin` | Yeteneklerini sayar |
| `uyu` / `dinlemeyi kapat` | Eller serbest modu kapatır |

### Ayarlar (Ayarlar → Sesle kontrol)

- **Uyandırma kelimesi** — varsayılan `nexus`. Ses tanıma bunu sık yanlış duyduğu için
  yakın okunuşlar (`neksüs`, `neksus`…) da kabul edilir. İstediğin kelimeyi yazabilirsin.
- **Uyandırma kelimesi iste** — kapatırsan her söylediğin doğrudan komut olur (sessiz
  ortamda pratik, kalabalıkta değil).
- **Konuşurken de dinle** — sözünü kesebilmen için. Varsayılan kapalı: açıkken hoparlörden
  çıkan kendi sesini komut sanabilir.
- **Açılışta eller serbest başlat** — açtığında uygulama hazır bekler; tarayıcılar mikrofonu
  ancak bir dokunuştan sonra açtığı için ekrana bir kez dokunman istenir (bu tarayıcı
  kuralı, aşılamıyor).

Mod açıkken ekran kilidi (`wakeLock`) alınır, telefon uyumaz. Cevap okunurken mikrofon
kısa süre duraklatılır ki kendi sesini dinlemesin.

## Araçlar

Model bu araçları kendi kararıyla çağırır. `[onay]` işaretliler izin ister.

| Alan | Araçlar |
|---|---|
| Görevler | `task_add`, `task_list`, `task_update`, `task_delete` `[onay]` |
| Notlar | `note_add`, `note_search`, `note_delete` `[onay]` |
| Kalıcı hafıza | `memory_remember`, `memory_forget`, `memory_list` |
| Zaman | `get_datetime`, `reminder_set`, `reminder_list`, `reminder_cancel` |
| Hesap | `calculate` (kendi güvenli çözümleyicisi — `eval` yok) |
| Web | `web_search`, `http_fetch` `[onay]`, `open_url` `[onay]` |
| Cihaz | `device_info`, `geolocate` `[onay]`, `clipboard_write`, `share` `[onay]`, `notify`, `speak`, `vibrate` |
| Etkileşim | `ask_user` — bilgi eksikse uydurmaz, sorar |
| Karar tahmini | `decision_predict`, `decision_person`, `decision_whatif`, `decision_scenario_save`, `decision_data_import`, `decision_learn`, `decision_calibrate_shares`, `decision_polls`, `decision_ensemble`, `decision_catalog` |
| Kitle tahmini | `audience_predict`, `audience_compare`, `audience_optimize`, `audience_survey`, `audience_extract`, `audience_calibrate`, `audience_catalog`, `institution_save`, `institution_delete` `[onay]` |

Yeni araç eklemek: `js/tools.js` içinde bir `def({name, desc, params, run})` bloğu.
Sistem mesajındaki katalog otomatik güncellenir, başka hiçbir yere dokunmak gerekmez.

## Karar tahmini

**⚖️ Karar** sekmesinden ya da sohbetten ("bu anketle kim kazanır?", "fiyatı 18 bine çekersek
pazar payımız ne olur?", "otomatik katılımda kaç kişi sistemde kalır?") kullanılır.

```
 seçenekler + bağlam ─┐
 persona nüfusu ──────┼─► kuram terimleri z_k(persona, seçenek) ─► U = ASC + Σ θ_k z_k (+ demografi, + sınıf)
 kampanya (kitle) ────┘                                                  │  P = softmax(U)   (çok terimli logit)
                                                                         ▼
 kurumun verisi (CSV) ─► MAP öğrenme (öncül = kuram) ─► k-katlı doğrulama: isabet · log-kayıp · Brier · ECE
 anketler ─► birleştirme (n, tazelik, kuruluş yanlılığı) ─► pay kalibrasyonu
 önceki seçim / pazar payı ─► geçmiş davranış ataması (sadakat, geçiş)
 LLM persona (silikon örneklem) ─► topluluk ağırlıkları (doğrulamada log-kayıpla)
```

### Model

Rastgele fayda kuramı (McFadden): kişi i seçenek j'den `U_ij = ASC_j + Σ θ_k z_k + ε` fayda alır,
`P_ij = exp(V_ij)/Σ exp(V_il)`. Her `z_k` bir kuramdan gelir ve personaya göre değişir:

| Alan | Kuram terimleri |
|---|---|
| Siyaset | mekânsal yakınlık (Downs), yönsel oy (Rabinowitz–Macdonald), parti kimliği (Michigan), geriye dönük ekonomik oy (Fiorina), sistem güveni (Easton), iktidar yorgunluğu (Paldam), lider valensi (Stokes), stratejik oy (Duverger), katılmama (Riker–Ordeshook); konu önemi bağlamı |
| Ticaret | log-fiyat × gelir, referans fiyat / kayıp kaçınma (Kahneman–Tversky, Thaler), indirim belirginliği, taksit (likidite kısıtı), kalite, marka (sezgisel işleme), sosyal kanıt (Cialdini), etnosentrizm, sürdürülebilirlik, statüko (Samuelson–Zeckhauser), dijital erişim (TAM), satın almama |
| Gündelik | beklenen fayda, maliyet, risk kaçınma, şimdiki zaman yanlılığı (Laibson), sosyal norm ve algılanan kontrol (Ajzen), varsayılan etkisi (Johnson–Goldstein), alışkanlık, kayıp çerçevesi (Tversky–Kahneman), kıtlık (Cialdini), sıfır fiyat etkisi (Shampanier–Mazar–Ariely), otoriteye güven |
| Hepsi | **iletişim kuramları** (aşağıda), geçmiş davranış / sadakat (durum bağımlılığı), ek kampanya etkisi |

Nüfus tahmininin yanında **tek kişi** tahmini de yapılır (`decision_person`): betimlenen kişinin
seçim olasılıkları, kararını en çok hangi kuramların belirlediği ve hangi bilgilerin eksik olduğu.

### İletişim kuramları: modelin ana ayağı (iletişim merceği)

Seçmen partileri, ekonomiyi ve tehdidi doğrudan görmez; onları iletişim ekolojisi üzerinden görür:
izlediği kanallar, konuştuğu insanlar, ait olduğu kurumlar ve kendi dolaysız deneyimi (Lippmann'ın
"kafamızdaki resimler"i). Bu yüzden iletişim kuramları yanda koşan bir araç değil, **her kuram teriminin
geçtiği mercektir** (`js/decision/lens.js`):

```
 kişinin iletişim ekolojisi ─► mercek ─┬─► GİRDİ:   gündem → eksen ağırlıkları (yakınlık, yönsel oy)
 (kanal × saat, ilgi, ağ,              │            medya diyeti → maruziyet (kanal yanlılığı × azalan getirili saat)
  kurumlar, deneyim)                   └─► AĞIRLIK: z'_k = z_k + (g_k − 1)·z_k   (mekanizma başına öğrenilen θ')
```

| Mekanizma | Kuram | Neyi değiştirir |
|---|---|---|
| Gündem belirleme + konu sahipliği | McCombs & Shaw; Petrocik; Vavreck (açıklayıcı/isyancı kampanya) | iktidar medyası ekonomi iyiyken ekonomiyi, kötüyken kültür/güvenliği öne çıkarır; muhalif medya tersini |
| Yönelim ihtiyacı | Weaver | gündem etkisi ilgisi yüksek, bağlılığı zayıf kişide güçlü |
| Dolaysız konular | Zucker | iş kaybı, borç, terör, zorunlu göç medya olmadan da gündemi belirler |
| Öncelikleme | Iyengar & Kinder | öne çıkan eksen iktidarı değerlendirme ölçütü olur (ekonomik oy, otoriter dinamik, kimlik terimleri) |
| ELM | Petty & Cacioppo | ayrıntılandırma olasılığı düşük kişi çevresel ipuçlarına (yanlı medya, araç, çoğunluk) açık |
| Pekiştirme / çapraz baskı | Klapper; Stroud; Mutz | kendi partisinin medyası parti kimliğini güçlendirir, karşıt medya zayıflatır |
| Kodlama / kodaçımlama + hegemonya | Hall; Gramsci | egemen koddaki medyayı marjinal ve egemen ideolojiden uzak izleyici karşıt okur → bumerang |
| Ekme | Gerbner | ağır TV izleyicisinde güvenlik gündemi ve otoriter tepki |
| İki aşamalı akış | Lazarsfeld; Katz | ilgisiz seçmen siyaseti çevresinden alır → tartışma ağının ağırlığı artar |
| Suskunluk sarmalı | Noelle-Neumann | topluluğa gömülü, yalıtılmaktan korkan kişi iklime uyar; ayrıca anket düzeltmesi |
| Sorumluluk atfı | Iyengar | afet sonrası iktidarı cezalandırma bilgi ister |

Her mekanizmanın kişiler arası farkı ayrı bir terimdir (`mercek_<terim>`); öncülü kuramın öngördüğü
tam etkidir, veri onu büyütür, küçültür ya da sıfırlar. Böylece model her iletişim mekanizmasının bu
veride ne kadar işlediğini **ölçer** (`decision_learn` çıktısında katsayı ± hata). `baglam.mercek: 0`
merceği kapatır. Kitle motorunun 20 kuramı ayrıca her seçeneğin kamusal mesajını aynı personalar üzerinde
koşturur (maruziyet, tutum, Hall okuma konumu terimleri); seçenek `iletisim` alanıyla kendi mesajını tanımlayabilir.

**Ne kadar katkı veriyor? (dürüst sonuç)** Mercek açık / kapalı:

| Veri | 5 katlı CV | Hiç bireysel veri yok (yalnız kuram) | Seçimler arası aktarım |
|---|---|---|---|
| ANES 2016 tam / yapısal (partizan medya var) | 70,7 = 70,7 / 65,0 → 64,9 | 63,3 → **63,8** / 57,3 → **57,5** | tam 2016→2020: 80,1 → **80,5**; yapısal 69,3 → **69,6** |
| ANES 2020 tam / yapısal (partizan medya var) | 81,6 = 81,6 / 73,7 → 73,8 | 73,9 → 73,8 / 68,8 → 68,7 | 2020→2016: ±0,1 |
| Sentetik hane (kanal × saat, ilgi, ağ) | 85,6 → 85,4 | 75,8 → 75,1 (log-kayıp 0,713 → 0,710) | 2018→2023: 76,3 → 76,4 |
| Sentetik TR | 82,4 → **82,6** | — | — |

Mercek tahmin gücünü belirgin artırmıyor (±0,5 puan): bol veride kişi değişkenlerinin sabitleri farkı
zaten emiyor; veri yokken ANES 2016'da küçük kazanç, 2020'de küçük kayıp; ANES'te 2016'dan 2020'ye
aktarımda küçük ama tutarlı kazanç (+0,3 / +0,4). Öğrenilen mekanizma
katsayılarının çoğu belirsiz; sentetik hanede ekonomi gündemi/öncelikleme 0,69 ± 0,53, ANES 2020'de
1,09 ± 0,79 ile öncül yönünde. Değeri yorumdadır: hangi mekanizmanın kimde işlediği ayrı ayrı görülür.
**Reddedilen bir sınama:** ELM'yi "ilgili seçmen mesele yakınlığına, ilgisiz seçmen lider imajına bakar"
diye kurmak ANES'te tahmini kötüleştirdi (veri yokken 2020'de 73,9 → 73,0); lider değerlendirmesi ilgili
seçmende de güçlü bir özet yargıdır (Lau & Redlawsk). ELM bu yüzden yalnız ikna direnci olarak kaldı.

### Doğruluk nereden gelir

1. **Veriden öğrenme (asıl kaynak).** `decision_learn` kurumun bireysel verisinden MAP tahmini
   yapar: kuram katsayıları *öncül* (veri azken kurama yaslanır, çoğaldıkça veri konuşur), seçeneğe
   özgü demografik etkiler sıkı öncülle. Düzenlileştirme sıkılığı iç içe doğrulamayla veriden seçilir.
   Her terim için öğrenilen katsayı, std. hata ve "veri kuramı destekliyor / ters yönde" yorumu verilir.
2. **Görülmemiş veride ölçüm.** k-katlı çapraz doğrulama (panelde kişi düzeyinde katlar) isabet,
   log-kayıp, Brier ve kalibrasyon hatasını; yalnız-kuram ve çoğunluk temel modelleriyle kıyaslı raporlar.
   Tahmin her zaman bu doğrulama bilgisiyle birlikte döner.
3. **Geçmiş davranış.** `onceki` sütunu (önceki oy / marka) en güçlü yordayıcıdır; model sadakati ve
   seçenekler arası geçişi öğrenir. Nüfus tahmininde `baglam.onceki_paylar` personalara tutarlı atanır.
4. **Satıra özgü seçenekler.** Conjoint / satış verisinde `fiyat_A`, `var_A` gibi sütunlar her
   gözlemde farklı fiyat ve bulunurluğu taşır — fiyat esnekliği ancak böyle tanımlanabilir.
5. **Gizli sınıflar.** Panel verisinde (`kisi` sütunu, kişi başı birden çok seçim) EM ile tercih tipleri
   (ör. fiyat avcıları / marka tutkunları) öğrenilir; sınıf sayısı doğrulamayla seçilir.
6. **Nüfusa taşıma.** Model demografiye koşullu olduğundan yanlı örneklemden (ör. çevrimiçi anket)
   nüfus tahmini persona nüfusu üzerinden yapılır (MRP mantığı); raking ve Kish etkin örneklem de verilir.
7. **Anket birleştirme ve pay kalibrasyonu.** Bireysel veri yoksa anketler `decision_polls` ile
   birleştirilir (√n × tazelik, kuruluş yanlılığı, %95 hata payı) ve senaryo bu paylara kalibre edilir.
8. **Tahmin aralıkları.** Öğrenilmiş modelde parametre belirsizliği (Laplace yaklaşımı, kuram
   katsayıları ve seçenek sabitleri) nüfus paylarına %90 aralık olarak taşınır; anketle kalibre
   senaryoda anket hata payı kullanılır. Demografik etkilerin belirsizliği dahil değildir — aralıklar
   bu yüzden bir miktar dar olabilir. Kuram öncülüyle yapılan tahminde aralık üretilmez.
9. **Topluluk.** `decision_ensemble` kuram, öğrenilmiş model ve dil modeline personaları canlandırtan
   silikon örneklemi doğrulama satırlarında karşılaştırıp log-kaybı en aza indiren ağırlıkları öğrenir.

### Eleştirel okullar modelin içinde

Ana akım kuramların yanında eleştirel okullar da faydaya terim olarak girer (ayrıntı ve kanıtlar:
[docs/elestirel_okullar.md](docs/elestirel_okullar.md)):

- **Frankfurt Okulu** — otoriter dinamik (Adorno; Fromm; Stenner: yatkınlık × tehdit), kültür
  endüstrisi ve reklam/teşhir maruziyeti (Horkheimer & Adorno; Marcuse), otoriteye uyum
- **Habermas** — müzakereci akıl; **Herman & Chomsky / Smythe** — medya sahipliği ve yanlılığı;
  **Hall / Gramsci** — egemen kod = iktidar bloğu; **McLuhan / Innis** — araç mesajdır
- **Chicago okulu** — Thomas teoremi (kişinin beyan ettiği konum ve algı demografik tahminin yerine
  geçer), Becker (zamanın fırsat maliyeti, işletme maliyeti, akılcı bağımlılık), Stigler (arama
  maliyeti), Thaler (varsayılan), Mead/Blumer (sembolik etkileşim — kitle motorunda)
- **Crenshaw / Gramsci** — marjinal kimlik ve karşı-hegemonya (kesişimsellik)
- **Bourdieu / Veblen / Baudrillard** — kültürel sermaye, gösterişçi tüketim; **Beck** — risk
  toplumu; **feminist** — kuşaksal cinsiyet açığı, bakım yükü
- Bilinçli olarak eklenmeyen: "yoksul statükoyu destekler" (sistemi meşrulaştırma) — büyük
  örneklem testlerinde tutmadı (Brandt 2013).

Kuramın kapsamadığı ölçülmüş özellikler `spec.serbest = {özellik: ölçek}` ile serbest doğrusal terim
olarak eklenir; bütünleşik model böylece kuramsız standart modeli kapsar.

### Sosyal bağlam: karar yalnız bireysel değildir

İnsan oyunu ve tercihini ailesinin, konuştuğu çevrenin ve yaşadığı topluluğun içinde verir (Columbia
okulu: Lazarsfeld, Berelson & Gaudet; Huckfeldt & Sprague; Zuckerman; Chicago: Park). Model bunu iki
düzeyde taşır:

- **Kişi düzeyi (veri varsa):** `aile` (eşin/ebeveynin/hanenin tercihi), `ag` (siyaset konuşulan
  çevrede seçeneklerin payı), `topluluk` (il/bölge sonucu; kırsal, yaşlı, dindar — topluluğa gömülü —
  kişide daha güçlü). Katsayılar veriden öğrenilir.
- **Nüfus düzeyi (tahminde):** sentetik nüfus hanelere (eğitim/yaş/dindarlık/ideoloji homogamisi),
  homofili tartışma ağlarına (kanaat önderleri daha çok bağlı — iki aşamalı akış) ve topluluklara
  örülür. Bir kampanya ya da ne-olur değişikliğinin bireysel etkisi bu bağlar üzerinden yayılır;
  sonuçta `sosyal_yayilim.sosyal_carpan` (tipik ×1,2–1,5; ANES 2000'den öğrenilen aile/ağ katsayılarıyla bir kampanyada doğrudan +4,2 puan → toplam +6,1, ×1,45; kazanç sınırı kaçak dengeyi önler) ve doğrudan/toplam paylar raporlanır.
  Müdahale yokken tahmin değişmez: bireysel model çevrenin bileşimini zaten taşır. Kesitsel
  katsayıların ancak bir kısmı nedenseldir (homofili; Aral vd. 2009) — `baglam.sosyal_nedensellik`
  (varsayılan 0,4); `baglam.sosyal_yayilim: false` kapatır.

ANES 2016'da her seçmenin eyaletinin gerçek sonucu topluluk bağlamı olarak verildiğinde (yapısal
model): 5 katlı CV 64,9 (kuramsız standart 65,2); hiç bireysel eğitim verisi yokken 43,1 →
**50,8**; 100 kişiyle öğrenmede **62,3** (standart 58,9), 800 kişide 63,7 (standart 64,0).

**Gerçek ağ verisiyle sınama — ANES 2000** (`fetch_anes.py` → `ANES2000*`). 2000 anketinde her
seçmene siyaseti konuştuğu en çok dört kişi, bu kişinin eşi/akrabası olup olmadığı ve seçimde kime oy
verdiği sorulmuş (Huckfeldt & Sprague geleneği). 1.534 seçmenin 401'inde eşin, 1.007'sinde tartışma
ağının oyu biliniyor; eyaletin gerçek 2000 sonucu topluluk bağlamıdır (`tests/data/real/eyalet_2000.csv`).
Standart model aynı bilgiyi düz kategorik sütun olarak görür (adil kıyas):

| ANES 2000, 5 katlı CV | Standart | Bütünleşik | Log-kayıp (std / büt) |
|---|---|---|---|
| Yapısal, ağ bilgisi yok | 61,7 | 61,7 | 0,933 / 0,929 |
| Yapısal + eşin ve ağın oyu | **68,2** | 68,0 | 0,836 / **0,817** |
| Tam (parti kimliği + termometre), ağ yok | 72,1 | **72,9** | 0,711 / **0,693** |
| Tam + eşin ve ağın oyu | 73,9 | **74,8** | 0,674 / **0,649** |
| Öğrenme eğrisi, yapısal + ağ: 50 / 200 / 800 kişi | 35,7 / 63,4 / **66,7** | **62,1 / 65,5** / 66,0 | — |

- Aile ve çevre bilgisi bireysel özelliklerin ötesinde gerçek bilgi taşıyor: yapısal modelde +6,5, parti
  kimliği varken bile +1,9 puan ve log-kayıpta belirgin düşüş. Bu bilgiyi kuramlı ve kuramsız model bol
  veride eşit kullanıyor (68,0 / 68,2); kuramın farkı az veride (50 kişi: 62,1 / 35,7; 200 kişi: 65,5 / 63,4)
  ve olasılık kalitesinde (log-kayıp).
- Gerçek veriden öğrenilen katsayılar öncüllerle aynı yönde: `aile` 1,35 ± 0,30, `ag` 0,99 ± 0,22 (öncül
  1,5; iletişim merceği açıkken, ağın bir kısmı iki aşamalı akış terimine geçer). Hiç eğitim verisi yokken
  (yalnız kuram + seçimin toplam sonucu) aile ve ağ bilgisi isabeti 54,8'den **59,1**'e çıkarıyor.
- Topluluk (eyalet sonucu) 2000'de katkı vermedi (veri yokken 54,6 / 54,8). 2016'da aynı bağlam veri
  yokken +7,5 puandı. Olası açıklama: eyaletlerin partizan ayrışması 2000'den sonra derinleşti; eyalet
  ayrıca kaba bir birim, mahalle düzeyi veri gerekir.
- **Düzeltme (oturum 7):** önceki sürümde ablasyonda çıkarılan terimler tahmin anında kuram öncülüyle
  geri giriyordu (`estimate.js`). Kuramsız modele öğrenilmemiş aile/ağ terimleri eklenmiş ve onu
  bozmuştu; "yapısal + ağ: 65,4 / 67,3" ve "bütünleşik modelin farkı eş teriminden" sonuçları bu hatadan
  geliyordu ve geri çekildi. Yukarıdaki sayılar düzeltilmiş kıyastır.
- Sınır: kişinin "yakınım kime oy verdi" algısı kendi oyunu yansıtabilir (projeksiyon) ve bağların bir
  kısmı homofilidir; bu yüzden tahmin gücü nedensel etkinin üst sınırı sayılmalı.

### Zengin sentetik seçmenler: hayat öyküsü, travma, aile, çevre (`tests/data/sentetik/`)

Kuramların işleyebilmesi için kişinin yalnız demografisi değil hayat öyküsü de gerekir. `node
tests/data/sentetik_uret.mjs` 3.000 Türkiye seçmeni üretir: doğum yeri ve ailesi (SES, dindarlık,
etnik köken, inanç, babanın partisi), çocukluk travmaları (yoksulluk, ev içi şiddet, ebeveyn kaybı,
sert ceza, 90'larda zorunlu göç, çatışma, şehit yakını), iç göç, eğitim, iş, borç, iş kaybı, 1999/2023
depremleri, eşi (homogami), tartışma ağı, mahallesi ve medya diyeti — ve her biri için Türkçe bir hayat
öyküsü metni. Üretim nedensel bir zincirdir ve karar modelinin fayda denklemini **kullanmaz** (gizli kişisel
eğilim, ölçüm hatası, etkileşimler); dağılımlar kamu istatistiklerinin genel düzeyine kalibredir
(ayrıntı: [tests/data/sentetik/README.md](tests/data/sentetik/README.md)).

Öykü sütunları modele kuram terimi olarak girer: tehdit beyanı Stenner'in otoriter dinamiğini etkinleştirir;
iş kaybı/borç hane algısına (Fromm, Fiorina); zorunlu göç ve çatışma maruziyeti `kolektif_travma`
(Gurr; Alexander; Balcells); çocukluk travması `yabancilasma` (katılmama; Seeman); depremde kayıp
`afet_cezasi` (Healy & Malhotra); eşin ve ebeveynin oyu `aile` terimine. Öykü metni modele değil dil
modeline (silikon betimi) gider.

| Sentetik TR, 5 katlı CV (3.000 kişi) | Çoğunluk | Kuramsız standart | Bütünleşik |
|---|---|---|---|
| Yalnız sıradan anket (demografi, değerler, algılar) | 43,2 | 68,8 | 68,8 |
| + hayat öyküsü, aile, ağ, mahalle | 43,2 | 74,5 | **80,1** (log-kayıp 0,547 / standart 0,698) |
| + önceki oy (2018 dalgası) | 43,2 | 80,3 | **82,6** (log-kayıp 0,497 / 0,564) |
| Öğrenme eğrisi, + önceki oy: 50 / 200 / 800 kişi | 42 / 44 / 43 | 42,3 / 73,7 / 79,4 | **78,4 / 81,0 / 81,2** |
| Hiç bireysel veri yok (yalnız kuram) | 43,2 | — | **68,8** |

Hayat öyküsü bilgisi isabeti 6–11 puan artırıyor; bu bilgiyle kuramlar kuramsız modeli 2–6 puan, az
veride çok daha fazla geçiyor. Sosyal terimler çıkarılınca her veri miktarında −2/−5 puan; eleştirel
terimler çıkarılınca fark yok ya da hafif artış (düzeltilmiş kıyasta eleştirel terimlerin bu veride
katkısı görülmüyor).

### Aileleriyle sentetik seçmenler: hane temelli yaşam seyri (`tests/data/sentetik/hane/`)

`node tests/data/hayat_uret.mjs` gerçek demografik oranlardan (TÜİK ADNKS, eğitim ve evlenme
istatistikleri, TNSA doğurganlık ve akraba evliliği, TAYA, hayat tabloları, RTÜK) **1.300 hane ve
2.880 seçmen** üretir. Aile soyut bir sütun değildir: hanedeki eş, evde yaşayan yetişkin çocuk ve dul
kalmış yaşlı ebeveyn ayrı seçmenlerdir; birbirlerinin oyunu gerçekten etkilerler. Her kişinin anne-babası
(adları, kendi kuşaklarının eğitimi, meslekleri, babanın oyu o dönemin partileriyle), kardeşleri
(annenin kuşağının doğurganlığı; Almanya'ya işçi giden abi, köyde kalan abla, bebekken ölen kardeşler),
köyden kente göçü, okulu, askerliği, evliliği (görücü usulü, akraba evliliği), çocukları, iş hayatı,
yaşadığı tarihsel olaylar (12 Eylül, 90'larda köy boşaltmaları, 1999 ve 2023 depremleri, 2001 krizi, Gezi,
15 Temmuz, KHK, pandemi), konutu, sağlığı, gündelik rutini, kaygıları ve **iletişim ekolojisi** vardır:
TV kanalı ve saati, sosyal medya kaynağı ve saati, aile WhatsApp grubu, cami/cemevi, kahvehane, adı
konmuş tartışma ağı ve kanaat önderi. Öyküler ortalama ~1.700 karakterdir. Oy, 2015–2023 arası yıl yıl
işleyen ajan tabanlı bir iletişim süreciyle oluşur (medya dozu, karşıt içerikte geri tepme, hanede eş
zamanlı etkileşim); karar modelinin denklemi kullanılmaz. Kalibrasyon ve kaynaklar:
[tests/data/sentetik/hane/README.md](tests/data/sentetik/hane/README.md).

> *Örnek (kısaltılmış):* İsmail Çetin, 1953'te Kayseri'de doğdu; Alevi bir ailenin 6 çocuğundan biri.
> Babası Yaşar işçi, yıllarca CHP'ye, Ecevit'in "ak günlere" sloganına inanarak oy verdi; 1975'te öldü.
> Abisi Recep 1966'da işçi olarak Viyana'ya gitti, orada kaldı; iki kardeşi bebekken öldü, köyde doktor
> yoktu. 1969'da İstanbul'a göç etti, Sultanbeyli'ye yerleşti. 1974'te amcasının kızı Meryem ile evlendi.
> Haberleri Halk TV'den izliyor; cemevindeki cemlere katılır, kahvehanede oturur; kafası karışınca cemevindeki
> dede Kazım'a danışır. Kirada oturuyor, kira iki katına çıktı; KOAH hastası; en çok beklenen İstanbul
> depreminden kaygılanıyor.

| Sentetik hane, 5 katlı CV (2.880 kişi) | Çoğunluk | Kuramsız standart | Bütünleşik |
|---|---|---|---|
| Sıradan anket + iletişim ekolojisi (aile/ağ/önceki oy ve hayat olayları yok) | 42,3 | 65,8 | **66,8** |
| + aile (eşin, babanın oyu), ağ, mahalle, hayat olayları | 42,3 | 75,9 | **82,0** (log-kayıp 0,515 / 0,634) |
| + önceki oy (2018) | 42,3 | 83,2 | **85,4** (log-kayıp 0,407 / 0,485) |
| Öğrenme eğrisi, tam: 50 / 200 / 800 kişi | 42 / 42 / 43 | 37,6 / 76,5 / 81,8 | **81,0 / 84,0 / 85,1** |
| Hiç bireysel veri yok (yalnız kuram) | 42,3 | — | **67,8** |

Hanede aynı oy %61 (rastgele çift %29); eşle aynı oy (algılanan) %67, tartışma ağının çoğunluğuyla
%63 (ANES 2000: %76 / %59). Eleştirel terimler çıkarılınca bu veride fark yok ya da hafif artış. Sosyal terimler çıkarılınca her veri miktarında −2/−5 puan.

**Panel: aynı kişiler, iki seçim (`--secimler-tr`).** Aynı 3.000 kişi 2018 koşullarında da oy verir:
ekonomik zarar daha az (döviz krizi seçimden sonra), 2023 depremi yok, 2015–17 sonrası güvenlik gündemi
ağır, sığınmacı gündemi zayıf. 2018 dağılımı 45,4 / 20,4 / 8,6 / 10,5 / 15,1; iki seçimde aynı oy %79.
Bir seçimde öğrenip ötekini tahmin etmek (eş/ağ/mahalle ve önceki oy hariç):

| Aktarım | Standart | Bütünleşik | Eleştirel terimler çıkarılınca | Toplam paya kalibre (std / büt) |
|---|---|---|---|---|
| 2018'de öğren → 2023 | **71,8** (ll 0,759) | 71,3 (ll 0,766) | 71,3 | **73,4** / 72,9 |
| 2023'te öğren → 2018 | 72,5 (ll 0,724) | **72,6** (ll 0,730) | 73,0 | **73,5** / 73,1 |
| Hane verisi: 2018 → 2023 | 76,1 (ll 0,667) | **76,4** (ll **0,657**) | 76,2 | **78,0** / 77,8 |
| Hane verisi: 2023 → 2018 | **73,5** (ll 0,727) | 72,8 (ll 0,748) | 72,9 | **74,8** / 73,8 |

Düzeltilmiş kıyasta sentetik panelde seçimler arası aktarımda kuram avantajı **yok**: önceki sürümün
"71,7 / 70,1 ve 72,4 / 67,6" farkı, kuramsız modele tahmin anında öğrenilmemiş iletişim terimlerinin
eklenmesinden (yukarıdaki hata) geliyordu ve geri çekildi. Aynı nedenle "üç yeni terim deprem kaybı
yaşayanlarda aktarımı 68,5 → 70,7 iyileştiriyor" sonucu düzeltildi: üç terim (`kolektif_travma`,
`yabancilasma`, `afet_cezasi`) çıkarılınca deprem kaybı yaşayan seçmenlerde 2018→2023 isabeti 71,7 → 70,7
(92 kişi) ama hane verisinde ters yönde 66,7 → 67,5 (123 kişi): etki tutarsız, kanıt sayılmaz.
Gerçek ANES'te yapısal aktarım avantajı (aşağıda) düzeltmeden sonra da sürüyor.
Hane satırları, mercek terimlerinin öncülünü yanlışlıkla sıfırlayan ikinci bir hata düzeltildikten sonra yeniden ölçüldü (fark ±0,5).
Not: üretim zinciri ekonomik oy, afet cezası gibi mekanizmaları içerir; model denklemi kullanılmasa da
bu bir "dünya böyle işliyorsa model yakalar mı" sınamasıdır, gerçek panelde tekrarlanmalı.

### Gerçek Türkiye seçmeni (CSES 2015 ve 2018)

Model artık Türkiye'de gerçek seçmenlerle de sınanıyor: CSES (Comparative Study of Electoral Systems)
Türkiye Kasım 2015 (942 kişi) ve 2018 (929 kişi) anketleri — oy ya da katılmama, yaş, cinsiyet, eğitim,
gelir, ibadet sıklığı, sol-sağ, ekonomi algısı, demokrasiden memnuniyet, evde konuşulan dil (Kürtçe),
yerleşim; 2018'de siyasete ilgi. Topluluk bağlamı NUTS-1 bölgesinin **gerçek** seçim sonucudur (YSK il
sonuçları, `turkeyelections` paketi, MIT). Veri ücretsiz ama açık yeniden dağıtım izni olmadığı için repoya
konmaz: `python3 tests/data/fetch_cses_tr.py` indirir, `python3 tests/data/fetch_tr_il.py` il sonuçlarını
üretir, `node tests/tr_gercek.mjs` sınar. Seçenekler o seçimin bloklarıdır: 2015'te iktidar AK Parti ve MHP
milliyetçi muhalefet; 2018'de iktidar Cumhur İttifakı, milliyetçi muhalefet İYİ Parti.

| Gerçek Türkiye | Çoğunluk | Kuramsız standart | Bütünleşik |
|---|---|---|---|
| 2018, 5 katlı CV, parti yakınlığıyla | 57,4 | **85,5** | 83,7 (log-kayıp **0,496** / 0,516) |
| 2018, 5 katlı CV, yapısal (parti yakınlığı yok) | 57,4 | 76,2 | **76,4** (log-kayıp **0,644** / 0,694) |
| 2015, 5 katlı CV, yapısal | 40,8 | **71,0** | 70,7 (log-kayıp **0,823** / 0,853) |
| Az veri, 2018 yapısal: 50 / 100 / 400 kişi | 57 | 57,4 / 69,9 / **76,0** | **75,0 / 74,3** / 75,6 |
| Az veri, 2015 yapısal: 50 / 100 / 400 kişi | 35–41 | 35,1 / 64,4 / 70,0 | **65,0 / 68,2 / 70,1** |
| Hiç bireysel veri yok (kuram + gerçek toplam sonuç), 2018 / 2015 yapısal | 57,4 / 40,8 | — | **73,3 / 60,1** |
| Seçimler arası, yapısal: 2015'te öğren → 2018 | 57,4 | **76,7** (ll 0,746) | 75,9 (ll **0,703**) |
| Seçimler arası, yapısal: 2018 → 2015 | 40,8 | 66,0 | **68,5** |
| Seçimler arası, parti yakınlığıyla, toplam paya kalibre: 2018 → 2015 | 40,8 | 75,6 | **81,2** |

ABD'deki tablo Türkiye'de de çıkıyor: bol veride isabet başa baş (olasılık kalitesinde kuram önde), az veride
ve hiç veri yokken kuram belirgin önde. Medya değişkeni olmadığı için iletişim merceği burada etkisiz.

**Sentetik aileleri gerçek seçmene kalibre etmek** (`node tests/data/hane_kalibre.mjs`). Kalibrasyonsuz sentetik
hane nüfusunda öğrenip gerçek 2018 seçmenini tahmin etmek, hiç veri kullanmadan kuramla tahmin etmekten
kötüydü — sentetik ailelerin oy örüntüsü gerçeğe uymuyordu. Hane üreticisinin birkaç çarpanı, CSES 2018'in
**yalnız A yarısının** toplam çapraz tablolarına (oy | dindarlık, etnik köken, eğitim, ideoloji, yerleşim,
cinsiyet) göre ayarlandı; B yarısına dokunulmadı:

| Gerçek 2018 seçmenini tahmin | A'ya kalibre → B'de sına (462) | B'ye kalibre → A'da sına (467) |
|---|---|---|
| Yalnız kuram (hiç veri yok) | 72,5 (ll 0,827) | 73,2 (ll 0,809) |
| Kalibrasyonsuz sentetik ailelerde öğrenilmiş | 69,9 (ll 0,860) | 69,6 (ll 0,899) |
| **Kalibre sentetik ailelerde öğrenilmiş** (`tests/data/sentetik/hane_kal/`) | **75,8** (ll **0,747**) | 73,2 (ll 0,800) |
| **+ gerçek il sonuçlarına kalibre coğrafya** (`tests/data/sentetik/hane_kal_il/`) | **76,4** (ll 0,724) | **73,9** (ll 0,773) |
| Diğer gerçek yarıda öğrenilmiş — üst sınır | 76,4 (ll 0,705) | 73,9 (ll 0,714) |

Kalibrasyon iki bölünmede de aynı çarpanları seçti ve sentetik veriyi iki yönde de düzeltti (~70 → 73–76);
gerçek bireysel kayıt kullanmadan yalnız kuramı geçmesi ise bölünmeye bağlı (+3,3 / ±0). Kurumun elinde az
sayıda gerçek kayıt da varsa ikisi birlikte her iki bölünmede de en iyisi:

| Diğer yarıdan n gerçek kişi (3 tekrar) | Yalnız gerçek (A→B / B→A) | Gerçek + kalibre sentetik aileler |
|---|---|---|
| 50 kişi | 72,1 / 72,8 | **77,1 / 75,3** |
| 100 kişi | 73,7 / 73,8 | **77,5 / 75,5** |
| 200 kişi | 73,2 / 75,2 | **77,7 / 75,5** |

Not: kalibrasyon bir yarının tamamının *toplam* çapraz tablolarını kullandı; senaryonun doğru adı "yayımlanmış
çapraz tablolar (ör. anket şirketlerinin oy × demografi raporları) + az sayıda bireysel kayıt"tır.

**Dil modeli gerçek Türk seçmenini canlandırabiliyor mu?** (`tests/llm_tr_gercek.mjs`, B yarısından 96 kişi,
Groq gpt-oss-20b, anket betiminden): dil modeli tek başına 71,9 (log-kayıp 1,008) — yalnız kuramın (75,0; 0,774)
altında; A yarısında öğrenilmiş bütünleşik model 78,1 (0,688); A + kalibre sentetik aileler **81,3** (0,641); il kalibreli ailelerle 80,2 (**0,630**) — 96 kişide bir kişilik fark. Kalibrasyonun öğrettikleri: Türkiye'de sol-sağ öz-konumlaması büyük ölçüde bir parti
kimliği etiketi; eğitimin etkisi üreticinin varsaydığından ~3 kat güçlü, dinin etkisi daha zayıf; Alevi kimliği
daha belirleyici; Kürt kimliğinin iktidar oyuna "cezası" sanılandan küçük (2018'de Kürt seçmenin ~%49'u iktidara).

**Sentetik coğrafyayı gerçek il sonuçlarına kalibre etmek** (`node tests/data/hane_il_kalibre.mjs`). Kişi düzeyi
kalibrasyon il dağılımını düzeltmemişti: sentetik ailelerin il payları gerçek 2023 il sonuçlarıyla (YSK,
`tests/data/fetch_tr_il.py`; yeterli kişisi olan 42 il) iktidar payında hiç ilişkili değildi (r ≈ 0). Üreticiye
her il için beş bloğun fayda kayması eklendi ve yalnız **2023** il paylarına göre yinelemeli ayarlandı (örneklem
büyüklüğüyle büzülmüş log-oran adımı). Hedefe dokunmayan iki sınama:

| İl düzeyi korelasyon (iktidar / ana muh. / milliyetçi / Kürt / katılmama) | Önce | Sonra |
|---|---|---|
| Aynı kişilerin sentetik **2018** oyu ↔ gerçek 2018 il sonuçları | 0,09 / 0,39 / 0,48 / 0,63 / 0,06 | **0,92 / 0,85 / 0,80 / 0,93** / −0,05 |
| **Başka tohumla yeni kişiler** ↔ gerçek 2023 (örneklem gürültüsü değil gerçek coğrafya mı?) | 0,21 / 0,43 / 0,32 / 0,63 / −0,07 | **0,67 / 0,66 / 0,58 / 0,82 / 0,34** |

Coğrafya yeni kişilere de taşınıyor; katılmamanın il dağılımı zayıf kalıyor. İl kalibreli ailelerde öğrenilen
model gerçek seçmeni iki bölünmede de gerçek veride öğrenilmiş model kadar isabetle tahmin ediyor (yukarıdaki
tablo; olasılık kalitesinde gerçek veri hâlâ önde). Az sayıda gerçek kayıt da varsa il kalibrasyonu ek katkı vermiyor (n = 50 / 100 / 200: 76,9 / 77,5 / 77,6 ↔ 77,1 / 77,5 / 77,7). Ana muhalefet payında ~9 puanlık ortalama hata düzey farkı:
üretici ulusal toplamı kendi hedefinde (%29) tutuyor, YSK eşlemesinde bu blok il ortalamasında %19.

**İletişim mekanizmalarının gücü — ANES 2016 + 2020 havuzu (10.553 kişi).** Tek seçimde belirsiz kalan mercek
katsayıları havuzda daralıyor: medya etkisinin dikkat × ELM ikna edilebilirliği × Hall okuma konumuyla
değişmesi **0,22 ± 0,14** (yapısal) ve kimlik gündemi (dolaysız deneyim) **0,81 ± 0,40** destekleniyor;
topluluk iklimine uyum (suskunluk sarmalı) ters yönde (−0,67 ± 0,65); gündem/öncelikleme ve pekiştirme belirsiz.

### Gerçek veride ölçülen başarım (`node tests/realdata.mjs`)

Gerçek insanların gerçek kararları, görülmemiş veride. Kıyas: **standart** = kuramsız koşullu logit
(özellikler doğrusal + tüm kişi değişkenleri seçeneğe özgü), **bütünleşik** = kuram terimleri + aynı
kişi değişkenleri. ANES için önce `python3 tests/data/fetch_anes.py` (ham veri repoya konmaz).

**Siyaset — ANES 2016/2020** (ABD; Demokrat / Cumhuriyetçi / üçüncü aday / oy kullanmama; 3.610 ve
6.943 seçmen). "Yapısal" model parti kimliği ve aday termometresi kullanmaz; yalnızca toplumsal yapı,
değerler (otoriterlik, din, ideoloji), algılar (ekonomi, güven) ve medya diyeti (partizan program/site sayısı):

| Test | Çoğunluk | Standart | Bütünleşik | Eleştirel terimler çıkarılınca |
|---|---|---|---|---|
| Seçimler arası, yapısal: 2016'da öğren → 2020'yi tahmin et (`--secimler`) | 47,1 | 55,0 | **69,6** | 70,7 |
| Seçimler arası, yapısal: 2020 → 2016 (2016'da eyalet bağlamı) | 35,7 | 57,9 | **62,7** | 61,3 |
| Seçimler arası, tam (parti kimliği + termometre): 2016 → 2020 | 47,1 | 77,4 | **80,5** | 80,2 |
| Seçimler arası, tam: 2020 → 2016 | 35,7 | **70,7** | 70,1 | 70,0 |
| Gerçek iş akışı: 2016'da öğren + 2020'nin toplam paylarına (anket) kalibre et → 2020, yapısal | 47,1 | 59,7 | **70,4** | — |
| Aynı iş akışı, tam model (parti kimliği + termometre) | 47,1 | **81,2** | 80,8 | — |
| Aynı seçim, 5 katlı CV, yapısal 2020 | 47,1 | **74,1** | 73,8 | — |
| Az veri: 2016'dan 100 kişiyle öğren (`--egri`) | 33,7 | 58,9 | **62,3** | 60,0 |
| Az veri: 50 kişi | 33,5 | 33,1 | **57,9** | 56,8 |
| Hiç bireysel veri yok — yalnız kuram + seçimin toplam sonucu, 2020 yapısal (`--sifir`) | 47,1 | — | **68,7** | — |

- Otoriter dinamik terimi (Frankfurt Okulu) iki seçimde de anlamlı: katsayı 0,34 ± 0,14 (2016),
  0,30 ± 0,10 (2020).
- Kuramın değeri **az veride**, **yeni bir seçime/bağlama taşımada** ve **veri yokken** ortaya çıkar
  (iktidar değişince kuram ekonomik oyu ve iktidar yorgunluğunu doğru tarafa taşır; kuramsız model
  çöker). Bol veriyle aynı seçimin içinde ise esnek kuramsız model ile başa baş gider.
- Diğer siyasi veriler (5 katlı CV): Şili 1988 plebisiti 32,9 / 67,4 / 67,4; İngiltere BEPS
  47,2 / **67,1** / 66,8 (log-kayıpta bütünleşik daha iyi: 0,845 / 0,857 ve 0,772 / 0,779).
- Bu tablo oturum 7'deki ablasyon hatası düzeltildikten sonra yeniden ölçüldü (kuramsız model artık
  öğrenmediği terimleri tahminde kullanmıyor) ve 2016'ya partizan medya bataryası eklendikten sonra (Hannity,
  O'Reilly, Limbaugh, foxnews.com / Maddow, Hardball, HuffPost…) yeniden ölçüldü; yapısal aktarımda kuramın
  ~14 puanlık üstünlüğü sürüyor.

**Ticaret:** otomobil tercihi (4.654 kişi, 6 seçenek) çoğunluk 32,2 / standart 40,2 / bütünleşik 40,1;
ısıtma sistemi (900 hane) her model çoğunlukta 63,7 — veride kişi bilgisi çok az, kuram ek katkı vermiyor.
**Gündelik:** şehirlerarası ulaşım (210 kişi) 26,2 / 43,8 / **54,8** (Becker'in zaman maliyeti);
işe gidiş türü (453 kişi) 48,1 / 67,1 / **67,5**.

### Yapay zekâ modelin içinde: gerçek test (`node tests/llm_live.mjs`)

Dil modeli ayrı bir tahminci değil, faydaya giren bir terimdir: z = log P_dil modeli(seçenek), katsayısı
veriden öğrenilir. Groq gpt-oss modelleri ANES seçmenlerini betimlerinden canlandırdı:

| Koşu | Yalnız dil modeli | Bütünleşik (dil modelsiz) | Bütünleşik + dil modeli | Öğrenilen katsayı |
|---|---|---|---|---|
| 2016'da öğren → 2020, 120 seçmen, Türkçe istem (120b) | 58,3 | 72,5 | 74,2 | −0,06 |
| Aynı, İngilizce ABD bağlamlı istem (120b) | 72,5 | 71,7 | 75,0 | −0,04 |
| 2016 içi, 90 seçmen, betime eyalet sonucu eklendi (20b) | 50,0 (bağlamsız 55,6) | 63,3 | 67,8 | 0,03 |
| Sentetik TR, 48 seçmen, betime hayat öyküsü eklendi (20b, `tests/llm_oyku.mjs`) | 56,3 (öyküsüz 37,5) | 72,9 | — | — |
| Aynı, 84 seçmen (120b; kota dolunca iki yanıtı da olanlar) | 63,1 (öyküsüz 40,5) | 75,0 | — | — |
| Hane verisi, 48 seçmen, ayrıntılı aile öyküsü (~1.700 karakter; 20b, `KAYNAK=hane`) | 58,3 (öyküsüz 37,5) | 95,8 | — | — |
| Hane verisi, 96 seçmen, aynı öyküler (120b, `KAYNAK=hane`) | 62,5 (öyküsüz 46,9; log-kayıp 1,157) | **83,3** (0,497) | — | — |

Öğrenilen katsayı her koşuda sıfıra yakın: dil modeli, modelin zaten bildiği bireysel betimi okuyor ve
bağımsız bilgi katmıyor. Topluluk bağlamını metin olarak vermek de dil modelinin isabetini artırmadı;
aynı bilgi modele yapılandırılmış terim (`topluluk`) olarak girince kazanç ölçüldü (yukarıda). Örneklemler
küçük (48–120), farklar bu nedenle temkinle okunmalı. Hayat öyküsü metni ise dil modelinin isabetini
37,5–40,5'ten 56–63'e çıkardı (20b ve 120b): dil modeli öyküden gerçek bilgi okuyor, ama aynı bilgiyi
yapılandırılmış sütun olarak alan bütünleşik model yine önde (72,9–75,0). Hane verisinin ayrıntılı aile
öyküleriyle de aynı tablo: dil modeli 37,5 → 58,3 (20b) ve 46,9 → 62,5 (120b, 96 kişi); bütünleşik model 96 kişide 83,3, 48 kişide 95,8 (bu verinin 5 katlı
CV'si 85,4 — küçük örneklem şanslı düştü). Ayrıntılı persona dil modelinin isabetini belirgin artırıyor, ama
en büyük kazanç aynı bilgiyi kuram terimlerine yapılandırılmış olarak vermekten geliyor. Ücretsiz Groq kotası günde 200 bin token.

### CSV biçimi

```
yas;cinsiyet;egitim;gelir;ideoloji;onceki_oy;kisi;fiyat_A;var_C;secim
34;kadın;lisans;orta;sol;B;101;20000;1;B
```

Kuram girdisi sütunları da tanınır ve ölçekleri (0–1, 1–5, 1–7, 0–10, 0–100…) otomatik dönüştürülür:
`otoriterlik`, `sol_sag` / `konum_ekonomi`, `konum_kultur`, `ekonomi_algisi`, `hane_algisi`, `parti_kimligi`,
`medya_kaynagi` (kanal yanlılığı `baglam.medya_yanliligi` ile). Sosyal bağlam sütunları: `es_oyu` /
`ebeveyn_oyu` / `aile_tercihi`, `ag_<seçenek>` (konuşulan çevrede pay), `cevre_<seçenek>` ya da `il` /
`bolge` (`baglam.bolge_paylari` ile). Persona sütunlarının hepsi isteğe bağlı; Türkçe karakter, büyük/küçük harf ve sayısal yaş
otomatik eşlenir. Seçim, seçenek kimliği ya da adıyla eşleşebilir.

### Sentetik doğrulama (bilinen "gerçek" modellerle — `npm run validate`)

Gerçek kampanya verisi olmadan dürüst ölçüm, bilinen bir gerçek modelden veri üretip görülmemiş
veride teorik tavanla kıyaslamaktır:

- İletişim kuramlarının entegrasyonu (n=1600, gerçek davranış iletişim etkisi içerirken): tavana göre
  yakalanan tahmin kazancı %61 → %72; ticarette %61 → %87, siyasette %95 → %97; ortalama isabet
  %67.1 → %67.6 (tavan %68.1). Az veride (n≈100) ticarette model çoğunluk tahmininin önüne geçemiyor —
  bu kadar veriyle beklenen bir sınır.
- Geçmiş oy eklenince isabet ~%65 → ~%85.
- Conjoint verisinden fiyat esnekliği ve fiyat senaryosunun etkisi gerçeğe çok yakın geri kazanılır.
- Yanlı örneklemde model-tabanlı nüfus tahmini ham örneklemden belirgin biçimde isabetli.
- Panelde gizli sınıf modeli tek sınıftan iyi ve tavana yakın.

**Sınır:** bunlar modelin *iç tutarlılığını ve öğrenme mekanizmasını* sınar. Gerçek dünyadaki
isabet, kurumun verisinin kalitesine ve kapsamına bağlıdır ve `decision_learn` her seferinde onu
ayrıca ölçer. Veri yüklenmeden yapılan tahminler kuram öncülleridir; mutlak paylar değil, yönler ve
"ne olur" karşılaştırmaları için kullanılmalıdır.

## Kitle tahmini

**📊 Kitle** sekmesinden ya da sohbetten ("belediyemizin su kesintisi duyurusunu gençler nasıl
karşılar?") kullanılır. Hesap tamamen cihazda yapılır; yalnızca `audience_survey` model çağırır.

```
 mesaj metni ─► extract.js ─┐        (alan, çerçeve, duruş, ticarilik, kanıt, temsil…)
 kurum profili ─────────────┼─► engine.js ──► erişim · tutum · paylaşım · benimseme
 hedef kitle / marjinaller ─┘      │          Hall okumaları · kuram katkıları · segmentler
                                   │          %90 güven aralığı (bootstrap)
        personas.js ──► sentetik nüfus (MatrAIx tarzı kategorik boyutlar)
        theories.js ──► 20 kuram (13 ana akım + 7 eleştirel), etki operatörleri
        calibrate.js ◄─ kurumun gerçek geçmiş sonuçları
        survey.js ────► persona ajanları dil modeliyle "anket" + kuram motoruyla üçgenleme
```

### Katmanlar

- **Persona katmanı (MatrAIx tarzı).** MatrAIx, nüfus ölçeğinde simüle kullanıcıyı çok sayıda
  kategorik boyutla tanımlayıp persona ajanlarını anket/sohbet/web/uygulama ortamlarında koşturur.
  Burada aynı fikir bağımsız olarak, tarayıcıda yeniden kuruldu: 13 boyut (yaş, cinsiyet, yerleşim,
  eğitim, gelir, ideoloji, dindarlık, dijital beceri, ana medya, kurumsal güven, bilişsel ihtiyaç,
  kanaat önderliği, marjinal kimlik) koşullu olarak örneklenir — ör. 65+ yaşta dijital beceri
  düşer, dijital beceri ana medyayı belirler. Tohumludur: aynı girdi → aynı nüfus. Şema
  `DIMENSIONS`'a satır ekleyerek genişler. Varsayılan dağılımlar kaba yaklaşımlardır; kurum kendi
  verisini (`kitle` marjinalleri) girmelidir. MatrAIx'in kendi verisine/API'sine bağlı değildir.
- **Kuram katmanı.** Her kuram, persona × mesaj × kurum × kanal karşılaşmasında gizil
  değişkenlere (maruz kalma, dikkat, güvenilirlik, tutum, paylaşım, anlama, benimseme, Hall
  kodaçımı, müzakere) katkı yazan bir operatördür. Motor iki geçişlidir: önce bireysel/kanal
  etkileri, sonra nüfus toplamlarına bakan sosyal etkiler (iki aşamalı akış, suskunluk sarmalı,
  yayılma). Her sonuç "hangi kuram neyi ne kadar itti" dökümüyle gelir.
- **Kurum katmanı.** 16 jenerik kurum türü (bakanlık, belediye, üniversite, holding, KOBİ, ana
  akım/bağımsız medya, STK, iktidar/muhalefet partisi, dini kurum, hastane, spor kulübü…):
  sahiplik, algılanan ideoloji, iktidar yapısına gömülülük, güvenilirlik, ticarilik, alan uzmanlığı,
  tipik kanallar. `institution_save` ile kurum kendi profilini kaydeder.
- **Alanlar.** siyaset, sağlık, ticaret, eğitim, kültür, spor, bilim, kriz, çevre, finans, din,
  kamu hizmeti ve alan bağımsız `genel`. Alan verilmezse metinden, o da yoksa kurumun uzmanlığından çıkarılır.

### Kuramlar

| Gelenek | Kuram | Modeldeki etkisi |
|---|---|---|
| ana akım | Lasswell formülü | kanal × ana medya → maruz kalmanın omurgası (her mercekte açık) |
| ana akım | Gündem belirleme (McCombs & Shaw) | tekrar ve ana akım görünürlük → erişim, dikkat |
| ana akım | Kullanımlar ve doyumlar (Katz vd.) | alan ilgisi → dikkat, paylaşım |
| ana akım | Kaynak güvenilirliği (Hovland) | kurum güvenilirliği × uzmanlık × kişinin kurumsal güveni |
| ana akım | Seçici maruziyet & düşmanca medya (Festinger; Vallone) | ideolojik mesafe → kaçınma, yanlılık algısı |
| ana akım | Çerçeveleme (Goffman; Entman; Kahneman–Tversky) | çerçevenin alana ve kişiye uyumu |
| ana akım | ELM (Petty & Cacioppo) | merkezi yol: argüman kalitesi; çevresel yol: ipuçları, kaynak |
| ana akım | Ekme (Gerbner) | yoğun TV izleyicisinde korku çerçevesi ve ana akımlaşma |
| ana akım | Bilgi açığı (Tichenor vd.) | eğitim/gelir ve dijital kanal → anlama farkı |
| ana akım | Psikolojik tepkisellik (Brehm) | baskıcı çerçeve, aşırı tekrar, güvenilmeyen kaynak ters teper |
| ana akım | Yeniliklerin yayılması (Rogers) | yenilikçilik × yenilik; erken benimseyenlerden sosyal kanıt |
| ana akım | İki aşamalı akış (Lazarsfeld; Katz) | kanaat önderleri → geri kalana erişim ve tutum |
| ana akım | Suskunluk sarmalı (Noelle-Neumann) | azınlıkta hisseden tartışmalı konuda susar |
| eleştirel | Kodlama/kodaçımlama (Stuart Hall) | egemen / müzakereci / karşıt okuma dağılımı |
| eleştirel | Propaganda modeli (Herman & Chomsky) | 5 filtre ana akım kanalda neyin büyüyeceğini seçer |
| eleştirel | Ekonomi politik & dijital uçurum | yapısal erişim eşitsizliği |
| eleştirel | Kültür endüstrisi (Adorno & Horkheimer) | ticari içerik: erişim ↑, anlama ve müzakere ↓ |
| eleştirel | Hegemonya (Gramsci) | egemen fikir "sağduyu" olarak rıza üretir; karşı-hegemonik çevrede yankılanır |
| eleştirel | Kamusal alan (Habermas) | akılcı-eleştirel müzakere göstergesi |
| eleştirel | Feminist & kesişimsel eleştiri (Mulvey; hooks; Crenshaw) | temsil → kadın ve marjinal gruplarda tutum/karşıt okuma |

**Mercekler:** `butunlesik` (hepsi), `ana_akim`, `elestirel`. Aynı mesajı üç mercekle koşturup
farkı görmek, hangi açıklamanın sonucu taşıdığını gösterir. Hall okumaları yalnızca Hall açıkken raporlanır.

### Kuruma uyarlama (kalibrasyon)

Kuramlar **yön** verir; **büyüklüğü** kurumun kendi geçmişi belirlemelidir. Sohbette:

> Geçen yılki iki kampanyamızın sonuçları şöyle: aşı SMS'i %62 erişim, %41 olumlu; TV spotu %78 erişim, %35 olumlu. Bunlarla modeli bakanlığımız için kalibre et.

`audience_calibrate` gözlenen `erisim_yuzde`, `olumlu_yuzde`, `ortalama_tutum`, `paylasim_yuzde`,
`benimseme_yuzde` değerlerine düzenlileştirilmiş koordinat inişiyle uyar. 4'ten az ölçümde yalnızca
sabit terimler ayarlanır (aşırı uyumu önlemek için); yeterli veride kuram ağırlıkları da oynar ve
hangi kuramın bu kurum için daha/az belirleyici olduğu raporlanır. Kalibrasyon kuruma bağlanır,
sonraki tahminler otomatik kullanır.

### Persona-ajan anketi

`audience_survey` nüfustan tabakalı (varsayılan: ideoloji) bir panel seçer, her personayı doğal
dilde betimleyip bağlı modele canlandırtır (tutum, Hall okuması, paylaşım, gerekçe) ve **aynı
personalar** için kuram motorunun tahminiyle karşılaştırır. Okuma eşleşmesi ve tutum korelasyonu
yüksekse iki bağımsız yöntem uyuşuyor demektir; düşükse ayrışan personalar gösterilir.

### Dürüst sınırlar

- Bu bir **kuram-temelli simülasyondur, gözlem değildir.** Katsayılar kuramların yönünü ve göreli
  büyüklüğünü kodlar; mutlak değerler kalibrasyonsuz yalnızca senaryo karşılaştırması için anlamlıdır.
- `%90 GA` yalnızca örneklem belirsizliğidir. Kuram belirsizliği ayrıca **model belirsizliği
  bandıyla** raporlanır: her kuramın ağırlığı log-normal gürültüyle (kabaca ×0.5–×2) bozulup tahmin
  24 kez tekrarlanır, ana akım ve eleştirel mercekler ayrı koşturulur. Duyarlılık "yüksek" ya da
  tutumun yönü bant içinde işaret değiştiriyorsa sonuç veriyle kalibre edilmeden yorumlanmamalıdır.
- Varsayılan nüfus dağılımları ve kurum profilleri kaba yaklaşımlardır, gerçek kurumları temsil etmez.
- Persona ajanları dil modelinin canlandırmasıdır; gerçek katılımcının yerini tutmaz.
- Metin çıkarımı sözlük tabanlıdır; ironi ve bağlamı kaçırabilir — kanıt kelimelerine bakıp gerekirse alanları elle ver.

## Nasıl çalışıyor

Sağlayıcıların "function calling" formatları birbirini tutmuyor; bazılarında hiç yok.
Bu yüzden N.E.X.U.S. **evrensel bir JSON protokolü** kullanır — model her turda tek bir
JSON nesnesi döndürür:

```json
{
  "plan": "Ne yapacağımı açıklıyorum",
  "steps": ["adım 1", "adım 2"],
  "actions": [{ "tool": "task_add", "args": { "title": "Fatura öde" } }],
  "reply": "Kullanıcıya mesaj",
  "done": false
}
```

Döngü: **plan → (onay) → araçları çalıştır → sonuçları modele geri ver → tekrar**,
`done: true` gelene ya da adım limitine ulaşana kadar. Model protokolü bozarsa düz
metin cevap olarak gösterilir — kırılmaz, sadece araçsız çalışır.

```
js/providers.js  → 4 tür API'yi tek arayüze indirger (openai · gemini · anthropic · ollama)
js/tools.js      → araç kayıt defteri
js/agent.js      → plan/çalıştır döngüsü ve sistem mesajı
js/store.js      → localStorage kalıcılığı
js/voice.js      → eller serbest durum makinesi (uyandırma, sesli onay, yerel komutlar)
js/speech.js     → ses tanıma ve okuma ilkelleri
js/ui.js         → balonlar, kartlar, modallar
js/app.js        → ekranların kablolaması
js/audienceView.js → Kitle sekmesi
js/audience/     → kitle tahmini: personas · theories · institutions · engine
                   · calibrate · extract · survey · scenarios (saf JS, node'da da çalışır)
js/decision/     → karar tahmini: domains (kuram terimleri) · model (logit, ne olur) · estimate
                   (MAP, doğrulama, gizli sınıf, raking) · data (CSV) · ensemble · polls · presets
js/decisionView.js → Karar sekmesi
```

## Testler

Uygulamanın kendisi bağımlılıksızdır; testler için Playwright gerekir.

```bash
npm install      # yalnızca playwright (dev bağımlılığı)
npm test         # gerçek Chromium'da, mobil ekran boyutunda koşar
```

Yedi paket (+ `npm run validate` doğrulama raporu):

- `tests/smoke.test.mjs` — açılış, sekmeler, uçtan uca ajan döngüsü (plan kartı → araç
  kartları → sonuç), kalıcılık, yeniden yükleme, riskli araç onayı, API hata yolu, konsol temizliği
- `tests/providers.test.mjs` — dört adaptörün (openai · gemini · anthropic · ollama) istek
  gövdesi, kimlik başlıkları, akış çözümlemesi, model listeleme ve yedeğe geçiş davranışı
- `tests/audience.test.mjs` — kitle çekirdeği (tarayıcısız): örnekleyici, her kuramın beklenen
  yöne ittiği, mercekler, kalibrasyonun bilinen parametreleri geri kazanması, metin çıkarımı,
  sahte persona ajanlarıyla anket, tüm hazır senaryolar
- `tests/decision.test.mjs` — karar motoru: üç alanda kuram yönleri, veriden öğrenme ve teorik
  tavana yakınlık, pay kalibrasyonu, CSV, conjoint fiyat esnekliği, raking/MRP, topluluk, geçmiş
  davranış, gizli sınıflar, anket birleştirme, seçim biçimi, etkileşimler
- `tests/decision_tools.test.mjs` — karar araçları ve Karar sekmesi, tarayıcıda uçtan uca
- `tests/audience_tools.test.mjs` — kitle araçlarının ajan döngüsünde ve Kitle sekmesinde uçtan uca çalışması
- `tests/voice.test.mjs` — eller serbest döngüsü: uyandırma kelimesi kapısı, sesli komut →
  ajan → sesli cevap → tekrar dinleme, sesle onay ve soru cevaplama, yerel komutlar

Sağlayıcılar sahte (mock) yanıtlarla taklit edilir; test için API anahtarı gerekmez.
Ses testlerinde `SpeechRecognition` ve `speechSynthesis` de sahte sürümlerle değiştirilir,
böylece mikrofon olmadan tüm konuşma akışı doğrulanabilir.

## Ayarlar

- **Adım limiti** — tek istekte kaç araç turu (varsayılan 8)
- **Sıcaklık** — 0 kesin/tutarlı, 1+ yaratıcı
- **Riskli araçları sormadan çalıştır** — onay pencerelerini kapatır
- **Akışlı yanıt** — cevap gelirken canlı yazılır
- **Sesli okuma** — cevapları sesli okur
- **CORS/proxy ön eki** — CORS engeline takılan servisler için. `https://proxy.example/?url=`
  veya `{url}` yer tutucusu içeren bir adres.
- **Web arama** — Tavily / Brave / Serper anahtarı girersen `web_search` açılır

## Veri ve gizlilik

Her şey **yalnızca senin cihazında**, tarayıcının `localStorage`'ında durur: API
anahtarları, görevler, notlar, hafıza, sohbet. Aracı bir sunucu yok; istekler
telefonundan doğrudan seçtiğin sağlayıcıya gider.

Bunun anlamı: **tarayıcı verilerini temizlersen her şey gider.** Ayarlar → *Dışa aktar*
ile düzenli yedek al (yedek dosyası API anahtarlarını da içerir, dikkatli sakla).

Ortak kullanılan bir cihazda kullanma — `localStorage` şifreli değildir.

## Bilinen sınırlar

- **CORS:** `http_fetch` ile rastgele web sitesi çekmek çoğu zaman tarayıcı tarafından
  engellenir. Sağlayıcı API'leri (Gemini, Groq, OpenAI, Anthropic, OpenRouter…) tarayıcıdan
  doğrudan çağrıya izin verir; sıradan siteler vermez. Proxy ayarı bunun içindir.
- **Hatırlatmalar** uygulama açıkken (veya arka planda canlıyken) çalışır; kapalı
  uygulamada sunucu gerektiren push bildirimi yoktur.
- **Ses tanıma** Chrome/Edge/Safari'de var, Firefox'ta yok — eller serbest mod da bu
  tarayıcılara bağlı. Ayrıca ses tanıma internet ister ve tanıma için sesin Google/Apple
  sunucularına gider (tarayıcının kendi davranışı).
- **Eller serbest mod sekme ön plandayken** çalışır; ekranı kapatırsan tarayıcı mikrofonu
  bırakır.
- **Anahtarlar tarayıcıda** durduğundan, cihazına erişen biri onları görebilir.

## Lisans

MIT.
