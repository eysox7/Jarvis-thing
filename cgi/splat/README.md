# Gaussian Splatting: gerçek mekânı poligonsuz sahneye almak

Bir mekânı ya da nesneyi telefonla çekip **3D Gaussian Splatting (3DGS)** ile
fotogerçekçi bir 3B sahneye çevirirsin. Sonra `import_gaussian_splat` aracıyla
Blender'a alırsın. Milyonlarca poligon modellemek yerine gerçek dünyanın kendisini
kullanmış olursun. Işık, doku ve yansıma zaten fotoğrafta var.

```
Telefon videosu ─▶ kareler.ps1 ─▶ kamera pozları + eğitim ─▶ .ply ─▶ (temizlik) ─▶ Blender
                                  (Postshot / COLMAP+Brush)        (SuperSplat)    import_gaussian_splat
```

## 1. Çekim (sonucu en çok bu belirler)

- **Yavaş yürü, hiç durma.** Nesnenin etrafında 2-3 tur at: biri göz hizasında, biri
  yukarıdan, biri aşağıdan. Mekânda duvarlara paralel yürü, sadece dönerek çekme.
- **Pozlamayı ve odağı kilitle.** iPhone'da ekrana basılı tut, AE/AF kilidi.
- **HDR videoyu kapat** (iPhone: Ayarlar → Kamera → Video Kaydı → HDR Video kapalı).
  HDR/Dolby Vision görüntüler eğitimde soluk renk verir.
- **4K 30 fps, 1-2 dakika** yeterli. Bulutlu gün ideal; sert güneş ve hareket eden
  insanlar/arabalar kötü sonuç verir.
- Parlak, cam, ayna ve düz beyaz yüzeyler 3DGS'in zayıf noktasıdır.

## 2. Kareler

```powershell
.\cgi\splat\kareler.ps1 -Video D:\cekim\salon.mp4          # saniyede 2 kare, 1600 px
```

`D:\cekim\salon_splat\images\` klasörü oluşur. 150-300 kare idealdir.

## 3. Eğitim — RTX 5050 Laptop (8 GB) için seçenekler

| Yol | Ne yapar | Artısı | Eksisi |
|---|---|---|---|
| **Jawset Postshot** | Video/kareleri sürükle-bırak; kamera çözümü + eğitim + PLY dışa aktarma tek programda | En kolayı, Windows'a özel, NVIDIA'ya optimize | Ücretli planları var; güncel lisans koşullarını sitesinden kontrol et |
| **COLMAP → Brush** | COLMAP kamera pozlarını bulur, Brush eğitir | Tamamen ücretsiz ve açık kaynak | İki program, biraz daha adım |
| **Telefon uygulaması** (Scaniverse, Polycam, Luma) | Telefonda/bulutta splat üretir, PLY verir | Bilgisayar gerekmez | Kalite ve çözünürlük daha düşük |

8 GB VRAM için eğitim ayarları:
- Görüntü genişliği **1600 px** (kareler.ps1 zaten öyle yazar).
- Splat sayısı **1-1.5 milyonla sınırla** (Postshot: *Max Splats*; Brush: *max splats*).
  Fazlası hem eğitimde VRAM'i taşırır hem Blender'da gereksiz yük olur.
- 16 GB RAM ile eğitim sırasında tarayıcıyı ve Blender'ı kapat.

## 4. Temizlik (önerilir)

[SuperSplat](https://superspl.at/editor) (tarayıcıda, ücretsiz, açık kaynak):
PLY'yi aç, havada uçuşan "floater"ları ve gereksiz arka planı seç-sil, sonra
**File → Export → PLY (uncompressed)**. Sıkıştırılmış PLY'yi içe aktarıcı reddeder
ve bunu hata mesajında söyler.

## 5. Blender'a alma (Claude ile)

Claude'a şöyle söylemen yeterli:

> `D:\cekim\salon.ply` splat'ını sahneye al, içine altın bir heykel koy,
> golden hour ışığında yavaş bir push-in çekimi yap.

Claude sırasıyla `import_gaussian_splat` → `polyhaven_download`/`create_object` →
`lighting_preset` → `setup_camera` → `camera_move` → `render_image` çağırır.

### Bilmen gerekenler

- **Splat'lar sahne ışığından etkilenmez.** Işık fotoğraftan "pişmiş" gelir. Eklediğin
  3B nesneleri splat'ın ışığına uydur: aynı yönden ana ışık, benzer renk sıcaklığı.
  En kolayı, aynı mekânda bir HDRI çekmek ya da benzer bir Poly Haven HDRI'ı seçmek.
- **Yukarı ekseni:** COLMAP tabanlı eğitimlerde `-Y` (varsayılan). Sahne ters
  görünürse `up_axis="Y"`, yan yatmışsa `"Z"`.
- **Renk:** Splat ağırlıklı sahnede `set_color_look("standard")` fotoğraftaki renge en
  yakın sonucu verir. `cinema` (AgX) daha sinematik ama biraz desatüre eder.
- **Görünüm:** Splat'lar elipsoid örnekleri olarak çizilir ve 3σ'da kesilir (gerçek 3DGS
  gibi). Boşluklu görünürse `tune_splat(splat_size=3.5)`, puslu görünürse `2.5`.
- **Hız:** Viewport ağırlaşırsa `tune_splat(show_in_viewport=False)`. Render'da yine
  görünür. EEVEE (`hizli` profili) splat sahnelerinde Cycles'tan çok daha hızlıdır.
- **Sınırlar:** Bakış açısına bağlı renk (küresel harmoniklerin üst dereceleri)
  kullanılmaz, yalnızca temel renk alınır. Parlak yüzeylerde yansıma "donuk" görünebilir.
  Blender'da gerçek 3DGS rasterizasyonu yoktur; bu, en yakın render edilebilir yaklaşımdır.
