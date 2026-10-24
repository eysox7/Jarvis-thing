// GitHub Codespaces'te sunucuyu başlatır ve telefonların ulaşacağı genel adresi yazar. Codespace
// açıldığında kendiliğinden çalışır (.devcontainer/overheard). Veritabanı codespace silinene dek kalır.
import { spawn, execFileSync } from 'node:child_process';
import { openSync } from 'node:fs';

const port = Number(process.env.PORT) || 8787;
const name = process.env.CODESPACE_NAME;
const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
const publicUrl = name ? `https://${name}-${port}.${domain}` : `http://localhost:${port}`;

async function running() {
  try {
    return (await fetch(`http://127.0.0.1:${port}/healthz`)).ok;
  } catch {
    return false;
  }
}

if (!(await running())) {
  const log = openSync('/tmp/overheard.log', 'a');
  spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: new URL('..', import.meta.url),
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, PORT: String(port), OVERHEARD_TRUST_PROXY: '1', OVERHEARD_PUBLIC_URL: publicUrl },
  }).unref();
  for (let i = 0; i < 50 && !(await running()); i++) await new Promise((r) => setTimeout(r, 200));
}

// Telefonlar GitHub'a giriş yapmadan ulaşabilsin diye bağlantı noktası herkese açılır.
let visible = false;
if (name) {
  try {
    execFileSync('gh', ['codespace', 'ports', 'visibility', `${port}:public`, '-c', name], { stdio: 'ignore' });
    visible = true;
  } catch {
    visible = false;
  }
}

console.log(`\nOverheard sunucusu çalışıyor (günlük: /tmp/overheard.log).\nGenel adres: ${publicUrl}\n`);
if (name && !visible) console.log('Bağlantı noktasını herkese aç: alttaki "Ports" sekmesi → 8787 → sağ tık → Port Visibility → Public.\n');
console.log(`Telefonlar bu adrese kendiliğinden geçsin:\n  npm run connect -- ${publicUrl}\n  git add site/connect.json && git commit -m "Sunucu adresi" && git push\n`);
