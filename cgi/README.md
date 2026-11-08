# CGI / Sinematik Üretim — Casper Excalibur G870

Bu klasör, G870 dizüstünde **en kısa sürede, en iyi görüntüyü** almak için hazır
ayarlar ve betikler içerir. Akış: **Blender** (modelleme + render) →
**görüntü dizisi** → **DaVinci Resolve** (kurgu/renk) veya **FFmpeg NVENC** (hızlı video).

```
cgi/
├── donanim.ps1            # Donanımı okur, eksikleri ve önerileri söyler
├── render.ps1             # Blender'ı arayüzsüz, G870 profiliyle çalıştırır
├── kodla.ps1              # PNG dizisi → YouTube / sosyal / master video (NVENC)
└── blender/
    ├── g870_profil.py     # Render profilleri (VRAM'e göre kendini ayarlar)
    └── test_profil.py     # Profillerin Blender API'sine uyduğunu sınar
```

---

## 1. Tek seferlik kurulum (bunlar en büyük hız farkını yaratır)

| Adım | Nerede | Neden |
|---|---|---|
| **NVIDIA Studio sürücüsü** | nvidia.com/drivers → Ürün tipi: *Studio* | Blender/Resolve için test edilmiş; OptiX güncel |
| **Performans/Turbo modu** | Casper Control Center | GPU'nun tam TGP (watt) değerini açar. Dengeli modda render belirgin yavaşlar |
| **dGPU / MUX modu** | Casper Control Center → Ekran kartı modu | Görüntü doğrudan NVIDIA'dan geçer, Optimus yükü kalkar |
| **Fan: maksimum** | Casper Control Center | Uzun render'da ısı = hız kaybı |
| **Adaptör takılı** | — | Pilde GPU gücü ciddi ölçüde kısılır |
| **Donanım hızlandırmalı GPU zamanlama: Açık** | Ayarlar → Ekran → Grafik | Viewport akıcılığı |
| **Blender & Resolve → Yüksek performans** | Ayarlar → Ekran → Grafik → Uygulama ekle | Yanlış GPU'da açılmasın |
| **Blender: OptiX** | Edit → Preferences → System → Cycles Render Devices → **OptiX**, yalnızca GPU işaretli | RTX çekirdekleri; CUDA'dan ~%30-80 hızlı |
| **Proje diski: NVMe SSD** | — | EXR dizileri ve önbellek için |

Sonra kontrol et:

```powershell
powershell -ExecutionPolicy Bypass -File cgi\donanim.ps1
```

Rapor GPU/VRAM, sürücü, güç planı, boş disk ve eksik yazılımı gösterir;
`cgi\donanim.json` dosyasına da yazar.

Gerekli yazılımlar:

```powershell
winget install BlenderFoundation.Blender      # LTS sürümü tercih et
winget install Gyan.FFmpeg
winget install BlackmagicDesign.DaVinciResolve # ücretsiz sürüm yeterli
```

## 2. G870 yapılandırmana göre sınırlar

G870 farklı ekran kartlarıyla satıldı; **VRAM** sahnenin ne kadar büyük olabileceğini belirler.
`g870_profil.py` bunu `nvidia-smi`'den okuyup otomatik uygular:

| VRAM | Örnek kart | Doku sınırı | Karo | Kalıcı veri |
|---|---|---|---|---|
| ≤ 6 GB | RTX 3060 Laptop | 2K | 1024 | kapalı |
| 8 GB | RTX 4060 / 4070 / 3070 Laptop | 4K | 2048 | açık |
| > 8 GB | — | sınırsız | 2048 | açık |

