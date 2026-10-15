# Emeklilik yaşı reformu

*Karar Laboratuvarı raporu · 15.10.2026 18:14:49 · Kamu politikası*

> **Örnek çıktı:** sentetik nüfusla, kısa bir eğitimle (6 iterasyon) üretildi; gerçek veri içermez.

> Bu rapordaki sayılar bir simülasyon modelinin tahminidir; gerçek kamuoyu/pazar araştırmasının yerini tutmaz. Varsayımlar aşağıda açıkça listelenmiştir.

Sosyal güvenlik sisteminin finansman açığını kapatmak için emeklilik yaşının yükseltilmesi ve geçiş düzenlemeleri.

## Nüfus

300 persona, kaynak: **sentetik örnek nüfus** (gerçek veri değil). Segmentler: `age_bracket` (25-34, 35-44, 55-64, 45-54, 65+, 18-24).

Model **kalibre edilmedi** (seçenek etkileri varsayımdır).

## Hedef fonksiyonu

| Bileşen | Ağırlık |
| --- | --- |
| Etkinlik (dönem ort.) | 0.40 |
| Destek | 0.35 |
| En düşük segment | 0.25 |
| Kutuplaşma (−) | 0.30 |

## Karşılaştırma

| Strateji | Hedef skoru | Destek (dönem sonu) | En düşük segment |
| --- | --- | --- | --- |
| Başlangıç tasarımı | 0.506 | %26 | %20 |
| En iyi statik tasarım | 0.600 | %54 | %51 |
| AlphaZero planı | 0.697 | %71 | %68 |

### Başlangıç tasarımı
- Yeni emeklilik yaşı: 67
- Geçiş: Yürürlüğe girdiği yıl herkes için
- Koruma düzenlemesi: Yok
- Esneklik: Sabit yaş

## Önerilen plan (AlphaZero)

- **Tasarım:** Yeni emeklilik yaşı → 65 (en iyi statik tasarımdan)
- **Tasarım:** Geçiş → 15 yılda kademeli (yaşa yakın olanlar etkilenmez) (en iyi statik tasarımdan)
- **Tasarım:** Koruma düzenlemesi → En düşük emekli aylığı yükseltilir (en iyi statik tasarımdan)
- **Tasarım:** Tasarım onaylandı, uygulama başladı
- **1. ay:** Sistemin finansman durumunu açıklayan bilgilendirme
- **9. ay:** Sistemin finansman durumunu açıklayan bilgilendirme

Sonuç: Etkinlik (dönem ort.) 0.78 · Destek 0.66 · En düşük segment 0.68 · Kutuplaşma (−) 0.05 · Bütçe aşımı (−) 0.00

### Segmentlere göre

| Segment | Başlangıç | Plan | Fark |
| --- | --- | --- | --- |
| 25-34 | %27 | %74 | +46 |
| 35-44 | %27 | %72 | +46 |
| 55-64 | %22 | %69 | +47 |
| 45-54 | %29 | %68 | +39 |
| 65+ | %20 | %71 | +51 |
| 18-24 | %34 | %74 | +40 |

### Neden bu plan?

Her adım plandan çıkarılıp sonuç yeniden hesaplandı. Katkı: adım olmasaydı skor ne kadar düşerdi.

| Ne zaman | Adım | Katkı | En çok yaradığı segment |
| --- | --- | --- | --- |
| tasarım | Geçiş → 15 yılda kademeli (yaşa yakın olanlar etkilenmez) | +0.221 | 65+ (+46) |
| tasarım | Koruma düzenlemesi → En düşük emekli aylığı yükseltilir | +0.069 | 18-24 (+23) |
| tasarım | Yeni emeklilik yaşı → 65 | +0.065 | 65+ (+19) |
| 1. ay | Sistemin finansman durumunu açıklayan bilgilendirme | +0.057 | 65+ (+11) |
| 9. ay | Sistemin finansman durumunu açıklayan bilgilendirme | +0.012 | 65+ (+3) |

## Sağlamlık testi

Planlar, seçenek etkileri rastgele bozulmuş alternatif dünyalarda yeniden oynatıldı.

| Plan | Ortalama | Kötü durum (%10) | İyi durum (%90) | En iyi olduğu dünyalar |
| --- | --- | --- | --- | --- |
| Başlangıç tasarımı | 0.505 | 0.501 | 0.510 | %0 |
| En iyi statik tasarım | 0.595 | 0.574 | 0.618 | %0 |
| AlphaZero planı | 0.685 | 0.636 | 0.737 | %100 |

## Varsayımlar ve sınırlar

- Kişilerin seçeneklere tepkisi, persona boyutlarından türetilen eğilimler ve senaryoda yazılan etki ağırlıklarıyla hesaplanır; bunlar varsayımdır.
- Zaman içindeki değişim (bilgilenme, çevre etkisi, alışkanlık) basitleştirilmiş bir modeldir.
- Simüle edilmiş personalar (LLM/MatrAIx) gerçek insanlardan daha tutarlı ve uyumlu olma eğilimindedir.
- Önemli kararlar gerçek kullanıcı/vatandaş araştırmasıyla doğrulanmalıdır.

## Seçenekler ve varsayılan etkiler

**Yeni emeklilik yaşı**

- 65: genel -0.1; security -0.3, habit -0.3; amaca katkı 0.55
- 67: genel -0.5; security -0.7, habit -0.6, fairness -0.2; amaca katkı 0.85
- 67, sonra yaşam süresine bağlı: genel -0.7; security -0.9, habit -0.6, trust +0.4, novelty +0.2; amaca katkı 1

**Geçiş**

- Yürürlüğe girdiği yıl herkes için: genel -0.4; habit -0.7, security -0.4; amaca katkı 1
- 15 yılda kademeli (yaşa yakın olanlar etkilenmez): genel 0.2; fairness +0.4, habit +0.4, security +0.3; amaca katkı 0.75

**Koruma düzenlemesi**

- Yok: genel 0; fairness -0.5; amaca katkı 1
- Ağır ve yıpratıcı işlerde erken emeklilik korunur: genel 0.15; fairness +0.7, security +0.3; amaca katkı 0.9
- En düşük emekli aylığı yükseltilir: genel 0.2; fairness +0.5, price +0.6, security +0.4; amaca katkı 0.8

**Esneklik**

- Sabit yaş: genel 0; eğilim etkisi yok; amaca katkı 1
- Kesintili erken ya da primli geç emeklilik seçeneği: genel 0.15; novelty +0.3, time +0.3, trust +0.2; amaca katkı 0.9
