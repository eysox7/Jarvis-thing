// Sunucu hata kodlarının metinleri web uygulamasından (public/js/i18n.js) alınır; iki uygulama aynı
// cümleyi söylesin. Çalıştır: node tool/gen_server_strings.mjs (mobile/ klasöründe).
import { readFile, writeFile } from 'node:fs/promises';

const source = await readFile(new URL('../../public/js/i18n.js', import.meta.url), 'utf8');
const PREFIXES = ['errors.', 'location.', 'time.'];
const sections = { tr: source.slice(source.indexOf('\n  tr: {'), source.indexOf('\n  en: {')), en: source.slice(source.indexOf('\n  en: {')) };
const entry = /^\s*'([\w.]+)':\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"),?\s*$/gm;
const dart = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$')}'`;

let out = '// OTOMATİK ÜRETİLDİ: tool/gen_server_strings.mjs (kaynak: public/js/i18n.js). Elle düzenleme.\n\nconst serverStrings = <String, Map<String, String>>{\n';
for (const [lang, text] of Object.entries(sections)) {
  out += `  '${lang}': {\n`;
  for (const [, key, literal] of text.matchAll(entry)) {
    if (!PREFIXES.some((p) => key.startsWith(p))) continue;
    out += `    '${key}': ${dart(Function(`return ${literal}`)())},\n`;
  }
  out += '  },\n';
}
out += '};\n';
await writeFile(new URL('../lib/l10n/server_strings.g.dart', import.meta.url), out);
