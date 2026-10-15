# Nexus · Telegram

Claude ile telefondan, Telegram üzerinden konuşma köprüsü. Dışarıdayken yaz, sesli mesaj
at, fotoğraf ya da PDF gönder; kısa ve işe yarar cevap gelir.

Asıl iş **token tasarrufu**: sohbet uzadıkça boş laf geçmişte birikip her mesajda yeniden
gönderilmez. Bot, [`verimli-sohbet`](../.claude/skills/verimli-sohbet/SKILL.md) skill'ini
hem sistem istemi hem de hafıza damıtma kuralı olarak kullanır.

## Token nasıl korunuyor

| Önlem | Etkisi |
|---|---|
| Skill sistem istemi | Girişsiz, kapanışsız, kısa cevap → daha az çıkış tokenı |
| Damıtma | İstem 8k tokenı geçince eski mesajlar kompakt **hafıza + özete** iner; son 4 mesaj aynen kalır |
| Sessizlik damıtması | 3 saat yazmazsan sohbet arka planda damıtılır; dönüşte tam geçmiş pahalıya gitmez |
| Yalnızca metin geçmişi | Düşünme blokları, fotoğraf/PDF içeriği ve kaynak linkleri geçmişe yazılmaz; yerinde `[Fotoğraf]` gibi kısa işaret kalır |
| Mesaj birleştirme | Art arda attığın "selam" / "bir şey soracağım" / "…" tek istekte gider |
| Önbellek | Art arda mesajlarda değişmeyen önek ~%95 ucuza okunur |
| `low` efor | Sohbette düşünme tokenlarını kısar; zor soruda `/efor high` |

`/durum` gerçek token ve tahmini maliyeti gösterir.

## Kurulum (10 dakika)

Gerekenler: Node.js 18.17+ ve sürekli açık duran bir makine (aşağıya bak).

1. **Bot oluştur.** Telegram'da [@BotFather](https://t.me/BotFather) → `/newbot` → ad ver →
   verdiği token'ı kopyala.
2. **Claude API anahtarı al.** https://platform.claude.com/settings/keys (API kullanımı,
   claude.ai aboneliğinden ayrı ücretlendirilir; Console'dan bakiye yükle).
3. **Kur:**
   ```bash
   git clone <bu depo> && cd Jarvis-thing/telegram
   npm install
   cp .env.example .env      # TELEGRAM_BOT_TOKEN ve ANTHROPIC_API_KEY'i yaz
   npm run kontrol           # token'ı ve anahtarı dener (ücretsiz)
   npm start
   ```
4. **Kendini yetkilendir.** Telegram'da botuna yaz. Bot kullanıcı kimliğini söyler
   (`ALLOWED_USERS=123456789`). Bunu `.env`'e ekle, botu yeniden başlat. Artık bot yalnızca
   sana cevap verir; başkaları Claude'a ulaşamaz, token harcatamaz.

## 7/24 çalıştırma

Bot senin telefonunda değil, sürekli açık bir makinede koşmalı. Dışa açık port ya da alan adı
**gerekmez** (uzun yoklama kullanır). Birini seç:

**Linux sunucu / VPS (önerilen)** — Oracle Cloud Always Free, Google Cloud e2-micro ya da
aylık birkaç dolarlık herhangi bir VPS yeter; bot çok az kaynak kullanır.
```bash
# deploy/nexus-telegram.service içindeki KULLANICI'yı düzelt
sudo cp deploy/nexus-telegram.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now nexus-telegram
journalctl -u nexus-telegram -f        # log
```

**Docker**
```bash
cd telegram && docker compose up -d     # veriler nexus-data biriminde kalır
```

**Evdeki bilgisayar** — açık kaldığı sürece: `npx pm2 start src/main.mjs --name nexus`.

**Android (Termux)** — eski bir telefon şarjda dursun:
```bash
pkg install nodejs git && termux-wake-lock
git clone <bu depo> && cd Jarvis-thing/telegram && npm install && cp .env.example .env
npm start
```
Termux'u pil optimizasyonundan çıkar; açılışta başlaması için Termux:Boot.

> Aynı token ile aynı anda tek örnek çalışmalı; ikincisi `409` uyarısı verir.

## Kullanım

Normal yaz. Desteklenenler: metin, fotoğraf (+açıklama), PDF, metin dosyası (≤200 KB),
konum, iletilen mesaj, bir mesaja yanıt (alıntı bağlama eklenir) ve — anahtar verirsen —
sesli mesaj.

