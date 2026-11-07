# İzinKazan

Kamera görüntüsünden **YOLO** ile çalışanların hareketini takip eder, her
istasyonda yapılan **işi sayar**, günün sonunda **ortalamanın belirgin
üstünde iş yapanlara puan** verir. Biriken puan **izne** (haftada en çok
1 gün) ya da **nakit avansa** (aylık sınırlı) çevrilir.

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

Varsayılan: `taban 5, katsayi 0.5, tavan 30, esik 0.10`. Yani puan için
ortalamanın **en az %10 üstüne** çıkmak gerekir.

| Ortalama 40 iken | Oran | Puan |
|---|---|---|
| 43 iş | 1.075 | 0 (eşiğin altında) |
| 50 iş | 1.25 | 5 + 12.5 = **18** |
| 60 iş ve üstü | ≥ 1.50 | **30** (tavan) |

Ortalamada ya da altında kalan puan kaybetmez, sadece kazanmaz.

**4. Puan harcama: izin veya nakit avans.** İkisi de aynı bakiyeden düşer.

| | Fiyat | Sınır |
|---|---|---|
| **İzin** | 1 gün (8 saat) = **150 puan**, saatlik de alınabilir | **Haftada en çok 8 saat** (1 gün), Pazartesi–Pazar, iznin kullanıldığı güne göre |
| **Nakit avans** | **1 puan = 5 TL** | **Ayda en çok 2.000 TL**, tek seferde en az 100 TL |

Bu sayılar "bir gün çalış, bir gün izin" olmasın diye seçildi:

- 1 gün izin = 150 puan = **5 gün boyunca tavan puan** (her gün ortalamanın %50
  üstü). Yani haftada 1 gün izin ancak olağanüstü performansla kazanılır.
- Ortalamanın %25 üstünde çalışan biri günde ~18 puan alır, yaklaşık
  **2 haftada 1 gün** izin biriktirir.
- Puan biriktirilmiş olsa bile haftalık sınır aşılamaz: 1000 puanı olan biri
  de aynı haftaya 2 gün izin koyamaz.

Hepsi `ayarlar.json` içinden değiştirilebilir (`puan`, `izin`, `avans`
blokları). Avansı tamamen kapatmak için `"avans": {"acik": false}`.

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
python -m izinkazan izin  --ayar ayarlar.json --isci Ayşe --saat 8 --tarih 2026-11-13
python -m izinkazan avans --ayar ayarlar.json --isci Ayşe --tl 500
```

Sınırı aşan talep nedeniyle birlikte reddedilir:

```
Reddedildi: Haftalık izin sınırı: 2026-11-09 haftasında Ayşe 8 saat kullanmış, en çok 8 saat. O hafta kalan: 0 saat
Reddedildi: Aylık avans sınırı: Ayşe bu ay 1800 TL çekmiş, en çok 2000 TL. Kalan: 200 TL
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
| `izin.gun_basina_puan / gunluk_saat / haftalik_max_saat` | İzin fiyatı ve haftalık sınır |
| `avans.acik / puan_basina_tl / aylik_max_tl / min_tl` | Avans fiyatı ve aylık sınır |

**Kimlik:** İşi kişiye istasyon ataması üzerinden yazar; bu, takip numarası
değişse de (kişi kadrajdan çıkıp girince) doğru kalır. Vardiya değişiminde
ayar dosyasındaki `isci` alanını güncelleyin.

## Testler

```bash
python -m unittest discover -s tests -v
```

Geometri, sayaç (kısa temas, uzun bekleme, tespit kopması), puanlama, veritabanı,
haftalık izin ve aylık avans sınırları, eski veritabanının yükseltilmesi test
edilir; YOLO gerektirmez.

## Dosyalar

```
izinkazan/
  detector.py   YOLO poz + ByteTrack → kişiler ve bilek noktaları
  counter.py    istasyon bölgeleri, iş döngüsü durum makinesi
  scoring.py    ortalamaya göre puan
  odul.py       izin ve nakit avans: fiyatlar, haftalık/aylık sınırlar
  storage.py    SQLite: iş olayları, puan defteri, bakiye
  panel.py      bağımlılıksız web paneli (/ ve /api/ozet)
  cli.py        izle · puanla · rapor · izin · avans · panel · bolge-ciz · demo
```

## Önemli: hukuk ve adalet

- **KVKK:** Kamerayla çalışan izlemek kişisel veri işlemektir. Çalışanları
  önceden yazılı bilgilendirin (aydınlatma metni), amacı "performans ve izin
  ödülü" ile sınırlayın, saklama süresini belirleyin. İzinKazan görüntü
  **kaydetmez**; veritabanında yalnızca iş sayısı ve zaman tutulur.
- **Avans ve bordro.** Avans olarak ödenen tutarın maaştan mahsup mu
  edileceği, prim mi sayılacağı muhasebe/bordro kararıdır; İzinKazan sadece
  puan defterini tutar, ödeme yapmaz. Kullanmadan önce muhasebeyle netleştirin.
- **Ödül, ceza değil.** Sistem sadece ortalamanın üstüne çıkanı ödüllendirir;
  altında kalanı cezalandırmak için kullanılmamalı.
- **Eşit koşul.** Farklı zorluktaki istasyonları aynı ortalamada karşılaştırmak
  haksız olur. Benzer işleri aynı kadroda toplayın ya da her iş tipi için ayrı
  ayar dosyası ve veritabanı kullanın.
- Puanlamadan önce panelden sayıları kontrol edin; kamera açısı, ışık ve
  kapanma (bir kişinin önüne başkası geçmesi) sayımı etkileyebilir.
