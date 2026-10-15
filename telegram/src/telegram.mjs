// Telegram Bot API istemcisi: yalnızca fetch. Uzun yoklama (getUpdates) kullanır,
// yani dışarıya açık bir adres, alan adı veya webhook gerekmez.

import { splitMessage, toTelegramHTML } from './format.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class TelegramError extends Error {
  constructor(method, code, description, parameters) {
    super(`Telegram ${method}: ${code} ${description || ''}`.trim());
    this.method = method;
    this.code = code;
    this.description = description || '';
    this.parameters = parameters || {};
  }
}

export class Telegram {
  constructor(token, base = 'https://api.telegram.org') {
    this.token = token;
    this.base = base;
  }

  // Hata mesajlarına token sızmasın.
  scrub(msg) {
    return String(msg).split(this.token).join('<token>');
  }

  async call(method, params = {}, { signal, retries = 3 } = {}) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(`${this.base}/bot${this.token}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(params),
          signal,
        });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        throw new TelegramError(method, 'NETWORK', this.scrub(e.cause?.message || e.message));
      }
      let data;
      try {
        data = await res.json();
      } catch {
        throw new TelegramError(method, res.status, `HTTP ${res.status}`);
      }
      if (data.ok) return data.result;
      const err = new TelegramError(method, data.error_code ?? res.status, data.description, data.parameters);
      const wait = err.parameters.retry_after;
      if (err.code === 429 && wait && wait <= 60 && attempt < retries) {
        await sleep(wait * 1000);
        continue;
      }
      throw err;
    }
  }

  getUpdates(offset, timeout, signal) {
    return this.call('getUpdates', { offset, timeout, allowed_updates: ['message'] }, { signal, retries: 0 });
  }

  typing(chatId) {
    return this.call('sendChatAction', { chat_id: chatId, action: 'typing' }, { retries: 0 }).catch(() => {});
  }

  // Markdown → HTML ile gönderir; Telegram biçimi reddederse aynı parçayı düz metin yollar.
  async sendText(chatId, text, { html = true } = {}) {
    const sent = [];
    for (const chunk of splitMessage(text)) {
      const base = { chat_id: chatId, link_preview_options: { is_disabled: true } };
      if (html) {
        const body = toTelegramHTML(chunk);
        if (body.length <= 4096) {
          try {
            sent.push(await this.call('sendMessage', { ...base, text: body, parse_mode: 'HTML' }));
            continue;
          } catch (e) {
            if (!(e.code === 400 && /parse|entit|tag/i.test(e.description))) throw e;
          }
        }
      }
      sent.push(await this.call('sendMessage', { ...base, text: chunk }));
    }
    return sent;
  }

  // Dosyayı indirir. Bot API dosya sınırı 20 MB.
  async download(fileId) {
    const file = await this.call('getFile', { file_id: fileId });
    if (!file.file_path) throw new Error('Dosya yolu alınamadı (20 MB üstü olabilir).');
    let res;
    try {
      res = await fetch(`${this.base}/file/bot${this.token}/${file.file_path}`);
    } catch (e) {
      throw new Error(`Dosya indirilemedi: ${this.scrub(e.cause?.message || e.message)}`);
    }
    if (!res.ok) throw new Error(`Dosya indirilemedi: HTTP ${res.status}`);
    return { buffer: Buffer.from(await res.arrayBuffer()), path: file.file_path };
  }
}
