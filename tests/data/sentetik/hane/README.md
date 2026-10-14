# Hane temelli sentetik Türkiye seçmenleri (yaşam seyri mikrosimülasyonu)

`node tests/data/hayat_uret.mjs [hane=1300] [tohum=2024]` ile üretilir. Gerçek kişi değildir.

Önceki sentetik veriden (`../TR_secmen.csv`) farkı: aile soyut bir sütun değil. Önce **hane** kurulur;
hanedeki her yetişkinin (eş, evde yaşayan yetişkin çocuk, dul kalmış yaşlı ebeveyn) hayatı doğumdan bugüne
yıl yıl yazılır ve hepsi seçmendir. Eşin oyu, babanın oyu, kardeşin oyu birbirine bağlı gerçek kişilerin
oylarıdır.

| Dosya | İçerik |
|---|---|
| `TR_hane_secmen.csv` | Ankette sorulabilecek sütunlar (`;` ayraçlı); `hane` kimliği model girdisi değildir |
| `TR_hane_oyku.jsonl` | Her kişinin ayrıntılı hayat öyküsü (`kisi`, `hane`, `oyku`; ort. ~1.700 karakter). Kişinin kendi oyunu söylemez |
| `TR_hane_il.csv` | İl düzeyinde sonuç payları (%) — `baglam.bolge_paylari` |

## Demografik dayanak (yaklaşık oranlar)

