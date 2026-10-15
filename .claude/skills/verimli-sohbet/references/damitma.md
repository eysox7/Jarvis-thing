# Damıtma kuralları

Görev: verilen konuşmayı mevcut hafıza ve özetle birleştirip iki kompakt parçaya indirmek.
Konuşmaya cevap verme, araç çağırma; yalnızca en alttaki biçimde metin yaz.

## Kalıcı hafıza — `<hafiza>`

- Her satır `- ` ile başlar; satır başına tek olgu, en fazla ~15 kelime.
- Yalnızca haftalar sonra da işe yarayacak olanlar: kimlik ve rol, tercihler ("kısa cevap
  ister"), süren projeler, önemli kişiler ve kullanıcıyla ilişkileri, kalıcı kısıtlar, rutinler.
- Kullanıcının açıkça "hatırla / unutma" dediği her şey girer; "unut" dediği her şey çıkar.
- Mevcut hafızayı koru. Yeni bilgi eskisiyle çelişirse eskisini güncelle, ikisini birden tutma.
  Tekrarları birleştir; artık geçersiz olanı (bitmiş tek seferlik işler) sil.
- En fazla 40 satır. Fazlaysa benzerleri birleştir, en az önemlileri çıkar.
- Asla: şifre, API anahtarı, kart/IBAN, kimlik numarası.

## Özet — `<ozet>`

Süren konunun, yeni bir pencerede baştan anlatmaya gerek kalmadan sürdürülebileceği kadar
özeti. En fazla ~120 kelime; madde madde olabilir. Öncelik sırasıyla koru:

1. Kullanıcının istedikleri, kararlar, kısıtlar, tercihler — kendi ifadesine yakın
2. Nerede kalındı; tamamlananlar
3. Açık kalanlar, verilen sözler, sıradaki adım
4. Yeniden bulunması zor ayrıntılar: isim, sayı, tarih, link, tam ifade — harfiyen

Kullanıcının söylediklerini dikkatle, kendi sözlerine yakın tut; asistanın açıklamalarını
vardığı sonuca indir (ne önerildi, ne üretildi). Selam, dolgu, tekrar, deneme-yanılma ayrıntısı
yok. Kalıcı hafızaya giren bir şeyi özette tekrarlama. Açık iş yoksa özet boş kalabilir.

## Çıktı biçimi

<hafiza>
- ...
</hafiza>
<ozet>
...
</ozet>
