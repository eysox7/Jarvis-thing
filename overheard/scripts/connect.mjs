// Uygulamanın sunucuyu bulduğu bağlantı dosyasını (site/connect.json) günceller. Dosya GitHub
// Pages'e gidince (iş akışı her push'ta siteyi yeniden kurar) telefonlar yeni adrese kendiliğinden
// geçer; APK'yı yeniden kurmak gerekmez.
// Kullanım: npm run connect -- https://sunucu.ornek.com ["duyuru metni"]
//           npm run connect -- --off ["Sunucu bakımda"]
import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('../site/connect.json', import.meta.url);
const [target, ...rest] = process.argv.slice(2);
if (!target) {
  console.error('Kullanım: npm run connect -- <https://sunucu-adresi | --off> ["duyuru"]');
  process.exit(1);
}
const server = target === '--off' ? '' : target.replace(/\/+$/, '');
if (server && !/^https:\/\//.test(server) && !/^http:\/\/(localhost|127\.|10\.|192\.168\.)/.test(server)) {
  console.error('Sunucu adresi https:// ile başlamalı (yerel ağ dışında şifresiz http kullanılmaz).');
  process.exit(1);
}
const current = JSON.parse(await readFile(file, 'utf8'));
const next = { ...current, server, message: rest.join(' ') };
await writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
console.log(`site/connect.json → ${server || '(sunucu kapalı)'}`);
console.log('Yayınlamak için: git add site/connect.json && git commit -m "Sunucu adresi" && git push');