| Bileşen | Kaynak | Kullanım |
|---|---|---|
| Bölge nüfusu, yaş yapısı, hane tipleri | TÜİK ADNKS 2023 (tek kişilik %19,7; geniş aile ~%13; ort. hane 3,14) | hane tipi → üyeler |
| Eğitim | TÜİK Ulusal Eğitim İstatistikleri, yaş grubuna göre bitirilen düzey | doğum kuşağı × cinsiyet tablosu; aile SES, köy, bölge kaydırır |
| İlk evlilik yaşı | TÜİK Evlenme İstatistikleri (2023: K 25,8 / E 28,3; 1980'lerde K ~21) | kuşağa göre |
| Doğurganlık, çocuk ölümlülüğü | TNSA, TÜİK (kadın kuşağının tamamlanmış doğurganlığı 1940 ~4,6 → 1995 ~1,7; bölge çarpanı) | kardeş sayısı, çocuklar, bebekken ölen kardeşler |
| Akraba evliliği, görücü usulü | TNSA 2018 (%23; Güneydoğu ~%40), TAYA 2016/2021 | evlenme yılı × bölge × eğitim |
| Ölümlülük | TÜİK hayat tabloları (Gompertz yaklaşımı) | anne-baba hayatta mı, dul kalma |
| Kadın işgücü | TÜİK İşgücü 2023 (%35,8; eğitimle artar) | meslek |
| 1961–74 işçi göçü | Almanya/Avrupa'ya giden kardeşler (İç Anadolu ve Karadeniz yoğun) | gurbetçi akraba |
| Tarihsel olaylar | 12 Eylül gözaltıları, 1990'larda köy boşaltmaları, 1999 ve 2023 depremleri, 2001 krizi, Gezi, 15 Temmuz, KHK ihraçları, pandemi | yaş × yer × aile maruziyeti |
| Medya | RTÜK ve Reuters Dijital Haber Raporu 2023 (günlük TV ~3,5 saat; gençlerde sosyal medya) | kanal, saat, WhatsApp aile grubu |

## Hayat seyri

1. **Köken:** doğum yeri (göç ettiyse memleket), köy/kent, etnik köken ve inanç, ailenin sosyoekonomik durumu
   ve dindarlığı; **anne ve baba** (adları, kendi kuşaklarının eğitimi, meslekleri, hayatta olup olmadıkları,
   babanın oyu dönemin partileriyle: AP → DYP, Refah → AK Parti, Ecevit/DSP → CHP, MHP, HADEP → HDP).
2. **Kardeşler:** annenin kuşağının doğurganlığı; her kardeşin adı, nerede yaşadığı (köy, il, büyükşehir,
   Almanya'da işçi), mesleği, medeni durumu ve siyasi eğilimi; bebekken ölen kardeşler.
3. **Çocukluk:** yoksulluk, ev içi şiddet, ebeveyn kaybı, boşanma, alkol, sert terbiye.
4. **Göç:** köyden il merkezine ya da büyükşehre (yıl, semt), zorunlu göç (köy boşaltma).
5. **Okul ve askerlik:** eğitim düzeyi, üniversite şehri; askerlik yeri ve yılı (1984–2002 arası Doğu'da
   askerlik ayrı bir deneyim).
6. **İş:** meslek ve sektör (ör. tekstil atölyesi, berber, bankacı, fındık üreticisi), sendika, gelir, borç,
   iş kaybı.
7. **Evlilik:** yıl, nasıl (görücü usulü, akraba evliliği, iş yerinde/üniversitede tanışma), eşin memleketi ve
   işi; boşanma ya da dul kalma; eşin aile soyuyla siyasi homogami (Alford vd. 2011) ve yıllar içinde
   karşılıklı uyum.
8. **Çocuklar:** adları ve yaşları; evde yaşayan bekâr yetişkin çocuklar ayrı seçmen olarak kurulur.
9. **Tarihsel olaylar** ve **gündelik hayat:** ev sahibi/kiracı, araba, kronik hastalık, evde konuşulan dil,
   memleket bağı, ibadet, günlük rutin, kaygılar ve hayaller.
10. **İletişim ekolojisi:** TV kanalı ve saati, sosyal medya kaynağı ve saati, aile WhatsApp grubu, cami/cemevi,
    cemaat, kahvehane, altın günü, hemşehri derneği; **adı konmuş tartışma ağı** (hanedekiler, hane dışındaki
    anne-baba ve kardeşler, evlenmiş çocuklar, aynı ildeki benzer kişiler) ve **kanaat önderi** (imam, cemevi dedesi,
    kahvedeki emekli öğretmen, sendika temsilcisi, muhtar).

## Oy (üretim süreci — karar modelinin denklemi kullanılmaz)

- **18 yaşında eğilim:** baba ve anne soyu, kimlik, din, sınıf, bölge, hayat olaylarının izleri.
- **2015–2023 arası yıl yıl ajan tabanlı iletişim:** medya dozu (iki kanal, azalan getirili saat × dikkat);
  karşıt içerikte geri tepme (düşmanca medya etkisi); konuşmalar: hanedekiler birbirini eş zamanlı etkiler,
  dış çevre kendi eğilimiyle, kanaat önderi daha ağır. Ekonomik zarar (partizan algı perdesi), güvenlik
  gündemi, deprem kaybı (iktidar yanlısı kanal izleyende "devlet sahada" çerçevesi kaybı yumuşatır).
- **2018 oyu** sürecin 2018 durumundan, **2023 oyu** son durumdan + alışkanlıktan; sabitler toplam paylara kalibre.

Ölçülen sütunlar gürültülüdür: ekonomi algısı ve kurumsal güven partizan güdümlüdür; eşin oyu %15
olasılıkla yanlış algılanır; tartışma ağındaki azınlık görüşü %15 olasılıkla il çoğunluğuna sayılır (suskunluk sarmalı).

## Kalibrasyon (tohum 2024)

| Ölçüt | Gerçek düzey | Veride |
|---|---|---|
| Oy (iktidar / ana muh. / milliyetçi / Kürt / katılmama) | ~43 / 29 / 8 / 8 / 12 | 42,4 / 29,8 / 8,2 / 8,1 / 11,5 |
| 2018 dağılımı | ~46 / 20 / 8,5 / 10 / 15,5 | 46,6 / 19,4 / 8,3 / 9,9 / 15,9 |
| 18+ yaş yapısı (18–24 / 25–34 / 35–44 / 45–54 / 55–64 / 65+) | ADNKS: ~13,5 / 19,5 / 19,5 / 16,5 / 13,5 / 14 | 15,4 / 22,3 / 17,2 / 19,8 / 12,9 / 12,4 |
| Hane tipi (tek / çift / çekirdek / tek ebeveyn / geniş) | ADNKS: 19,7 / 15 / 42 / 9 / 13 | 18,7 / 14,2 / 43,4 / 9,2 / 14,5 |
| Akraba evliliği (evlenmiş olanlarda) | TNSA 2018: %23 (15–49 yaş kadın; gençlerde düşük) | %15 |
| Görücü usulü | TAYA: yaşlı kuşaklarda çoğunluk, gençlerde azınlık | %48 |
| Çalışan kadın (65 altı) | İşgücüne katılım %35,8 (işsizler dahil) | %29 |
| Günlük TV | ~3,5 saat | 3,5 saat (sosyal medya 2,3) |
| Eşle aynı oy (algılanan) | ANES 2000: %76 | %65 |
| Tartışma ağının çoğunluğuyla aynı oy | ANES 2000: %59 | %61 |
| İki seçimde aynı oy | %75–80 | %80 |
| Alevi seçmende ana muhalefet | çok yüksek | %83 |
| Kürt seçmende Kürt hareketi / iktidar | ~%40–55 / ~%25–35 | %35 / %29 (Kürt hareketi düşük taraf) |
