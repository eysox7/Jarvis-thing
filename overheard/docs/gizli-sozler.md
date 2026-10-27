# Gizli sözler: mini oyun önerisi

Durum: **öneri**, karar bekliyor. Bu belgedeki kuralların hiçbiri kodda yok. Görünürlük kuralları
(yerel / herkese açık / hat) bu oyun yüzünden değişmedi, senin onayın olmadan da değişmeyecek.

## Neden özel?

Metroda, internetsiz yazılan söz, telefondan telefona Bluetooth ile geçerek sunucuya ulaşır. Sunucu
bunun izlerini şimdiden tutuyor:

| Alan | Anlamı | Ne kadar güvenilir |
| --- | --- | --- |
| `offline` | Söz bağlantısız yazıldı, yazarın cihaz anahtarıyla imzalı | Kesin (imza sunucuda doğrulanıyor) |
| `relayed_by` | Sözü sunucuya ulaştıran telefonun sahibi (yazar değilse) | Kesin (oturumdan geliyor) |
| `hops` | Kaç telefondan geçtiği | **Uygulamanın beyanı**, doğrulanmıyor |
| `created_at` | Yazıldığı an (sinyal bulunduğu an değil) | İmzalı paketten geliyor |
| teslim makbuzu | Sunucu sözü aldı (29e) | Kesin (sunucu imzası) |

Bu sözler sıradan sözlerden daha nadir. Hepsinin arkasında "o vagonda, o an oradaydım" diyen bir
kanıt zinciri var. Oyunu bunun üstüne kurmayı öneriyorum.

## Önerilen oyun: "Belirdi"

1. **Gizli doğar.** İnternetsiz yazılan söz haritaya düştüğünde metni görünmez. Yerinde bir 🕳️ ve
   "Burada yeraltında bir söz yazıldı" yazar. Yazar ve sözü taşıyanlar metni zaten görmüştü (Bluetooth
   üzerinden), onlar için söz açıktır.
2. **Belirir.** Söz, şu yollardan biriyle herkese "belirir":
   - Hattın ya da istasyonun kendisine gidip check-in yapan biri onu açar. Bugünkü yerel söz kuralının
     aynısı, yalnızca daha çekici bir sunumla.
   - Belli sayıda kişi aynı hatta "ben de oradaydım" derse, söz o hatta herkese açılır.
   - Bir süre sonra (örneğin 24 saat) kendiliğinden belirir. Bu yolda yazar "ilk belirten" rozetini
     alır.
3. **Koleksiyon.** Yeraltı modunda telefonuna gelen her söz "Yeraltında duyduklarım"a girer (bu kısım
   bugün de var). Oyun bunu bir albüme çevirir: hat başına toplanan gizli sözler, en uzağa giden söz
   (en çok telefondan geçen), "zinciri kuran" (sözü sunucuya ulaştıran) rozetleri.
4. **Zincir.** Söz kartında, kaç telefondan geçtiği ve kimin ulaştırdığı yazar ("4 telefondan geçti,
   @kulak ulaştırdı"). Ulaştıran kişi anonimlik tercihine göre gizlenebilir.

## Kurulması gerekenler (onaydan sonra)

- **Doğrulanabilir zincir.** Atlama sayısı oyunun puanı olacaksa uygulamanın beyanına güvenilmemeli.
  Öneri: her taşıyan, sözü ilettiğinde paketin özetini kendi cihaz anahtarıyla imzalar. Zincir
  `[taşıyan anahtarı, imza]` listesi olarak büyür, sunucu her halkayı doğrular. Paket bir halka
  başına yaklaşık 100 bayt büyür; en fazla 8 atlamada bu sorun değil.
- **Taşıyanlar listesi.** Bugün sunucu yalnızca ulaştıranı biliyor. Zincir imzalı olursa aradaki
  taşıyanlar da bilinir ve rozet alabilir.
- **Sunum.** Haritada 🕳️ işareti, "belirdi" animasyonu, albüm ekranı.
- **Kötüye kullanım.** Aynı kişinin iki telefonla zincir şişirmesine karşı, bir hesap bir zincirde
  bir kez sayılır. Ayrıca cihaz anahtarı başına sınır konur (bugün de en fazla 5 anahtar var).

## Senin kararın gerekenler

1. Gizli söz, yerel söz kuralının yerini mi alsın (metroda yazılanlar için), yoksa onun üstüne ek bir
   katman mı olsun?
2. Kendiliğinden belirme olsun mu, olursa ne kadar sonra?
3. Ulaştıran ve taşıyan kişiler sözde adıyla görünsün mü, yoksa yalnızca sayı mı görünsün?
4. Puan ve rozetler mevcut rozet sistemine mi eklensin, yoksa ayrı bir "yeraltı albümü" mü olsun?
