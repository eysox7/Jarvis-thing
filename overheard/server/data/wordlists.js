// Moderasyon listeleri. Bilerek kısa tutuldu; gerçek kullanımda topluluk geri bildirimiyle büyütülmeli.
// Karşılaştırma, metin normalize edildikten sonra yapılır (küçük harf, Türkçe harfler sadeleştirilmiş,
// leetspeak çözülmüş, tekrarlanan harfler tekilleştirilmiş).

// Nefret söylemi / aşağılayıcı lakaplar: içeren söz ya da mesaj reddedilir.
export const SLURS = [
  // EN
  'nigger', 'nigga', 'faggot', 'fagot', 'retard', 'kike', 'spic', 'chink', 'tranny',
  // TR
  'ibne', 'pust', 'zenci',
];

// Küfür: overheard kültürünün parçası olabildiği için reddedilmez, ilk harfi kalacak şekilde maskelenir.
// İngilizce sıradan kelimelerle çakışanlar (göt → "got", piç → "pic") bilerek listede yok.
export const PROFANITY = [
  // EN
  'fuck', 'fucking', 'motherfucker', 'shit', 'bitch', 'asshole', 'dick', 'cunt', 'bastard',
  // TR
  'amk', 'aq', 'amina', 'aminakoyim', 'siktir', 'sikerim', 'sikeyim', 'orospu', 'orospucocugu',
  'yarrak', 'yarak', 'pezevenk', 'gavat', 'kahpe', 'serefsiz',
];
