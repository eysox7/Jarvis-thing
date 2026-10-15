// Sohbet başına durum: data/chats/<chatId>.json
//   memory   kalıcı olgular (satır listesi)
//   summary  süren konunun özeti
//   turns    son mesajlar, YALNIZCA metin (düşünme blokları ve ekler saklanmaz)
// Yazma atomik: önce .tmp, sonra rename. Dosyalar yalnızca sahibine okunur (0600).

import fs from 'node:fs';
import path from 'node:path';

export function freshState() {
  return {
    memory: [],
    summary: '',
    turns: [],
    settings: {},
    usage: { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0, costUsd: 0 },
    lastPromptTokens: 0,
    lastActivity: 0,
    compactions: 0,
  };
}

export class ChatStore {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'chats');
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.cache = new Map();
  }

  file(chatId) {
    return path.join(this.dir, `${chatId}.json`);
  }

  get(chatId) {
    const key = String(chatId);
    if (this.cache.has(key)) return this.cache.get(key);
    const file = this.file(key);
    let state = freshState();
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      state = { ...state, ...saved, usage: { ...state.usage, ...saved.usage } };
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // Bozuk dosyayı ezme; kenara al ki elle kurtarılabilsin.
        const bad = `${file}.bozuk-${Date.now()}`;
        try { fs.renameSync(file, bad); } catch {}
        console.warn(`[depo] ${file} okunamadı (${e.message}); ${bad} olarak saklandı.`);
      }
    }
    this.cache.set(key, state);
    return state;
  }

  save(chatId) {
    const key = String(chatId);
    const state = this.cache.get(key);
    if (!state) return;
    const file = this.file(key);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  loadAll() {
    for (const f of fs.readdirSync(this.dir)) {
      const m = f.match(/^(-?\d+)\.json$/);
      if (m) this.get(m[1]);
    }
    return [...this.cache.keys()];
  }
}
