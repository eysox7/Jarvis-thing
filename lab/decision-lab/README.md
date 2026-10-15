# Karar Laboratuvarı

İnsanların kararlara nasıl tepki vereceğini simüle eden ve en iyi stratejiyi **AlphaZero** ile
arayan bir sistem. **Pazarlama** (ürün, fiyat, lansman) ve **kamu politikası** (bir düzenlemenin
tasarımı ve uygulanışı) için. Nüfus **MatrAIx** personalarından gelir; tepkiler hızlı bir modelle
tahmin edilir ve LLM personalarıyla ya da MatrAIx anketleriyle doğrulanıp kalibre edilir.

Açmak için repo kökünde `python3 -m http.server 8080` → `http://localhost:8080/lab/decision-lab/`
(ya da GitHub Pages adresinin sonuna `/lab/decision-lab/`). Kurulum yok, derleme yok.

## Nasıl çalışır

```
Nüfus (MatrAIx personaları)        Senaryo (kararlar, seçenekler, eylemler, hedef)
   │  boyutlar → 10 eğilim            │  her seçeneğin eğilimlere etkisi
   └──────────────┬───────────────────┘
                  ▼
      Hızlı tepki modeli (model.js) ── ay ay: haberdar olma / bilgilenme, destek / benimseme,
                  │                    çevre etkisi, alışkanlık, güvenilirlik
                  │
     ┌────────────┼──────────────────────────────┐
     ▼            ▼                              ▼
  Tahmin      AlphaZero (az.js)               Doğrulama
  "bu tasarım  tasarım evresi + aylık eylemler   LLM personaları (N.E.X.U.S. API bağlantıları)
  kimde nasıl  MCTS + policy/value ağı           MatrAIx anket görevi (.sh) ve sonuç yükleme
  karşılanır?" self-play → eğitim → arena        → segment kalibrasyonu → modele geri
```

### Sekmeler

| Sekme | Ne yapar |
|---|---|
| **Senaryo** | Şablon seç (araç giriş ücreti politikası, fitness uygulaması lansmanı) ya da JSON ile kendi senaryonu yaz. Hedef fonksiyonu ağırlıklarını ayarla. |
| **Nüfus** | MatrAIx persona YAML/JSON içe aktar ya da sentetik örnek nüfus kullan. Segment boyutunu seç; segmentlerin eğilim profillerini ve boyut→eğilim eşleme tablosunu gör. |
| **Tahmin** | Kararları seç; genel ve segment bazında destek/benimseme, zaman serisi ve "neden?" tablosu (her kararın her segmentteki etkisi). |
| **Strateji** | AlphaZero'yu çalıştır. Başlangıç tasarımı, tüm statik tasarımların en iyisi (kaba kuvvet) ve AlphaZero planı yan yana. Plan zaman çizelgesi olarak. **Sağlamlık testi:** planlar, seçenek etkileri rastgele bozulmuş onlarca alternatif dünyada yeniden oynatılır; plan yalnızca modelin tam doğru olduğu dünyada iyiyse güvenme. |
| **Doğrulama** | Örnek personaları bir LLM'e kendi kimlikleriyle sor; cevapları modelle karşılaştır, modeli kalibre et. MatrAIx anket görevini indir, sonuç klasörünü yükle. |

### AlphaZero nereden başlar?

Önce tüm statik tasarımlar (her karar için bir seçenek, eylem yok) kaba kuvvetle denenir. AlphaZero
en iyi statik tasarımdan başlar ve onu zamanlama, tek seferlik eylemler ve ek tasarım değişiklikleriyle
geliştirmeye çalışır. İlk sürümde sıfırdan başlıyordu; eğitimsiz ağla çok adımlı tasarım keşfi zor
olduğu için sık sık statik en iyinin altında kalıyordu. Ölçüm (300 persona, 20 iterasyon / 6 oyun /
64 arama, ~25 sn):

| Senaryo | Başlangıç | En iyi statik | AlphaZero | Sağlamlık (40 dünya) |
|---|---|---|---|---|
| Araç giriş ücreti | 0.446 | 0.575 | 0.70–0.71 | %100 |
| Fitness uygulaması | 0.246 | 0.451 | 0.59–0.62 | %100 |

