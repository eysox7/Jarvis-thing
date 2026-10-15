#!/usr/bin/env node
// Giriş noktası.
//   npm start            botu çalıştırır
//   npm run kontrol      .env'yi, Telegram token'ını ve Claude anahtarını dener (ücretsiz)

import path from 'node:path';
import { Bot } from './bot.mjs';
import { Claude } from './claude.mjs';
import { ROOT, loadEnvFile, readConfig, validateConfig } from './config.mjs';
import { loadSkill } from './skill.mjs';
import { ChatStore } from './store.mjs';
import { Telegram } from './telegram.mjs';

const ts = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const log = {
  info: (...a) => console.log(ts(), ...a),
  warn: (...a) => console.warn(ts(), ...a),
  error: (...a) => console.error(ts(), ...a),
};

loadEnvFile(process.env.ENV_FILE || path.join(ROOT, '.env'));
const cfg = readConfig();
const errors = validateConfig(cfg);
if (errors.length) {
  console.error(`Yapılandırma hatası:\n- ${errors.join('\n- ')}\n\n.env.example dosyasını .env olarak kopyalayıp doldur.`);
  process.exit(1);
}

const skill = loadSkill(cfg.skillDir);
const telegram = new Telegram(cfg.telegramToken, cfg.telegramApi);
const claude = new Claude(cfg, skill);

if (process.argv.includes('--kontrol') || process.argv.includes('--check')) {
  let ok = true;
  try {
    const me = await telegram.call('getMe');
    console.log(`✔ Telegram: @${me.username}`);
  } catch (e) {
    ok = false;
    console.log(`✖ Telegram: ${e.message}`);
  }
  try {
    const m = await claude.checkModel();
    console.log(`✔ Claude: ${m.id}${m.display_name ? ` (${m.display_name})` : ''}`);
  } catch (e) {
    ok = false;
    console.log(`✖ Claude: ${e.message}`);
  }
  console.log(`✔ Skill: ${cfg.skillDir} (${skill.chat.length} karakter)`);
  console.log(cfg.allowedUsers.size
    ? `✔ İzinli kullanıcılar: ${[...cfg.allowedUsers].join(', ')}`
    : '⚠ ALLOWED_USERS boş: botu başlat, Telegram\'dan yaz; bot kimliğini söyler.');
  console.log(cfg.stt.key ? '✔ Sesli mesaj açık' : '· Sesli mesaj kapalı (STT_API_KEY yok)');
  process.exit(ok ? 0 : 1);
}

const bot = new Bot({ cfg, telegram, claude, store: new ChatStore(cfg.dataDir), skill, log });
try {
  const me = await bot.start();
  log.info(`Nexus Telegram hazır: @${me.username} · ${cfg.model} · efor ${cfg.effort}`);
  if (!cfg.allowedUsers.size) log.warn('ALLOWED_USERS boş: bota yaz, kimliğini öğren, .env\'ye ekle, yeniden başlat.');
} catch (e) {
  log.error(`Başlatılamadı: ${e.message}`);
  process.exit(1);
}

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (stopping) process.exit(1);
    stopping = true;
    log.info('Kapanıyor…');
    await bot.stop();
    process.exit(0);
  });
}

await bot.loop;
if (bot.fatal) process.exit(1);
