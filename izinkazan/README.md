# İzinKazan

Kamera görüntüsünden **YOLO** ile çalışanların hareketini takip eder, her
istasyonda yapılan **işi sayar**, günün sonunda **ortalamanın üstünde iş
yapanlara puan** verir. Biriken puan **izin saatine** dönüşür.

```
kamera ─► YOLO (poz + ByteTrack) ─► iş döngüsü sayacı ─► SQLite ─► puanlama ─► panel / izin bakiyesi
```

## Nasıl çalışır

**1. Takip.** `ultralytics` YOLO poz modeli (`yolo11n-pose.pt`) her karede
kişileri bulur, ByteTrack onlara kalıcı bir takip numarası verir. Poz
modelinden **bilek** noktaları alınır; poz yoksa kutu merkezi kullanılır.

**2. İş sayımı.** Her istasyon görüntü üzerinde çizilmiş bir çokgen bölgedir.
Bir **iş** = el bölgeye girer → en az `min_saniye` kalır → çıkar ve
`cikis_toleransi` kadar geri gelmez. `max_saniye`'den uzun duruşlar iş
sayılmaz (bölgenin başında beklemek puan getirmez). Bölgeyi, her parça
bittiğinde elin **bir kez** girdiği yere çizin: bitmiş ürün kasası, pres
tablası, paketleme bandı gibi.

**3. Puanlama** (`puanla` komutu, günlük):

```
ortalama = toplam iş / kadrodaki çalışan sayısı      (0 iş yapan da dahil)
oran     = kişinin işi / ortalama
oran > 1 + esik  →  puan = taban + (oran − 1) × 100 × katsayi   (en çok tavan)
aksi hâlde       →  0
```

Varsayılan: `taban 10, katsayi 0.5, tavan 50, esik 0`.
Örnek: ortalama 40, Ayşe 50 iş → oran 1.25 → 10 + 25×0.5 = **23 puan**.
Ortalamada ya da altında kalan puan kaybetmez, sadece kazanmaz.

**4. İzin.** `gun_basina_puan` (varsayılan 100) puan = 1 gün (`gunluk_saat`,
varsayılan 8 saat). `izin` komutu bakiyeden düşer; yetersiz bakiye reddedilir.

## Kurulum

```bash
cd izinkazan
pip install -r requirements.txt        # ultralytics, opencv, numpy
```

Model dosyası ilk çalıştırmada otomatik iner. GPU varsa PyTorch'un CUDA
sürümünü kurmanız yeterli; kod değişmez.

## Kullanım

```bash
# 0) YOLO'suz dene: sentetik 30 dakikalık vardiya, 5 çalışan
python -m izinkazan demo

# 1) Kameradan bir kare al, fareyle istasyon bölgelerini çiz → JSON çıktısı
python -m izinkazan bolge-ciz --kaynak 0            # 0 = USB kamera, ya da rtsp://... / video.mp4

# 2) ayarlar.ornek.json'u kopyala, bölgeleri ve çalışan adlarını gir
cp ayarlar.ornek.json ayarlar.json

# 3) İzle ve say (--goster ile bölgeler ve sayaçlar ekranda)
python -m izinkazan izle --ayar ayarlar.json --kaynak rtsp://kamera/akim --goster

# 4) Gün sonu puanla (aynı gün tekrar puanlanırsa üzerine yazar, çiftlemez)
python -m izinkazan puanla --ayar ayarlar.json [--gun 2026-11-07]

# 5) Rapor, panel, izin
python -m izinkazan rapor --ayar ayarlar.json
python -m izinkazan panel --ayar ayarlar.json --port 8000   # http://127.0.0.1:8000
python -m izinkazan izin  --ayar ayarlar.json --isci Ayşe --saat 4
```

Gün sonu puanlamayı otomatikleştirmek için cron:
`55 23 * * * cd /yol/izinkazan && python -m izinkazan puanla --ayar ayarlar.json`

## Ayarlar (`ayarlar.json`)

| Alan | Açıklama |
|---|---|
| `model` | `yolo11n-pose.pt` (hızlı) · `yolo11s-pose.pt` / `m` (daha isabetli) |
| `nokta` | `bilek` (poz modeli, önerilen) · `merkez` · `alt` (ayak hizası) |
| `kadro` | Ortalamaya dahil çalışanlar. Boşsa istasyonlara atananlar alınır |
| `istasyonlar[].isci` | O istasyonda yapılan iş bu kişiye yazılır. Boşsa `kisi-<takipNo>` |
| `istasyonlar[].min_saniye / max_saniye / cikis_toleransi` | Döngü süresi sınırları |
| `puan.taban / katsayi / tavan / esik / min_calisan` | Puan kuralı |
| `izin.gun_basina_puan / gunluk_saat` | Puan → izin dönüşümü |

**Kimlik:** İşi kişiye istasyon ataması üzerinden yazar; bu, takip numarası
değişse de (kişi kadrajdan çıkıp girince) doğru kalır. Vardiya değişiminde
ayar dosyasındaki `isci` alanını güncelleyin.

## Testler

```bash
python -m unittest discover -s tests -v
```

Geometri, sayaç (kısa temas, uzun bekleme, tespit kopması), puanlama, veritabanı
ve izin bakiyesi test edilir; YOLO gerektirmez.

## Dosyalar

```
izinkazan/
  detector.py   YOLO poz + ByteTrack → kişiler ve bilek noktaları
  counter.py    istasyon bölgeleri, iş döngüsü durum makinesi
  scoring.py    ortalamaya göre puan, puan → izin saati
  storage.py    SQLite: iş olayları, puan defteri, bakiye
  panel.py      bağımlılıksız web paneli (/ ve /api/ozet)
  cli.py        izle · puanla · rapor · izin · panel · bolge-ciz · demo
```

## Önemli: hukuk ve adalet

- **KVKK:** Kamerayla çalışan izlemek kişisel veri işlemektir. Çalışanları
  önceden yazılı bilgilendirin (aydınlatma metni), amacı "performans ve izin
  ödülü" ile sınırlayın, saklama süresini belirleyin. İzinKazan görüntü
  **kaydetmez**; veritabanında yalnızca iş sayısı ve zaman tutulur.
- **Ödül, ceza değil.** Sistem sadece ortalamanın üstüne çıkanı ödüllendirir;
  altında kalanı cezalandırmak için kullanılmamalı.
- **Eşit koşul.** Farklı zorluktaki istasyonları aynı ortalamada karşılaştırmak
  haksız olur. Benzer işleri aynı kadroda toplayın ya da her iş tipi için ayrı
  ayar dosyası ve veritabanı kullanın.
- Puanlamadan önce panelden sayıları kontrol edin; kamera açısı, ışık ve
  kapanma (bir kişinin önüne başkası geçmesi) sayımı etkileyebilir.