### Hedef fonksiyonu

AlphaZero neyi en iyilediğini bilmeli; bu yüzden hedef açık ve ayarlanabilir:

- **Politika:** etkinlik (dönem ortalaması) + destek + **en düşük segmentin desteği** − **kutuplaşma** − bütçe aşımı.
  Sadece "çoğunluğu kazan" değil, kimseyi geride bırakmayan ve toplumu bölmeyen tasarım ödüllendirilir.
- **Pazarlama:** gelir + benimseme + **memnuniyet** − **bırakma** − bütçe aşımı.
  İnsanları ürüne çekip memnun etmeyen strateji (yüksek bırakma) cezalandırılır.

Kararlar sonradan değiştirildikçe güvenilirlik düşer (her değişiklik bedelli). Etkinlik dönem boyunca
ortalanır: ilk sürümde AlphaZero "düşük ücretle başla, son ay ücreti üç katına çıkar" stratejisini
bulmuştu (son durumu iyi gösterip desteği önceden toplamak). Bu tür açıkları bulmak, simülasyonla
öğrenen bir sistemin doğasında var; hedef fonksiyonunun açık ve denetlenebilir olması bu yüzden önemli.

### Kapsam sınırı

Sistem **kararın kendisini** (ürünü, fiyatı, politikanın tasarımını, uygulama zamanlamasını) ve
herkese açık, doğru bilgilendirmeyi arar. Kişilerin psikolojik özelliklerine göre bölünmüş gruplara
farklı ikna mesajları hedefleyen bir eylem türü **bilinçli olarak yoktur**; özellikle siyasi
bağlamda bu, kitlesel manipülasyon aracına dönüşür.

## Dosyalar

| Dosya | İçerik |
|---|---|
| `population.js` | MatrAIx YAML ayrıştırıcı, eğilimler ve boyut→eğilim kuralları, sentetik nüfus, segmentler |
| `scenarios.js` | Senaryo şablonları ve şema |
| `model.js` | Fayda, aylık dinamik, hedef fonksiyonu, AlphaZero ortam arayüzü |
| `az.js`, `az-worker.js` | AlphaZero eğitimi (tarayıcıda Web Worker) |
| `llm.js` | LLM persona canlandırma ve segment kalibrasyonu |
| `matraix.js` | MatrAIx anket görevi üretimi ve sonuç okuma |
| `app.js`, `index.html` | Arayüz |
| `../core/` | Ortak AlphaZero çekirdeği: `nn.js` (policy+value ağı), `mcts.js` (PUCT), `rng.js` |

## MatrAIx ile

1. **Nüfus** → MatrAIx `persona/datasets/<dataset>/*.yaml` dosyalarını seç (veya `calibrate.py` JSON çıktısı).
2. **Doğrulama** → "Anket görevini indir". MatrAIx-Persona-8B deposunun kökünde:
   ```bash
   bash survey_decision-<senaryo>.sh
   uv run python application/scripts/generate_application_job.py \
     --task application/tasks/survey_decision-<senaryo> --execution-mode auto --sample-size 50
   # yazdırılan harbor komutunu çalıştır
   ```
3. **Doğrulama** → "Sonuç klasörünü yükle" → `jobs/<job>` klasörünü seç. Persona kimlikleri içe
   aktarılan nüfusla eşleşirse segment kalibrasyonu yapılabilir.

## Bilinen sınırlar

- Boyut→eğilim kuralları ve seçenek etkileri **varsayımdır**. Kalibrasyon yalnızca segment düzeyinde
  sabit bir düzeltme yapar; etkilerin kendisini öğrenmez.
- LLM personaları gerçek insanlardan daha tutarlı ve uyumlu olma eğilimindedir. Anketler "ne yapardın"
  sorar; söylenenle yapılan farklı olabilir.
- Görev biçimi MatrAIx'in örnek anket görevinden kopyalandı; MatrAIx içinde henüz koşturulmadı.
- Ağ küçük, eğitim tarayıcıda ve kısa; çıkan plan bir başlangıç önerisidir.
- Otomatik test yok.

> Bu bir karar destek aracıdır. Önemli kararlar gerçek kullanıcı ve vatandaş araştırmasıyla doğrulanmalıdır.
