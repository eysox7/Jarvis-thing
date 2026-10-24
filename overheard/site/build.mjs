// Tanıtım sitesini (GitHub Pages) site/dist klasörüne kurar: tanıtım ve hesap silme sayfaları,
// web uygulamasından kopyalanan gizlilik ve koşullar, uygulamanın sunucuyu bulduğu connect.json ve
// (verildiyse) APK. Kullanım: node site/build.mjs [--apk yol/overheard.apk] [--server https://...]
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const here = (path) => new URL(path, import.meta.url);
const { values: args } = parseArgs({ options: { apk: { type: 'string' }, server: { type: 'string' }, message: { type: 'string' } } });

const dist = here('dist/');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of ['index.html', 'hesap-silme.html', 'site.css']) await copyFile(here(file), new URL(file, dist));
await copyFile(here('../public/icons/icon.svg'), new URL('icon.svg', dist));

// Gizlilik ve koşullar web uygulamasındakiyle aynı metindir; yalnızca adresleri siteye göre düzeltilir.
for (const page of ['privacy.html', 'terms.html']) {
  const html = (await readFile(here(`../public/${page}`), 'utf8'))
    .replaceAll('href="/css/app.css"', 'href="site.css"')
    .replaceAll('href="/icons/icon.svg"', 'href="icon.svg"')
    .replaceAll('href="/privacy.html"', 'href="privacy.html"')
    .replaceAll('href="/terms.html"', 'href="terms.html"')
    .replaceAll('href="/"', 'href="./"');
  await writeFile(new URL(page, dist), html);
}

// Sunucu adresi: komut satırından verildiyse o, yoksa site/connect.json.
const connect = JSON.parse(await readFile(here('connect.json'), 'utf8'));
if (args.server !== undefined) connect.server = args.server;
if (args.message !== undefined) connect.message = args.message;
if (connect.server && !/^https?:\/\//.test(connect.server)) throw new Error(`connect.json: geçersiz sunucu adresi ${connect.server}`);
await writeFile(new URL('connect.json', dist), `${JSON.stringify({ ...connect, updatedAt: new Date().toISOString() }, null, 2)}\n`);

if (args.apk) await copyFile(args.apk, new URL('overheard.apk', dist));
// GitHub Pages'in Jekyll işlemesi kapalı (dosyalar olduğu gibi sunulsun).
await writeFile(new URL('.nojekyll', dist), '');
console.log(`site hazır: ${dist.pathname}${args.apk ? ' (APK ile)' : ''}${connect.server ? ` · sunucu ${connect.server}` : ' · sunucu yok'}`);
