# Oturum kaydı: kalabalık tahliye prototipi

Bu dosya otonom çalışma oturumunun durum kaydıdır. Her uyanışta güncellenir, commit'lenir ve push'lanır.
Oturum kesilirse (kota, container kapanması) çalışma buradan devam eder.

## Oturum
- Başlangıç: 2026-10-15 16:40 UTC
- Planlanan bitiş: 2026-10-15 19:40 UTC (3 saat)
- Uyanma aralığı: 10 dakika (toplam 18 uyanış)
- Dal: `ccr-d833b36c-mcm2st`

## Hedef
Konuşmada önerilen prototip: 2D mekânda yaya simülasyonu (social force modeli),
farklı persona tipleri ve tahliye sırasında kapıları/anonsları yöneten bir MCTS ajanı.
Bağımlılıksız vanilla JS, repo'nun geri kalanıyla aynı tarz. `lab/crowd-sim/` altında, ana uygulamaya dokunmadan.

## Yol haritası
- [ ] 1. Social force simülatörü (ajanlar, duvarlar, çıkışlar, yoğunluk ölçümü)
- [ ] 2. Persona tipleri (hız, tepki gecikmesi, anons uyumu, panik eğilimi)
- [ ] 3. Müdahale (eylem) uzayı: kapı aç/kapa, çıkışa yönlendirme anonsu
- [ ] 4. MCTS ajanı (simülasyonu kopyalayıp ileri sarar, ödül = tahliye süresi + yoğunluk cezası)
- [ ] 5. Karşılaştırma: müdahalesiz / sabit kural / MCTS
- [ ] 6. Testler (`tests/` altındaki mevcut düzene uygun)
- [ ] 7. Tarayıcıda görselleştirme sayfası
- [ ] 8. README

## Uyanış günlüğü
| # | Zaman (UTC) | Yapılan | Sonraki adım |
|---|---|---|---|
| 0 | 16:40 | Oturum başladı, plan yazıldı, 10 uyanış kuruldu | Adım 1 |

## Kesinti / kota
- Kalan kotayı içeriden göremiyorum. Bir hata mesajı sıfırlanma saati verirse buraya yazılır ve o saate uyanış kurulur.
