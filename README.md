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
- **Sesle çalışır.** Mikrofona bas, konuş; istersen cevabı sesli okur.
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

Yeni araç eklemek: `js/tools.js` içinde bir `def({name, desc, params, run})` bloğu.
Sistem mesajındaki katalog otomatik güncellenir, başka hiçbir yere dokunmak gerekmez.

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
js/ui.js         → balonlar, kartlar, modallar
js/app.js        → ekranların kablolaması
```

## Testler

Uygulamanın kendisi bağımlılıksızdır; testler için Playwright gerekir.

```bash
npm install      # yalnızca playwright (dev bağımlılığı)
npm test         # gerçek Chromium'da, mobil ekran boyutunda koşar
```

İki paket:

- `tests/smoke.test.mjs` — açılış, sekmeler, uçtan uca ajan döngüsü (plan kartı → araç
  kartları → sonuç), kalıcılık, yeniden yükleme, riskli araç onayı, API hata yolu, konsol temizliği
- `tests/providers.test.mjs` — dört adaptörün (openai · gemini · anthropic · ollama) istek
  gövdesi, kimlik başlıkları, akış çözümlemesi, model listeleme ve yedeğe geçiş davranışı

Sağlayıcılar sahte (mock) yanıtlarla taklit edilir; test için API anahtarı gerekmez.

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
- **Ses tanıma** Chrome/Edge/Safari'de var, Firefox'ta yok.
- **Anahtarlar tarayıcıda** durduğundan, cihazına erişen biri onları görebilir.

## Lisans

MIT.