| Komut | İş |
|---|---|
| `/yeni` | Konuyu kapat: geçmiş hafızaya damıtılır, temizlenir |
| `/hafiza` | Kalıcı hafızayı ve özeti numaralı göster |
| `/hatirla <not>` | Hafızaya doğrudan ekle (model çağrısı yok) |
| `/unut 3` · `/unut 2,5` · `/unut ozet` · `/unut hepsi` | Hafızadan sil |
| `/durum` | Model, efor, token, tahmini maliyet |
| `/efor low\|medium\|high\|xhigh\|max` | Düşünme seviyesi |
| `/web ac` · `/web kapat` | Web araması |

Sohbet içinde "bunu hatırla" ya da "şunu unut" demen de yeter; bir sonraki damıtmada işlenir.

## Sesli mesaj

Claude ses dinlemez; ses önce yazıya çevrilir. [Groq](https://console.groq.com/keys)'tan
ücretsiz anahtar al, `.env`'e `STT_API_KEY=` olarak yaz. Çevrilen metin sana da gösterilir.
Başka bir OpenAI-uyumlu servis için `STT_API_URL` ve `STT_MODEL`.

## Maliyet

Varsayılan model `claude-opus-5-5` (giriş 4 $ / çıkış 20 $, milyon token başına). Kısa bir
sohbet mesajı `low` eforda kabaca 1–3 sent tutar; art arda mesajlar önbellek sayesinde daha
ucuzdur. Daha ucuza çalıştırmak istersen `.env`'de:

```
BOT_MODEL=claude-sonnet-5-5     # yarı fiyat
MEMORY_MODEL=claude-haiku-5-5      # damıtmayı ~40 kat ucuza yapar
```

Kesin rakam için Console'daki kullanım sayfası; `/durum` tahmindir.

## Ayarlar

Tamamı [.env.example](.env.example) içinde açıklamalı. Öne çıkanlar:

| Değişken | Varsayılan | |
|---|---|---|
| `BOT_MODEL` | `claude-opus-5-5` | Sohbet modeli |
| `BOT_EFFORT` | `low` | Düşünme seviyesi |
| `COMPACT_AT_TOKENS` | `8000` | Damıtma eşiği |
| `KEEP_TURNS` | `4` | Damıtmada aynen kalan son mesaj |
| `IDLE_COMPACT_MINUTES` | `180` | Sessizlik damıtması (0 = kapalı) |
| `WEB_SEARCH` | `on` | Web araması |
| `FALLBACKS` | `on` | Güvenlik reddinde sunucu tarafı yedek model |

Ortamda (shell, systemd, Docker) tanımlı bir değişken `.env`'deki aynı adlı değeri ezer.

API isteğe bağlı bir özelliği (web araması, yedek model) reddederse bot o mesajı onlarsız
yeniden dener, özelliği o çalışma boyunca kapatır ve loga yazar.

## Veri ve gizlilik

- Hafıza, özet ve son mesajlar `data/chats/<id>.json` dosyasında, yalnızca sahibinin
  okuyabileceği izinle durur. Yedeklemek için bu klasörü kopyala.
- Mesajlar Telegram sunucularından ve Anthropic API'sinden geçer; bot sohbetleri uçtan uca
  şifreli değildir. Şifre, kart gibi bilgileri yazma (skill bunları hafızaya almaz).
- `.env` ve `data/` git'e girmez. Token'ını paylaşma; sızarsa BotFather → `/revoke`.

## Geliştirme

```
src/main.mjs      giriş noktası, --kontrol
src/bot.mjs       güncellemeler, sıra, birleştirme, komutlar, damıtma tetikleri
src/claude.mjs    Messages API (resmî SDK), önbellek, web, yedek model, damıtma
src/telegram.mjs  Bot API istemcisi (fetch), HTML/düz metin gönderimi, dosya indirme
src/format.mjs    Markdown → Telegram HTML, 4096 karakter bölme
src/store.mjs     sohbet başına JSON durum (atomik yazma)
src/skill.mjs     SKILL.md + references/damitma.md okuyucu
src/stt.mjs       sesli mesaj → yazı
```

```bash
npm test     # sahte Telegram + sahte Claude sunucusuyla; ağ ve anahtar gerekmez
```
