// Söz ve mesaj içerik denetimi: kişisel veri maskesi, küfür maskesi, nefret söylemi reddi.
import { HttpError } from './http.js';
import { PROFANITY, SLURS } from './data/wordlists.js';

const TR_FOLD = { ç: 'c', ğ: 'g', ı: 'i', i̇: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };

// Kelimeyi karşılaştırma biçimine indirger: "S1KT1RRR" → "siktir".
export function normalizeWord(word) {
  return [...word.toLocaleLowerCase('tr')]
    .map((ch) => TR_FOLD[ch] ?? LEET[ch] ?? ch)
    .join('')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1');
}

const fold = (list) => new Set(list.map(normalizeWord));
const SLUR_SET = fold(SLURS);
const PROFANITY_SET = fold(PROFANITY);

// Kelime sınırları: harfler, rakamlar ve leetspeak karakterleri bir kelimenin parçasıdır.
const WORD_RE = /[\p{L}\p{N}@$]+/gu;

const PII_PATTERNS = [
  // E-posta
  { re: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, label: 'email' },
  // Bağlantılar
  { re: /\b(?:https?:\/\/|www\.)\S+/giu, label: 'link' },
  // Telefon: +90 5xx xxx xx xx, 0 5xx..., (512) 555-1234, 512.555.1234, +1 512 555 1234
  { re: /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3,4})[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2,4}\b/g, label: 'phone' },
  // Türkiye plakası: 34 ABC 123, 06 AB 1234
  { re: /\b(?:0[1-9]|[1-7]\d|8[01])\s?[A-ZÇĞİÖŞÜ]{1,3}\s?\d{2,4}\b/g, label: 'plate' },
  // @kullanıcıadı: overheard kimseyi hedef almaz.
  { re: /(^|\s)@[\p{L}\p{N}_.]{2,}/gu, label: 'handle' },
];

const PII_TEXT = {
  email: '[e-posta]',
  link: '[bağlantı]',
  phone: '[telefon]',
  plate: '[plaka]',
  handle: '[kişi]',
};

export function maskPersonalData(text) {
  let out = text;
  const found = new Set();
  for (const { re, label } of PII_PATTERNS) {
    out = out.replace(re, (match, lead) => {
      found.add(label);
      return label === 'handle' ? `${lead}${PII_TEXT.handle}` : PII_TEXT[label];
    });
  }
  return { text: out, found: [...found] };
}

export function containsSlur(text) {
  return (text.match(WORD_RE) || []).some((w) => SLUR_SET.has(normalizeWord(w)));
}

export function maskProfanity(text) {
  return text.replace(WORD_RE, (w) => {
    if (!PROFANITY_SET.has(normalizeWord(w))) return w;
    const chars = [...w];
    return chars[0] + '*'.repeat(Math.max(2, chars.length - 1));
  });
}

// Herkese açık metin (söz, mekân adı): nefret söylemi reddedilir, kişisel veri ve küfür maskelenir.
export function moderatePublicText(text) {
  if (containsSlur(text)) throw new HttpError(422, 'content_blocked');
  const { text: masked, found } = maskPersonalData(text);
  return { text: maskProfanity(masked), masked: found };
}

// Özel mesaj: kişiler iletişim bilgisi paylaşabilir; yalnızca nefret söylemi reddedilir.
export function moderatePrivateText(text) {
  if (containsSlur(text)) throw new HttpError(422, 'content_blocked');
  return text;
}
