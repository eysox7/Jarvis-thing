// Test düzeneği: sahte Telegram Bot API'si ve sahte Claude Messages API'si.
// Gerçek ağ, token ya da API anahtarı gerekmez.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Bot } from '../src/bot.mjs';
import { Claude } from '../src/claude.mjs';
import { readConfig } from '../src/config.mjs';
import { loadSkill } from '../src/skill.mjs';
import { ChatStore } from '../src/store.mjs';
import { Telegram } from '../src/telegram.mjs';

export const TOKEN = '123456:TEST-token-abcdefghijklmnop';
export const USER = 42;

export async function mockServer(handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    let body = raw;
    if (/json/.test(req.headers['content-type'] || '')) {
      try { body = JSON.parse(raw.toString() || '{}'); } catch {}
    }
    const out = await handler(req, body, res);
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(out?.status || 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out?.json ?? {}));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}

const ok = (result) => ({ json: { ok: true, result } });

export async function fakeTelegram() {
  const state = { updates: [], sent: [], calls: [], files: new Map(), rejectHtml: false, nextUpdate: 1, nextMsg: 1 };
  let wake = null;
  const srv = await mockServer(async (req, body, res) => {
    const file = req.url.match(/^\/file\/bot[^/]+\/(.+)$/);
    if (file) {
      const buf = state.files.get(file[1]);
      res.writeHead(buf ? 200 : 404);
      res.end(buf || '');
      return;
    }
    const m = req.url.match(/^\/bot([^/]+)\/(\w+)/);
    if (!m || m[1] !== TOKEN) return { status: 401, json: { ok: false, error_code: 401, description: 'Unauthorized' } };
    const method = m[2];
    state.calls.push({ method, body });
    switch (method) {
      case 'getMe':
        return ok({ id: 999, is_bot: true, username: 'test_bot' });
      case 'getUpdates': {
        const off = body.offset || 0;
        state.updates = state.updates.filter((u) => u.update_id >= off);
        if (!state.updates.length && body.timeout) {
          await new Promise((r) => { wake = r; setTimeout(r, 100); });
        }
        return ok(state.updates.filter((u) => u.update_id >= off));
      }
      case 'sendMessage':
        if (body.parse_mode === 'HTML' && state.rejectHtml) {
          state.rejectHtml = false;
          return { status: 400, json: { ok: false, error_code: 400, description: "Bad Request: can't parse entities" } };
        }
        state.sent.push(body);
        return ok({ message_id: state.nextMsg++ });
      case 'getFile': {
        const [p] = [...state.files.keys()].filter((k) => k.includes(body.file_id));
        return ok({ file_id: body.file_id, file_path: p });
      }
      default:
        return ok(true);
    }
  });
  return {
    ...srv,
    state,
    push(message) {
      state.updates.push({ update_id: state.nextUpdate++, message });
      wake?.();
    },
    texts: () => state.sent.map((s) => s.text),
  };
}

export function apiMessage({ text = 'Tamam.', stop_reason = 'end_turn', usage = {}, content } = {}) {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: content ?? [{ type: 'text', text }],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage },
  };
}

// Gerçek API'nin akış biçimi: message_start, blok başına start/delta/stop, message_delta, message_stop.
function writeSSE(res, msg) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const { content, stop_reason, usage, ...rest } = msg;
  ev('message_start', { message: { ...rest, content: [], stop_reason: null, usage: { ...usage, output_tokens: 1 } } });
  content.forEach((b, index) => {
    if (b.type === 'text') {
      const { text, ...head } = b;
      ev('content_block_start', { index, content_block: { ...head, text: '' } });
      ev('content_block_delta', { index, delta: { type: 'text_delta', text } });
    } else if (b.type === 'tool_use') {
      ev('content_block_start', { index, content_block: { ...b, input: {} } });
      ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    } else if (b.type === 'thinking') {
      ev('content_block_start', { index, content_block: { ...b, signature: '' } });
      ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: b.signature } });
    } else {
      ev('content_block_start', { index, content_block: b });
    }
    ev('content_block_stop', { index });
  });
  ev('message_delta', { delta: { stop_reason, stop_sequence: null }, usage });
  ev('message_stop', {});
  res.end();
}

// chat(body, n) ve distill(body, n) yanıt üretir (n: kaçıncı istek); { status, json } dönerse HTTP hatası verir.
export async function fakeClaude() {
  const state = {
    requests: [],
    chat: () => ({ text: 'Tamam.' }),
    distill: () => ({ text: '<hafiza>\n- Kullanıcı test ediyor\n</hafiza>\n<ozet>\nTest sürüyor.\n</ozet>' }),
  };
  const srv = await mockServer(async (req, body, res) => {
    if (req.url.startsWith('/v1/models/')) {
      return { json: { id: 'claude-opus-5-5', type: 'model', display_name: 'Claude Opus 5.5' } };
    }
    const kind = typeof body.system === 'string' ? 'distill' : 'chat';
    state.requests.push({ kind, body, headers: req.headers, url: req.url });
    const r = state[kind](body, state.requests.filter((x) => x.kind === kind).length);
    if (r.status) return r;
    const msg = apiMessage(r);
    if (!body.stream) return { json: msg };
    writeSSE(res, msg);
    return null;
  });
  return {
    ...srv,
    state,
    chats: () => state.requests.filter((r) => r.kind === 'chat'),
    distills: () => state.requests.filter((r) => r.kind === 'distill'),
  };
}

const quiet = { info() {}, warn() {}, error() {} };

export async function setup(env = {}) {
  const tg = await fakeTelegram();
  const cl = await fakeClaude();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-tg-'));
  const cfg = readConfig({
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_API_BASE: tg.url,
    ALLOWED_USERS: String(USER),
    ANTHROPIC_API_KEY: 'sk-ant-test',
    ANTHROPIC_BASE_URL: cl.url,
    DATA_DIR: dataDir,
    MERGE_WINDOW_MS: '30',
    POLL_TIMEOUT: '1',
    ...env,
  });
  const skill = loadSkill(cfg.skillDir);
  const store = new ChatStore(cfg.dataDir);
  const bot = new Bot({ cfg, telegram: new Telegram(cfg.telegramToken, cfg.telegramApi), claude: new Claude(cfg, skill), store, skill, log: quiet });
  await bot.start();
  return {
    tg, cl, bot, cfg, store,
    state: () => store.get(String(USER)),
    saved: () => JSON.parse(fs.readFileSync(path.join(dataDir, 'chats', `${USER}.json`), 'utf8')),
    async close() {
      await bot.stop();
      await tg.close();
      await cl.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

let mid = 1;
export function userMsg(text, extra = {}) {
  return {
    message_id: mid++,
    date: Math.floor(Date.now() / 1000),
    chat: { id: USER, type: 'private' },
    from: { id: USER, is_bot: false, first_name: 'Test' },
    ...(text === undefined ? {} : { text }),
    ...extra,
  };
}

export async function waitFor(fn, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`waitFor zaman aşımı: ${fn}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

// Gönderilen n. mesajı bekler (1'den başlar).
export const waitSent = (h, n) => waitFor(() => h.tg.state.sent.length >= n && h.tg.state.sent[n - 1]);
