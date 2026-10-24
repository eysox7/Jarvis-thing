import 'api.dart';
import 'wordlists.g.dart';

// Sunucudaki içerik denetiminin (server/moderation.js) telefondaki karşılığı. İnternetsiz dolaşan
// sözler sunucuya varmadan okunduğu için aynı kurallar burada da uygulanır: nefret söylemi içeren söz
// yazılmaz, alınmaz ve yayılmaz; kişisel veri (telefon, e-posta, plaka, @kişi, bağlantı) ve küfür
// maskelenir. Sunucu yine de kendi denetimini yapar; asıl karar onundur.

const _trFold = {'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u'};
// Dart'ta Unicode ayrıştırma (NFD) yok; sık görülen aksanlı harfler elle sadeleştirilir.
const _accentFold = {
  'à': 'a', 'á': 'a', 'ä': 'a', 'ã': 'a', 'å': 'a', 'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', //
  'ì': 'i', 'í': 'i', 'ï': 'i', 'ò': 'o', 'ó': 'o', 'õ': 'o', 'ù': 'u', 'ú': 'u', 'ñ': 'n', 'ý': 'y', 'ÿ': 'y',
};
const _leet = {'0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', r'$': 's'};

// Kelimeyi karşılaştırma biçimine indirger: "S1KT1RRR" → "siktir".
String normalizeWord(String word) {
  final out = StringBuffer();
  for (final rune in word.toLowerCase().runes) {
    if (rune >= 0x300 && rune <= 0x36f) continue;
    final ch = String.fromCharCode(rune);
    out.write(_trFold[ch] ?? _accentFold[ch] ?? _leet[ch] ?? ch);
  }
  return out.toString().replaceAll(RegExp('[^a-z]'), '').replaceAllMapped(RegExp(r'(.)\1+'), (m) => m[1]!);
}

final _slurSet = slurs.map(normalizeWord).toSet();
final _profanitySet = profanity.map(normalizeWord).toSet();
final _wordRe = RegExp(r'[\p{L}\p{N}@$]+', unicode: true);

final _personal = <(RegExp, String)>[
  (RegExp(r'[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}', unicode: true), '[e-posta]'),
  (RegExp(r'\b(?:https?:\/\/|www\.)\S+', caseSensitive: false, unicode: true), '[bağlantı]'),
  (RegExp(r'(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3,4})[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2,4}\b'), '[telefon]'),
  (RegExp(r'\b(?:0[1-9]|[1-7]\d|8[01])\s?[A-ZÇĞİÖŞÜ]{1,3}\s?\d{2,4}\b', unicode: true), '[plaka]'),
];
final _handleRe = RegExp(r'(^|\s)@[\p{L}\p{N}_.]{2,}', unicode: true);

bool containsSlur(String text) => _wordRe.allMatches(text).any((m) => _slurSet.contains(normalizeWord(m[0]!)));

String maskPersonalData(String text) {
  var out = text;
  for (final (re, label) in _personal) {
    out = out.replaceAll(re, label);
  }
  return out.replaceAllMapped(_handleRe, (m) => '${m[1]}[kişi]');
}

String maskProfanity(String text) => text.replaceAllMapped(_wordRe, (m) {
  final word = m[0]!;
  if (!_profanitySet.contains(normalizeWord(word))) return word;
  final chars = word.runes.toList();
  return String.fromCharCode(chars.first) + '*' * (chars.length - 1 < 2 ? 2 : chars.length - 1);
});

// Herkese açık metin: nefret söylemi reddedilir (sunucudaki hata koduyla), kişisel veri ve küfür maskelenir.
String moderatePublicText(String text) {
  if (containsSlur(text)) throw ApiException(422, 'content_blocked');
  return maskProfanity(maskPersonalData(text));
}

// Yeraltından gelen sözü göstermeden önce: kişisel veri ve küfür maskesi (nefret söylemi zaten alınmaz).
String displayText(String text) => maskProfanity(maskPersonalData(text));
