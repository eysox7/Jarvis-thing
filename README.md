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
| Kitle tahmini | `audience_predict`, `audience_compare`, `audience_optimize`, `audience_survey`, `audience_extract`, `audience_calibrate`, `audience_catalog`, `institution_save`, `institution_delete` `[onay]` |

Yeni araç eklemek: `js/tools.js` içinde bir `def({name, desc, params, run})` bloğu.
Sistem mesajındaki katalog otomatik güncellenir, başka hiçbir yere dokunmak gerekmez.

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
- Güven aralığı yalnızca örneklem belirsizliğidir; model (kuram) belirsizliğini içermez.
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
```

## Testler

Uygulamanın kendisi bağımlılıksızdır; testler için Playwright gerekir.

```bash
npm install      # yalnızca playwright (dev bağımlılığı)
npm test         # gerçek Chromium'da, mobil ekran boyutunda koşar
```

Beş paket:

- `tests/smoke.test.mjs` — açılış, sekmeler, uçtan uca ajan döngüsü (plan kartı → araç
  kartları → sonuç), kalıcılık, yeniden yükleme, riskli araç onayı, API hata yolu, konsol temizliği
- `tests/providers.test.mjs` — dört adaptörün (openai · gemini · anthropic · ollama) istek
  gövdesi, kimlik başlıkları, akış çözümlemesi, model listeleme ve yedeğe geçiş davranışı
- `tests/audience.test.mjs` — kitle çekirdeği (tarayıcısız): örnekleyici, her kuramın beklenen
  yöne ittiği, mercekler, kalibrasyonun bilinen parametreleri geri kazanması, metin çıkarımı,
  sahte persona ajanlarıyla anket, tüm hazır senaryolar
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
