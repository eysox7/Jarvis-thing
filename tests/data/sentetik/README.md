# Sentetik Türkiye seçmenleri (hayat öyküsü, travma, aile, çevre)

`node tests/data/sentetik_uret.mjs [kişi=3000] [tohum=2023]` ile üretilir. Gerçek kişi değildir.

| Dosya | İçerik |
|---|---|
| `TR_secmen.csv` | Ankette sorulabilecek sütunlar (`;` ayraçlı) — karar modeline doğrudan yüklenir |
| `TR_secmen_oyku.jsonl` | Her kişinin Türkçe hayat öyküsü (`kisi`, `oyku`); kişinin oyunu söylemez |
| `TR_il_sonuclari.csv` | İl düzeyinde "resmî sonuç" benzeri paylar (%) — `baglam.bolge_paylari` |

## Üretim zinciri (karar modelinin fayda denklemi kullanılmaz)

1. **Köken:** doğum yılı, doğum bölgesi (8 bölge, nüfus payları), kır/kent, etnik köken (Kürt/Arap/Türk; bölgeye göre), inanç (Alevi/Sünni), kardeş sayısı, ailenin sosyoekonomik durumu ve dindarlığı, babanın parti ailesi.
2. **Çocukluk (ACE):** yoksulluk/açlık, ev içi şiddet, ebeveyn kaybı, boşanma, evde bağımlılık, zorunlu göç (90'lar köy boşaltmaları), itaat bekleyen sert ceza; terör/çatışma maruziyeti, şehit yakını.
3. **Değerler:** otoriter yatkınlık = aile dindarlığı + sert terbiye + travma − eğitim (Stenner; Adorno); tehdit algısı = terör, şehit yakını, mülteci yoğunluğu × otoriterlik (Stenner; Fromm); dindarlık; siyasete ilgi.
4. **Yetişkinlik:** iç göç (İstanbul/batı), eğitim (aile SES, kuşak, cinsiyet × bölge), çalışma (kadın işgücü düşük), meslek, gelir, iş kaybı, borç; 1999 ve 2023 depremleri (il bazlı), depremde kayıp.
5. **Çevre:** evlilik ve çocuklar; eşin oyu (homogami ρ≈0.78 + eşin kendi eğilimi); 3–8 kişilik tartışma ağı (homofili, ölçüm hatalı beyan); mahalle payı (il sonucu etrafında); medya (hükümete yakın / muhalif kanal veya sosyal medya hesapları).
6. **Oy:** partiye özgü gizli faydalar (dindarlık, otoriterlik × tehdit, babanın partisi, medya, ekonomik zarar × partizan sadakat, Alevi/Kürt kimliği, zorunlu göç × Kürt kimliği, deprem kaybı → iktidarı cezalandırma, travma → katılmama) + gözlenmeyen kişisel eğilim + eş/ağ/mahalle etkisi + Gumbel gürültü. Sabitler toplam paylara kalibre edilir. Önceki oy (5 yıl önce) aynı eğilim + o günün koşullarıyla üretilir.

Ölçülen sütunlar gizli değişkenlerin gürültülü ölçümüdür (otoriterlik 4 maddelik batarya gibi 0,25 adımlı; ideoloji, güven, ekonomi algısı partizan güdümlü akıl yürütme içerir).

## Kalibrasyon hedefleri ve gözlenen değerler (tohum 2023)

| Ölçüt | Hedef / kaynak düzeyi | Veride |
|---|---|---|
| Oy dağılımı (katılmama dahil) | iktidar ~43, ana muhalefet ~29, milliyetçi ~8, Kürt hareketi ~8, katılmama ~12 | 43,2 / 28,4 / 8,3 / 8,1 / 12,0 |
| Eğitim | ilkokul ~%33, lise ~%40, üniversite ~%21, lisansüstü ~%6 | aynı |
| En az bir çocukluk zorluğu (sert ceza dahil) | Türkiye ACE çalışmalarında yüksek | %71 |
| Eşle aynı oy | %65–80 | %68 |
| 2018 dağılımı (iktidar / ana muh. / milliyetçi / Kürt / katılmama) | ~46 / 20 / 8,5 / 10 / 15,5 | 45,4 / 20,4 / 8,6 / 10,5 / 15,1 |
| İki seçimde (2018 → 2023) aynı oy | %75–80 | %79 |
| Alevi seçmende ana muhalefet | çok yüksek | %84 |
| Kürt seçmende Kürt hareketi / iktidar | ~%40–55 / ~%25–35 | %44 / %30 |

Değerler yaklaşıktır; amaç kesin seçim tahmini değil, kuramların ve hayat öyküsünün model başarısına katkısını gerçekçi ve döngüsel olmayan bir veride ölçmektir.

## 2018 dalgası (panel)

Aynı kişiler 2018 koşullarında da oy verir (`onceki` sütunu): ekonomik zarar daha az (iş kaybının
~%35'i, borcun %60'ı o tarihte vardı), 2023 depremi yok (yalnız 1999), tehdit algısı ve güvenlik
gündemi daha yüksek, sığınmacı gündemi daha zayıf; kalıcı parti bağlılığı iki dalgayı bağlar. 2018
dönemine ait ölçümler `*_2018` sütunlarındadır (`ekonomi_algisi_2018`, `hane_algisi_2018`,
`tehdit_algisi_2018`, `is_kaybi_2018`, `borc_yuku_2018`, `deprem_maruziyeti_2018`). Dalga ayrı bir
rastgele akışla üretilir; 2023 sütunları ve öyküler bundan etkilenmez. Aktarım testi:
`node tests/realdata.mjs --secimler-tr`.

