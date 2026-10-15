// Yapılandırma: .env dosyası + ortam değişkenleri. Bağımlılık yok.
// Ortamda zaten tanımlı bir değişken .env'dekini ezer (Docker/systemd için).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export function loadEnvFile(file, env = process.env) {
  if (!fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let [, key, val] = m;
    if (/^(['"]).*\1$/.test(val)) val = val.slice(1, -1);
    else val = val.replace(/\s+#.*$/, '');
    if (env[key] === undefined) env[key] = val;
  }
  return true;
}

const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|on|yes|evet|acik|açık)$/i.test(v.trim()));
const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

export function readConfig(env = process.env) {
  const model = env.BOT_MODEL?.trim() || 'claude-opus-5-5';
  const keep = Math.max(0, int(env.KEEP_TURNS, 4));
  return {
    telegramToken: env.TELEGRAM_BOT_TOKEN?.trim() || '',
    telegramApi: (env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, ''),
    allowedUsers: new Set(
      (env.ALLOWED_USERS || '').split(/[,\s]+/).filter(Boolean).map(Number).filter(Number.isFinite),
    ),

    anthropicKey: env.ANTHROPIC_API_KEY?.trim() || '',
    anthropicBaseURL: env.ANTHROPIC_BASE_URL?.trim() || undefined,
    model,
    memoryModel: env.MEMORY_MODEL?.trim() || model,
    effort: (env.BOT_EFFORT || 'low').trim().toLowerCase(),
    maxTokens: int(env.MAX_TOKENS, 64000),
    webSearch: bool(env.WEB_SEARCH, true),
    webSearchMaxUses: int(env.WEB_SEARCH_MAX_USES, 3),
    fallbacks: bool(env.FALLBACKS, true),
    promptCache: bool(env.PROMPT_CACHE, true),

    // Hafıza / sıkıştırma
    compactAtTokens: int(env.COMPACT_AT_TOKENS, 8000),
    keepTurns: keep - (keep % 2), // kullanıcı+asistan çiftleri hâlinde
    idleCompactMinutes: int(env.IDLE_COMPACT_MINUTES, 180),
    memoryMaxItems: int(env.MEMORY_MAX_ITEMS, 40),
    hardMaxTurns: int(env.HARD_MAX_TURNS, 40),
    mergeWindowMs: int(env.MERGE_WINDOW_MS, 1500),
    reminders: bool(env.REMINDERS, true),

    // Sesli mesaj → yazı (isteğe bağlı, OpenAI-uyumlu /audio/transcriptions)
    stt: {
      key: env.STT_API_KEY?.trim() || '',
      url: env.STT_API_URL?.trim() || 'https://api.groq.com/openai/v1/audio/transcriptions',
      model: env.STT_MODEL?.trim() || 'whisper-large-v3-turbo',
      language: env.STT_LANGUAGE?.trim() ?? 'tr',
    },
    showTranscript: bool(env.SHOW_TRANSCRIPT, true),

    timezone: env.TIMEZONE?.trim() || 'Europe/Istanbul',
    dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
    skillDir: path.resolve(ROOT, env.SKILL_DIR || '../.claude/skills/verimli-sohbet'),
    pollTimeout: int(env.POLL_TIMEOUT, 50),
  };
}

export function validateConfig(cfg) {
  const errors = [];
  if (!/^\d+:[\w-]{20,}$/.test(cfg.telegramToken)) {
    errors.push('TELEGRAM_BOT_TOKEN eksik veya hatalı (BotFather\'dan alınan "123456:ABC..." biçimi).');
  }
  if (!cfg.anthropicKey) errors.push('ANTHROPIC_API_KEY eksik (https://platform.claude.com/settings/keys).');
  if (!EFFORTS.includes(cfg.effort)) errors.push(`BOT_EFFORT şunlardan biri olmalı: ${EFFORTS.join(', ')}`);
  try {
    new Intl.DateTimeFormat('tr-TR', { timeZone: cfg.timezone });
  } catch {
    errors.push(`TIMEZONE geçersiz: ${cfg.timezone} (ör. Europe/Istanbul)`);
  }
  if (!fs.existsSync(path.join(cfg.skillDir, 'SKILL.md'))) {
    errors.push(`Skill bulunamadı: ${cfg.skillDir}/SKILL.md (SKILL_DIR ile yolu ver).`);
  }
  return errors;
}
