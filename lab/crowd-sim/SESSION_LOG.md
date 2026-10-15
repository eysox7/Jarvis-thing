# Oturum kaydı: kalabalık tahliye prototipi

Bu dosya otonom çalışma oturumunun durum kaydıdır. Her uyanışta güncellenir, commit'lenir ve push'lanır.
Oturum kesilirse (kota, container kapanması) çalışma buradan devam eder.

## Oturum
- Başlangıç: 2026-10-15 16:40 UTC
- Planlanan bitiş: 2026-10-15 19:40 UTC (3 saat)
- Uyanma aralığı: 10 dakika (toplam 18 uyanış)
- 1. parti: 16:52, 17:02 … 18:22 UTC (10 adet). 2. parti (uyanış #1'de kurulacak): 18:32 … 19:42 UTC (8 adet)
- Dal: `ccr-d833b36c-mcm2st`

## Hedef (kullanıcı tarafından 16:50'de netleştirildi)
AlphaZero mantığını MatrAIx'e entegre etmek: kitle psikolojisi / tahliye senaryosu.
Kullanıcı notu: **test dosyası yazılmayacak** (kota). Sadece kısa duman koşuları.

## Mimari
```
MatrAIx anket görevi (matraix/tasks/evacuation-announcement-response)
   → personalar anonslara nasıl tepki verdiğini cevaplar (survey_result.json)
matraix/calibrate.py
   → persona YAML + cevaplar → persona-params.json (uyum, gecikme, sürü, panik, hız)
personas.js  → parametreleri yükler; veri yoksa MatrAIx boyutlarından önsel eşleme
sim.js       → social force + persona davranışı (anons, gecikme, sürü, panik)
env.js       → AlphaZero "oyunu": durum kodlama, eylemler (kapı/anons), ödül
nn.js        → saf JS MLP, policy + value başı, Adam
mcts.js      → PUCT araması (AlphaZero)
alphazero.js → self-play → tampon → eğitim → arena
cli.mjs      → train / eval / compare
matraix/export_plan.py (sonra) → en iyi planı MatrAIx'e doğrulama anketi olarak geri gönder
```
MatrAIx bilgileri (raw.githubusercontent üzerinden okundu; HF erişimi proxy'de 403):
- Persona YAML: `persona_id`, `dimensions:` (kategorik), `provenance`
- Anket görevi: `task.toml`, `instruction.md`, `input/context.md`, `input/questionnaire.yaml`,
  `persona_strategy.json`, `reporting.json`, `tests/`; çıktı `/app/output/survey_result.json`
  → `{answers:[{questionId,value,rationale?,confidence?}], trajectory:[...]}`

## Yol haritası
- [x] 1. Social force simülatörü → `sim.js`
- [x] 2. Persona davranışı (sim.js) + `personas.js`
- [x] 3. `env.js` (eylem uzayı, durum kodlama, ödül)
- [x] 4. `nn.js`
- [x] 5. `mcts.js`
- [x] 6. `alphazero.js` + `cli.mjs`
- [x] 7. MatrAIx anket görevi + `calibrate.py`
- [ ] 8. Eğitim koşusu, karşılaştırma (müdahalesiz / kural / AlphaZero)
- [x] 9. `export_plan.py` (doğrulama döngüsü)
- [~] 10. Görselleştirme sayfası (`index.html`, bitti) + README (sırada)

## YENİ HEDEF (17:06'dan itibaren): Karar Laboratuvarı — `lab/decision-lab/`
Pazarlama ve kamu politikası kararlarında nüfus tepkisini simüle eden sistem + arayüz.
- [x] A. Ortak çekirdek: `lab/core/` (nn.js, mcts.js, rng) — crowd-sim de buradan kullanır
- [x] B. Nüfus modeli: MatrAIx YAML içe aktarma, sentetik örnek nüfus, segmentler
- [x] C. Senaryo modeli + şablonlar (ürün lansmanı, politika reformu)
- [x] D. Hızlı tepki motoru: boyut→tercih ağırlıkları, lojistik seçim, sosyal yayılım (zaman adımlı)
- [x] E. AlphaZero ortamı: zaman adımlı kararlar, açık hedef fonksiyonları (pazarlama: benimseme+memnuniyet−terk; politika: destek + en düşük segment − kutuplaşma)
- [x] F. LLM persona motoru (NEXUS API bağlantılarını kullanır) + kalibrasyon
- [x] G. Arayüz: Nüfus / Senaryo / Tahmin / Strateji / Doğrulama sekmeleri (mobil uyumlu, NEXUS tarzı)
- [x] H. MatrAIx dışa aktarma (senaryo → anket görevi, sonuç → kalibrasyon)
- [x] I. README

## Uyanış günlüğü
| # | Zaman (UTC) | Yapılan | Sonraki adım |
|---|---|---|---|
| 0 | 16:40 | Oturum başladı, plan yazıldı, 1. parti uyanışlar kuruldu (16:52 → 18:22 UTC) | Adım 1 |
| 0b | 16:45 | `sim.js` yazıldı. Deterministik, klonlanabilir. 150 kişi/2 kapı: 46.8 sn; tek kapı: 82.4 sn (~1.8 kişi/sn, literatürle uyumlu). 300 kişi ≈ 1 sn hesap | Adım 2: personalar |

| 0c | 16:48 | Görev netleşti (AlphaZero × MatrAIx). MatrAIx şeması incelendi. Persona davranışı + `personas.js` + `env.js` yazıldı. Bulgu: salon geneli anons herkesi tek kapıya yığıyor → anonslar kapı başı hoparlör (12 m) yapıldı. Senaryo: 199 kişi, 4 kapı; müdahalesiz maliyet 86/69, iyi elle planlar 53-60 | Adım 4-6: nn, mcts, alphazero |

| 0d | 16:52 | `nn.js` (saf JS MLP, policy+value, Adam), `mcts.js` (PUCT, Dirichlet gürültü, alt ağaç yeniden kullanımı), `alphazero.js` (self-play, tampon, arena kapı bekçisi), `worker.mjs` (4 çekirdek paralel), `cli.mjs` (train/compare/plan). Duman koşusu OK. Arka planda asıl eğitim başlatıldı: 30 iter × 8 oyun, 16 sim, 200 kişi → `models/` | Eğitim sürerken: MatrAIx görevi + calibrate.py |

| 0e | 16:57 | İlk eğitim yanlış klasörden başladığı için hemen bitti, mutlak yolla yeniden başlatıldı (~28 sn/iter). MatrAIx görevi `matraix/tasks/survey_evacuation-announcement-response/` (9 soru, her biri bir parametre) + doğrulayıcı + `matraix/calibrate.py`. Sahte job çıktısıyla uçtan uca doğrulandı (scratchpad'de, repoya test eklenmedi) | Eğitim bitince: compare, plan; sonra export_plan.py, görselleştirme, README |

| 1 | 16:54 | Uyanış #1: 2. parti uyanışlar kuruldu (18:32 … 19:42 UTC, 8 adet; toplam 18). `matraix/export_plan.py` (plan → MatrAIx doğrulama anketi + karşılaştırma) yazıldı | — |
| 1b | 17:00 | Doğrulama döngüsü ilk denemede iki simülatör açığını gösterdi: AlphaZero (a) ana girişe "ana giriş tıkalı" gerekçeli anons yapıyor, (b) aynı anonsu 9 kez tekrarlıyor. Düzeltme: anons yorgunluğu (30 sn içinde her tekrar uyumu ½), ana girişe gerekçeli anons yasak, müdahale bedeli 0.5→1.5. Eski model silindi, eğitim baştan (40 iter) | Eğitim bitince compare/plan, görselleştirme, README |

| 1c | 17:08 | Kullanıcı sordu: "eski modeli sildim" ne demek → açıklandı (sadece ağırlık dosyası, git'te `e6da6c9`'da duruyor). `index.html` görselleştirme yazıldı, headless Chromium'da çalıştığı görüldü. Bulgu: run1 policy'si yine anons yağdırıyor (16/17 eylem müdahale, tekdüze öncel + 16 sim yetersiz). run1 `models/run1/`'e taşındı (silinmedi). Düzeltme: "bekle" eylemine başlangıç önceliği (bias 2.5), sim 16→32. Arena kıyası: müdahalesiz 76.2, kural 60.7, run1 68.1 | Yeni eğitim (30 iter, ~25 dk) |

| 1d | 17:06 | **YÖN DEĞİŞİKLİĞİ (kullanıcı):** konser/tahliye değil; insanların kararları — pazarlama ve siyasi/kamu politikası kararları. Arayüz + sistem istendi. Konser eğitimi durduruldu, `lab/crowd-sim/` olduğu gibi bırakıldı. Yeni iş: `lab/decision-lab/` (aşağıdaki yeni yol haritası). Sınır: politika tasarımı + tepki tahmini evet; seçmen segmentine göre ikna/mikrohedefleme optimizasyonu hayır (kullanıcıya söylendi) | decision-lab çekirdeği |

| 1e | 17:10 | `lab/core/` (nn, mcts, rng; crowd-sim de buradan). `decision-lab/`: population.js (MatrAIx YAML ayrıştırıcı, 10 eğilim + eşleme tablosu, sentetik nüfus, segmentler), scenarios.js (2 şablon: araç giriş ücreti / fitness uygulaması), model.js (fayda + aylık dinamik + açık hedef fonksiyonu + tasarım evresi), az.js. Bulgu: AlphaZero "düşük ücretle başla, son ay 120 TL'ye çık" (yem-ve-değiştir) buldu → etkinlik dönem ortalaması yapıldı. Sonuç (politika): taban 0.446, en iyi statik 0.575, AlphaZero 0.682; en düşük segment desteği 0.21→0.68 | G. arayüz |

| 1f | 17:25 | Arayüz: `decision-lab/index.html` + `app.js` (5 sekme), `az-worker.js` (eğitim ayrı iş parçacığında + kaba kuvvet statik kıyas), `llm.js` (NEXUS API profilleriyle persona canlandırma, segment kalibrasyonu), `matraix.js` (senaryo → MatrAIx görev betiği .sh; sonuç klasörü okuma). Headless Chromium'da sahte LLM API ile uçtan uca gezildi (scratchpad, repoya test eklenmedi): hata yok; AZ 4 iterasyonda 0.446→0.589 (statik en iyi 0.575); 12 persona soruldu; kalibrasyon; .sh betiği geçerli görev üretiyor. Düzeltilen hatalar: worker'a iş gönderilmiyordu; kalibrasyon sonuçları siliyordu; label butonları stilsizdi | I. README; NEXUS'tan bağlantı |

| 1g | 17:20 | `decision-lab/README.md` + kök README'ye "Laboratuvar" bölümü | Sıradaki uyanışlarda: kendi senaryonu oluşturma kolaylığı (JSON yerine form), gerçek veriyle deneme rehberi, iyileştirmeler |

## Kesinti / kota
- Kalan kotayı içeriden göremiyorum. Bir hata mesajı sıfırlanma saati verirse buraya yazılır ve o saate uyanış kurulur.
