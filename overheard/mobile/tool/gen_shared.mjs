// Sunucuyla ortak veriler web uygulamasından/sunucudan üretilir; iki taraf aynı şeyi söylesin:
// - lib/l10n/web_strings.g.dart: hata, sohbet, profil, tepki, rozet metinleri (public/js/i18n.js)
// - lib/core/wordlists.g.dart: içerik denetimi listeleri (server/data/wordlists.js)
// Çalıştır: node tool/gen_shared.mjs (mobile/ klasöründe).
import { readFile, writeFile } from 'node:fs/promises';
import { PROFANITY, SLURS } from '../../server/data/wordlists.js';

const dart = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$')}'`;
const HEADER = (source) => `// OTOMATİK ÜRETİLDİ: tool/gen_shared.mjs (kaynak: ${source}). Elle düzenleme.\n\n`;

const source = await readFile(new URL('../../public/js/i18n.js', import.meta.url), 'utf8');
const PREFIXES = ['errors.', 'location.', 'time.', 'chat.', 'inbox.', 'react.', 'badge.', 'legal.', 'profile.', 'toast.', 'bubble.', 'anon.'];
const sections = {
  tr: source.slice(source.indexOf('\n  tr: {'), source.indexOf('\n  en: {')),
  en: source.slice(source.indexOf('\n  en: {')),
};
const entry = /^\s*'([\w.]+)':\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"),?\s*$/gm;
let strings = `${HEADER('public/js/i18n.js')}const webStrings = <String, Map<String, String>>{\n`;
for (const [lang, text] of Object.entries(sections)) {
  strings += `  '${lang}': {\n`;
  for (const [, key, literal] of text.matchAll(entry)) {
    if (!PREFIXES.some((p) => key.startsWith(p))) continue;
    strings += `    '${key}': ${dart(Function(`return ${literal}`)())},\n`;
  }
  strings += '  },\n';
}
strings += '};\n';
await writeFile(new URL('../lib/l10n/web_strings.g.dart', import.meta.url), strings);

const list = (name, words) => `const ${name} = <String>[\n${words.map((w) => `  ${dart(w)},\n`).join('')}];\n`;
await writeFile(new URL('../lib/core/wordlists.g.dart', import.meta.url),
  `${HEADER('server/data/wordlists.js')}${list('slurs', SLURS)}\n${list('profanity', PROFANITY)}`);
