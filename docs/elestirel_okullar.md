# Eleştirel okullar → karar modeli terimleri

Karar modeli: U = ASC + Σ θ_k · z_k(kişi, seçenek, bağlam). Her okulun "insan neden böyle karar verir" iddiası,
ölçülebilir bir z terimine çevrilip modele **öncül** (kuramın öngördüğü yön/büyüklük) olarak girer; gerçek veri
geldiğinde katsayı veriden öğrenilir. Aşağıdaki büyüklükler logit birimidir (ln OR ≈ 1.81·d).

| Okul / düşünür | İddia | Modeldeki terim | Ampirik dayanak |
|---|---|---|---|
| **Frankfurt — Adorno, Otoriter Kişilik; Stenner (2005)** | Düzen/uyum yatkınlığı güçlü lidere ve kültürel sağa yöneltir; **normatif tehditle** etkinleşir | `otoriter_dinamik`: A(p) × [kültürel sağ(a) + lider gücü(a)] × (1 + tehdit) — A ≈ dindarlık − eğitim − bilişsel ihtiyaç + yaş + kırsal | MacWilliams 2016: en otoriterlerin %47'si vs en az %18'i (OR≈4, SD başına ≈0,45); Norris & Inglehart 2019: kültürel tepki ekonomik kaygıdan güçlü yordayıcı |
| **Fromm — Özgürlükten Kaçış** | Güvencesizlik otoriteye teslimiyet doğurur | Tehdit çarpanına katılır: düşük gelir × kriz bağlamı | Öncül (ayrı terim eşdoğrusal olurdu) |
| **Horkheimer & Adorno — kültür endüstrisi; Marcuse — sahte ihtiyaçlar** | Reklam istek üretir; standart kitle markası "sözde bireysellik"le kazanır | `reklam_teshir` (ölçülmüş reklam/teşhir × düşük bilişsel ihtiyaç); `kultur_endustrisi`: marka gücü × TV/sosyal medya maruziyeti | Reklam esnekliği 0,12 (Sethuraman vd. 2011); marka tercihi kalıcı, pay farkının ~%40'ı (Bronnenberg, Dubé & Gentzkow 2012) |
| **Habermas — iletişimsel eylem** | Müzakereci akıl politika içeriğini, stratejik/medya eylemi kişiliği tartar | `muzakere`: yakınlık terimini bilişsel ihtiyaç ve kanaat önderliğiyle güçlendirir, lider etkisini zayıflatır | Öncül |
| **Chicago sosyolojisi — Thomas teoremi** | "Durumu gerçek tanımlayanlar için sonuçlar gerçektir": algı nesnel durumdan güçlü | Kişinin beyan ettiği konum (`konum_kultur/ekonomi`) ve ekonomi algısı (`ekonomi_algisi`, `hane_algisi`) demografik tahminin yerine geçer | BEPS gerçek verisinde algılanan ekonomi ve Avrupa tutumu en güçlü yordayıcılar arasında |
| **Cooley/Mead — referans grubu; Park — ekoloji** | Karar "önemli ötekiler"in gözünde kurulur | Sosyal norm terimi + kişinin hücresindeki (yaş×eğitim×ideoloji) seçim payı (öğrenilen demografik etkiler) | Güneş paneli: posta kodunda +10 kurulum → +%7,8 (Bollinger & Gillingham 2012); komşuya gösterilen katılım +0,36 logit (Gerber vd. 2008); enerji %2 (Allcott 2011) |
| **Chicago ekonomisi — Becker, zamanın tahsisi** | Tam fiyat = fiyat + zamanın değeri × süre; zamanın değeri gelirle artar | `zaman`: −log(1+süre/medyan) × (0,6 + 0,8·gelir) | Ulaşım türü seçiminin standart bulgusu |
| **Becker — akılcı bağımlılık/alışkanlık; Hausman 1979** | Geçmiş tüketim bugünkü faydayı artırır; gelecekteki maliyet eksik tartılır | `gecmis` (durum bağımlılığı, 1–3 logit); `isletme` (işletme maliyeti, bilişsel ihtiyaçla artan ağırlık) | Sigara: kısa dönem esneklik −0,4, uzun −0,75 (Becker, Grossman & Murphy 1994) |
| **Stigler — bilginin ekonomisi** | Arama maliyeti yüksekse bilinen markaya yönelim | `arama_maliyeti`: düşük dijital beceri × marka gücü | Fiyat karşılaştırma siteleri fiyatı %8–15 düşürdü (Brown & Goolsbee 2002) |
| **Thaler — varsayılan/dürtme** | Hiçbir şey yapmamanın sonucu en çok seçilen olur | `varsayilan` (öncül 1,1 → 1,2) | 58 çalışmalık meta-analiz d=0,68 ≈ 1,2 logit (Jachimowicz vd. 2019); emeklilik 37%→86% (Madrian & Shea 2001) |
| **Birmingham — Hall, Morley** | Okuma egemen/müzakereci/karşıt; aynı mesaj kitleye göre yön değiştirir | `hall_okuma` (kitle motorundan, işaret değiştirebilir) | Öncül |
| **Eleştirel ekonomi politik — Herman & Chomsky, Smythe, Schiller** | Sahiplik ve medya yanlılığı seçmeni kaydırır | `medya_yanliligi`: kişinin ana medyası × o medyanın seçeneğe yanlılığı (bağlam: `medya_yanliligi`) | Fox News: izleyicinin %3–28'ini ikna etti (DellaVigna & Kaplan 2007); Türkiye: gazete içeriği parti desteğini etkiledi (Çarkoğlu & Yıldırım 2023) |
| **Bourdieu — Ayrım; Veblen; Baudrillard** | Beğeni sınıf/sermaye işaretidir; görünür tüketim statü göstergesidir | `kulturel_sermaye`: eğitim × kalite/seçkinlik; `gosteris`: statü görünürlüğü(a) × (azınlık kimliği + kent − gelir) | Eğitim ve statü kültürel tüketimi yordar (Chan & Goldthorpe 2007); görünür mallara %30 fazla harcama, referans grubu geliri arttıkça azalır (Charles, Hurst & Roussanov 2009) |
| **Foucault — yönetimsellik; Beck — risk toplumu** | Uyum içselleştirilmiş norm ve uzmana güvenle; riskin farkındaki kamu uzmana güvenmez | `kurum_onerisi` (güven × resmî öneri) + `risk_toplumu`: yüksek eğitim × düşük güven × resmî öneri (negatif) | Aşı kabulü güvenle artar (Lazarus vd. 2020); 113 ülke: sağlık kurumlarına güven ve komplo zihniyeti en sağlam yordayıcılar (Jennings vd. 2023) |
| **Feminist / kesişimsel** | Cinsiyet farkı kuşakla değişir; radikal sağda kalıcı kadın açığı | `cinsiyet_acigi`: kadın × sol × genç kuşak; kadın × radikal sağ (−) | Inglehart & Norris 2000; Immerzeel vd. 2015 |
| **Toronto — McLuhan, Innis** | Araç mesajdır: sosyal medya düzen karşıtlığını, TV kişiselleşmeyi büyütür | `arac`: sosyal medya × düzen karşıtı (+), × iktidar (−) | 3G yayılımı hükümete güveni düşürdü, popülist oyu artırdı (Guriev vd. 2021); TV katılım düşüşünün ¼–½'si (Gentzkow 2006) |
| **Columbia okulu — Lazarsfeld, Berelson & Gaudet; Katz (iki aşamalı akış)** | Oy bir grup kararıdır; etki kanaat önderleri ve yüz yüze çevre üzerinden akar | `aile` (hanenin tercihi), `ag` (tartışma ağında pay); nüfusta homofili ağı + kanaat önderleri daha çok bağlı → kampanya etkisi yayılır (sosyal çarpan) | Hane içi bulaşma: doğrudan etkinin ~%60'ı diğer üyeye (Nickerson 2008); eşlerin oy uyumu ~%80–90 (Zuckerman 2005) |
| **Huckfeldt & Sprague; Park — kentsel ekoloji** | Bağlam (komşuluk, il) bireysel özelliklerin ötesinde etkiler; topluluğa gömülü kişide güçlü | `topluluk`: log(bölge payı) × gömülülük (kırsal, yaş, dindarlık) | ANES 2016 eyalet bağlamı: CV 63,0 → 64,2; veri yokken 43,1 → 50,6 |
| **Homofili — McPherson, Smith-Lovin & Cook 2001; Aral vd. 2009** | Benzer benzerle bağ kurar; görünen bulaşmanın yarıdan fazlası seçilimdir | Yayılmada kesitsel katsayının nedensel payı 0,4 (`sosyal_nedensellik`); müdahale yokken tahmin değişmez | Aral, Muchnik & Sundararajan 2009 |
| **Gurr — göreli yoksunluk; Alexander — kültürel travma; Balcells** | Kolektif şiddet ve yerinden edilme kimliği siyasallaştırır | `kolektif_travma`: (zorunlu göç + ½ çatışma maruziyeti) × marjinal kimlik × azınlığı temsil eden parti | Balcells 2012 (İspanya iç savaşı mağduriyeti kuşaklar boyu oy); sentetik TR'de test |
| **Seeman — yabancılaşma; ACE literatürü** | Çocukluk travması siyasal etkinlik duygusunu ve katılımı düşürür | `yabancilasma`: travma skoru × oy kullanmama | Öncül 0,4 |
| **Healy & Malhotra; Gasper & Reeves** | Seçmen afet yönetimini oylar; kayıp yaşayan iktidarı cezalandırır | `afet_cezasi`: −deprem kaybı × iktidar | Healy & Malhotra 2009; Gasper & Reeves 2011 |

Hayat öyküsü sütunları (travma, tehdit, deprem, zorunlu göç, iş kaybı, borç, ebeveyn oyu) CSV'den otomatik tanınır;
zengin sentetik Türkiye verisi (`tests/data/sentetik/`) ile öykü bilgisi isabeti 68,6 → 80,3'e çıkarır.

## Bilinçli olarak EKLENMEYENLER
- **Sistemi meşrulaştırma (Jost) — "yoksul statükoyu destekler"**: 151.794 kişilik testte etki yok ya da ters
  (Brandt 2013); düşük statülü gruplarda Zr=0,01. Gelir → statüko terimi eklenmedi; statüko desteği güven üzerinden.
- Ekonomik kaygı ana terim değil: kültürel konum ana, ekonomik şok küçük bağlam değişkeni (Norris & Inglehart 2019; Mutz 2018).

## Ölçüm ilkesi
Her yeni terim gerçek veride (tests/realdata.mjs) kuramsız standart modele karşı görülmemiş veride sınanır;
terim katkısı ablasyonla raporlanır. Gerçek veri testine dayanmayan büyüklük iddiası yapılmaz.