RTX 40 serisindeysen `kodla.ps1` otomatik olarak **AV1** donanım kodlayıcıyı kullanır
(aynı kalitede HEVC'den ~%30 daha küçük dosya).

## 3. Profiller

| Profil | Motor | Ne zaman | Göreli hız |
|---|---|---|---|
| `onizleme` | Cycles, %50 çöz., 32 örnek | Işık, kamera, kompozisyon denemesi | ⚡⚡⚡⚡ |
| `hizli` | EEVEE (raytracing açık) | Animasyon, sosyal medya, motion graphics | ⚡⚡⚡⚡⚡ |
| `final` | Cycles + adaptif örnekleme + OptiX denoise | Ürün görseli, poster, still | ⚡⚡ |
| `sinematik` | Cycles + hareket bulanıklığı + EXR | Reklam/film çekimi, renk düzeltme yapılacak işler | ⚡ |

Hepsinde ortak: yalnızca GPU (CPU+GPU hibrit dizüstünde ısınma yüzünden **yavaşlatır**),
AgX renk dönüşümü, ışık ağacı (light tree), sekme sayıları dengelenmiş,
firefly'lar kırpılmış, kostikler kapalı.

### Kullanım

Arayüzden: *Scripting* sekmesi → `g870_profil.py` aç → *Run Script*. Varsayılan `final`
profili uygulanır; başkası için en alttaki `main()` satırını `uygula("hizli")` gibi değiştir.

Komut satırından (önerilen — arayüz VRAM tüketmez, daha hızlıdır):

```powershell
# Tüm animasyon, sinematik
.\cgi\render.ps1 -Sahne D:\proje\reklam.blend -Profil sinematik

# Tek kare (120. kare), final kalite
.\cgi\render.ps1 -Sahne D:\proje\urun.blend -Profil final -Kare 120

# EEVEE animasyon + bittiğinde YouTube videosu üret
.\cgi\render.ps1 -Sahne D:\proje\intro.blend -Profil hizli -Kodla youtube -Fps 30
```

Çıktılar varsayılan olarak `sahne_klasoru\render\<sahne>\<profil>\kare_0001.png` gibi yazılır.

**Yarıda kalırsa** (elektrik, ısınma, çökme) aynı komutu tekrar çalıştır: bitmiş kareler atlanır.
Bu yüzden render'ı hiçbir zaman doğrudan `.mp4`'e almıyoruz.

### Video üretme

```powershell
.\cgi\kodla.ps1 -Klasor D:\proje\render\intro\hizli -Hedef youtube -Fps 24
.\cgi\kodla.ps1 -Klasor D:\proje\render\intro\hizli -Hedef sosyal  -Ses muzik.mp3
.\cgi\kodla.ps1 -Klasor D:\proje\render\intro\hizli -Hedef master   # DNxHR HQ .mov
```

`sinematik` profili çok katmanlı EXR üretir: bunları doğrudan **DaVinci Resolve**'a
görüntü dizisi olarak at, renk düzeltmesini orada yap, oradan dışa aktar.

## 4. Render süresini kısaltan alışkanlıklar

Sıralama etki büyüklüğüne göre:

1. **Doğru motor.** Gerçekçilik şart değilse EEVEE (`hizli`) Cycles'tan 10-50 kat hızlıdır.
   Sosyal medya, logo animasyonu, stilize işler için önce EEVEE dene.
2. **Az örnek + denoise.** Cycles'ta 4096 örnek gerekmez; adaptif örnekleme + OptiX denoise
   çoğu sahnede 128-512 örnekte temiz sonuç verir. Profiller bunu zaten yapar.
3. **Düşük çözünürlükte render, sonra büyütme.** 1440p render → 4K'ya büyütme
   (Resolve Studio *Super Scale* ya da benzeri bir yapay zeka büyütücü) yaklaşık 2 kat
   süre kazandırır. Önce kısa bir parçada kaliteyi kontrol et.
4. **Işık kurulumu.** Az ama büyük alan ışıkları ve bir HDRI, onlarca küçük ışıktan
   hem güzel hem hızlıdır. Kapalı iç mekânlarda pencerelere *Portal* ışık koy.
5. **Geometri ve dokular.** Kameradan uzak nesnelerde Subdivision seviyesini düşür
   (*Simplify*), 8K doku yerine 2K/4K kullan. VRAM taşarsa render 10 kat yavaşlar.
6. **Hacimler (sis, duman) pahalıdır.** Mümkünse sahnede değil, Resolve'da sis/ışık
   hüzmesi efektiyle ver.
7. **Uzun render'ı gece al.** Oda serin, dizüstü yükseltilmiş ya da soğutucu altlıkta.
   `nvidia-smi -l 5` ile sıcaklığa bak; 85 °C üstü sürekli ise GPU kendini kısıyor demektir.

## 5. Önerilen iş akışı

```
Fikir / storyboard
   │
   ▼
Blockout (kaba geometri, kamera hareketi)  →  viewport'ta EEVEE
   │
   ▼
Işık + materyal  →  profil: onizleme   (birkaç kare)
   │
   ▼
Animasyon kontrolü  →  profil: hizli, %50 çözünürlük
   │
   ▼
Final render  →  hizli (EEVEE) ya da final/sinematik (Cycles)
   │
   ▼
Kurgu + renk + ses  →  DaVinci Resolve      |   hızlı yol: kodla.ps1
   │
   ▼
Teslim: youtube (HEVC/AV1) · sosyal (H.264) · master (DNxHR)
```

## 6. Sorun giderme

| Belirti | Çözüm |
|---|---|
| "NVIDIA GPU bulunamadı" | Studio sürücüsünü kur; Control Center'da dGPU modunu seç; Blender'ı yeniden başlat |
| `CUDA error: out of memory` | Daha düşük doku sınırı ver: `--vram 6`; Simplify aç; arayüzü kapatıp `render.ps1` kullan |
| Render ilerledikçe yavaşlıyor | Isınma: fanı maksimuma al, altlık kullan, Performans modunu kontrol et |
| Videoda renkler soluk | Doğrudan Blender'dan `.mp4` alma; `kodla.ps1` renk etiketlerini doğru yazar |
| Animasyonda gürültü "kaynıyor" | `sinematik` profilini kullan (animasyonlu tohum + daha düşük eşik) |

## Test

Profil betiğinin kullandığı her ayarın güncel Blender'da var olduğunu sınar:

```bash
pip install bpy            # Blender'ın Python modülü
python cgi/blender/test_profil.py
```
