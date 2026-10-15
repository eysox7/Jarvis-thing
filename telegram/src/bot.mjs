// Bot: Telegram güncellemelerini alır, sohbet başına sırayla işler, Claude'a gönderir,
// geçmişi verimli-sohbet skill'inin damıtma kurallarıyla kompakt tutar.

import Anthropic from '@anthropic-ai/sdk';
import { addUsage } from './claude.mjs';
import { EFFORTS } from './config.mjs';
import { transcribe } from './stt.mjs';
import { TelegramError } from './telegram.mjs';

const sleep = (ms, signal) => new Promise((r) => {
  const t = setTimeout(r, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
});
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const words = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const kfmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const TR = { ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c' };
const fold = (s) => s.replace(/[ıİşŞğĞüÜöÖçÇ]/g, (c) => TR[c]).toLowerCase();

export const COMMANDS = [
  { command: 'yeni', description: 'Konuyu kapat: özet hafızaya, geçmiş temizlenir' },
  { command: 'hafiza', description: 'Kalıcı hafızayı ve özeti göster' },
  { command: 'hatirla', description: 'Hafızaya not ekle: /hatirla metin' },
  { command: 'unut', description: 'Hafızadan sil: /unut 3 veya /unut hepsi' },
  { command: 'durum', description: 'Token, maliyet ve ayarlar' },
  { command: 'efor', description: 'Düşünme seviyesi: /efor low|medium|high' },
  { command: 'web', description: 'Web araması: /web ac veya /web kapat' },
  { command: 'yardim', description: 'Komutlar ve kullanım' },
];

const ALIASES = {
  start: 'yardim', help: 'yardim', yardim: 'yardim', komutlar: 'yardim',
  yeni: 'yeni', new: 'yeni', hafiza: 'hafiza', memory: 'hafiza',
  hatirla: 'hatirla', remember: 'hatirla', unut: 'unut', forget: 'unut',
  durum: 'durum', status: 'durum', efor: 'efor', effort: 'efor', web: 'web',
};

export function parseCommand(text, botName) {
  const m = text?.match(/^\/([\p{L}\w]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/u);
  if (!m) return null;
  if (m[2] && botName && m[2].toLowerCase() !== botName.toLowerCase()) return null;
  return { name: ALIASES[fold(m[1])] || 'bilinmeyen', arg: (m[3] || '').trim() };
}

const HELP = `**Nexus · Telegram**
Yaz, sesli mesaj at, fotoğraf ya da PDF gönder; kısa ve işe yarar cevap gelir.
Art arda attığın mesajlar tek istekte birleşir. Uzayan sohbet kendiliğinden kompakt hafızaya damıtılır.

/yeni — konuyu kapat (özet hafızaya, geçmiş temizlenir)
/hafiza — hafızayı ve özeti göster
/hatirla <not> — hafızaya ekle
/unut <no | hepsi> — hafızadan sil
/durum — token, maliyet, ayarlar
/efor low|medium|high — düşünme seviyesi
/web ac|kapat — web araması`;

// Sistem isteminin bota özgü, sabit kısmı (önbelleğe uygun olsun diye değişmez).
const BOT_NOTE = `## Ortam
- Telegram üzerinden konuşuyorsun. Kullanıcı mesajının başındaki [tarih saat] onun yerel zamanıdır; cevapta tekrar etme.
- Biçim: **kalın**, \`kod\`, kod bloğu, "- " liste ve [metin](link) çalışır; başlık (#) ve tablo kullanma.
- Hafıza ve özet sistem tarafından otomatik tutulur; "hatırla" denirse kısaca onayla.
- [Fotoğraf], [PDF], [Dosya] işaretleri o turda gönderilmiş, artık geçmişte bulunmayan ekleri gösterir. [Sesli] mesaj dikteden yazıya çevrilmiştir.`;
const WEB_NOTE = '- Web aramasını yalnızca güncel ya da doğrulanması gereken bilgi için kullan.';

export function renderContext(memory, summary) {
  const parts = [];
  if (memory.length) parts.push(`<hafiza>\n${memory.map((m) => `- ${m}`).join('\n')}\n</hafiza>`);
  if (summary) parts.push(`<onceki_ozet>\n${summary}\n</onceki_ozet>`);
  if (!parts.length) return '';
  return `Kullanıcı hakkında bildiklerin ve önceki konuşmanın özeti. Doğrudan kullan, anons etme.\n${parts.join('\n')}`;
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const TEXT_EXT = /\.(txt|md|csv|tsv|json|ya?ml|xml|html?|css|js|mjs|ts|py|sh|log|ini|toml|sql)$/i;
const MAX_TEXT_FILE = 200 * 1024;

export class Bot {
  constructor({ cfg, telegram, claude, store, skill, log = console }) {
    Object.assign(this, { cfg, tg: telegram, claude, store, skill, log });
    this.offset = 0;
    this.chains = new Map();
    this.pending = new Map();
    this.rejected = new Map();
    this.running = false;
  }

  // ── yaşam döngüsü ──────────────────────────────────────────────

  async start() {
    const me = await this.tg.call('getMe');
    this.username = me.username;
    await this.tg.call('deleteWebhook').catch((e) => this.log.warn(`[başlangıç] ${e.message}`));
    await this.tg.call('setMyCommands', { commands: COMMANDS }).catch((e) => this.log.warn(`[başlangıç] ${e.message}`));
    this.store.loadAll();
    this.running = true;
    this.sweeper = setInterval(() => this.sweepIdle(), 10 * 60_000);
    this.sweeper.unref?.();
    this.loop = this.poll();
    return me;
  }

  async poll() {
    let backoff = 1000;
    while (this.running) {
      this.abort = new AbortController();
      try {
        const updates = await this.tg.getUpdates(this.offset, this.cfg.pollTimeout, this.abort.signal);
        backoff = 1000;
        for (const u of updates) {
          this.offset = u.update_id + 1;
          try {
            this.onUpdate(u);
          } catch (e) {
            this.log.error(`[güncelleme] ${e.stack || e.message}`);
          }
        }
      } catch (e) {
        if (!this.running || e.name === 'AbortError') break;
        if (e.code === 401 || e.code === 404) {
          this.log.error('Telegram token geçersiz. BotFather\'dan aldığın TELEGRAM_BOT_TOKEN değerini kontrol et.');
          this.fatal = e;
          this.running = false;
          break;
        }
        this.log.warn(e.code === 409
          ? '[yoklama] 409: bu token ile başka bir bot örneği çalışıyor.'
          : `[yoklama] ${e.message}`);
        await sleep(backoff, this.abort.signal);
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  async stop() {
    this.running = false;
    this.abort?.abort();
    clearInterval(this.sweeper);
    for (const key of [...this.pending.keys()]) this.flush(key);
    await this.loop;
    await Promise.allSettled([...this.chains.values()]);
    // İşlenen güncellemeleri onayla ki yeniden başlayınca tekrar gelmesin.
    if (this.offset) {
      await this.tg.call('getUpdates', { offset: this.offset, timeout: 0 }, { retries: 0 }).catch(() => {});
    }
  }

  // ── yönlendirme ────────────────────────────────────────────────

  onUpdate(u) {
    const msg = u.message;
    if (!msg?.from || msg.chat?.type !== 'private') return;
    if (!this.cfg.allowedUsers.has(msg.from.id)) return this.rejectUnauthorized(msg);
    const key = String(msg.chat.id);
    const cmd = parseCommand(msg.text, this.username);
    if (cmd) {
      this.flush(key);
      this.enqueue(key, () => this.handleCommand(key, cmd));
      return;
    }
    // Art arda gelen mesajları kısa bir pencerede biriktir: tek istek, tek sistem istemi.
    let p = this.pending.get(key);
    if (!p) this.pending.set(key, (p = { msgs: [], timer: null }));
    p.msgs.push(msg);
    clearTimeout(p.timer);
    p.timer = setTimeout(() => this.flush(key), this.cfg.mergeWindowMs);
  }

  flush(key) {
    const p = this.pending.get(key);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(key);
    this.enqueue(key, () => this.handleMessages(key, p.msgs));
  }

  // Aynı sohbetin işleri sırayla koşar; farklı sohbetler birbirini beklemez.
  enqueue(key, fn) {
    const next = (this.chains.get(key) || Promise.resolve())
      .then(fn)
      .catch((e) => this.log.error(`[sohbet ${key}] ${e.stack || e.message}`));
    this.chains.set(key, next);
    return next;
  }

  rejectUnauthorized(msg) {
    const uid = msg.from.id;
    if (Date.now() - (this.rejected.get(uid) || 0) < 3600_000) return;
    this.rejected.set(uid, Date.now());
    this.log.warn(`[yetki] izinsiz kullanıcı: ${uid} (@${msg.from.username || '-'})`);
    const text = this.cfg.allowedUsers.size
      ? '⛔ Bu bot özel.'
      : `👋 Kurulum adımı: kullanıcı kimliğin \`${uid}\`\n.env dosyasına ALLOWED_USERS=${uid} yaz ve botu yeniden başlat.`;
    this.tg.sendText(msg.chat.id, text).catch(() => {});
  }

  keepTyping(chatId) {
    this.tg.typing(chatId);
    const t = setInterval(() => this.tg.typing(chatId), 4500);
    return () => clearInterval(t);
  }

  stamp(d = new Date()) {
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: this.cfg.timezone, weekday: 'short', day: '2-digit', month: '2-digit',
      year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(d);
  }

  webOn(s) {
    return (s.settings.web ?? this.cfg.webSearch) && !this.claude.disabled.has('web');
  }

  buildSystem(s) {
    const blocks = [{
      type: 'text',
      text: `${this.skill.chat}\n\n${BOT_NOTE}${this.webOn(s) ? `\n${WEB_NOTE}` : ''}`,
    }];
    const ctx = renderContext(s.memory, s.summary);
    if (ctx) blocks.push({ type: 'text', text: ctx });
    return blocks;
  }

  // ── mesaj işleme ───────────────────────────────────────────────

  // Mesajları bu tura özel eklere (blocks) ve geçmişe girecek metne (lines) ayırır.
  // Ekler yalnızca bu turda gider; geçmişte "[Fotoğraf]" gibi kısa bir işaret kalır.
  async collect(chatId, msgs) {
    const blocks = [];
    const lines = [];
    const notices = [];
    for (const m of msgs) {
      let text = (m.text || m.caption || '').trim();
      const tags = [];
      if (m.forward_origin) tags.push('[İletilen mesaj]');
      const q = m.reply_to_message;
      if (q && (q.text || q.caption)) tags.push(`[Yanıtlanan: «${clip(q.text || q.caption, 300)}»]`);
      try {
        if (m.photo?.length) {
          const { buffer } = await this.tg.download(m.photo.at(-1).file_id);
          blocks.push(imageBlock('image/jpeg', buffer));
          tags.push('[Fotoğraf]');
        } else if (m.document) {
          tags.push(await this.documentBlock(m.document, blocks));
        } else if (m.voice || m.audio) {
          const said = await this.transcribeVoice(chatId, m.voice || m.audio);
          tags.push('[Sesli]');
          text = [said, text].filter(Boolean).join('\n');
        } else if (m.location) {
          const v = m.venue;
          tags.push(`[Konum: ${m.location.latitude.toFixed(5)}, ${m.location.longitude.toFixed(5)}${v ? ` · ${v.title}, ${v.address}` : ''}]`);
        } else if (!text) {
          notices.push('Bu mesaj türünü işleyemiyorum (metin, fotoğraf, PDF, metin dosyası, ses, konum).');
          continue;
        }
      } catch (e) {
        notices.push(e.message);
        if (!text) continue;
      }
      lines.push([...tags, text].filter(Boolean).join(' '));
    }
    return { blocks, lines, notices };
  }

  async documentBlock(d, blocks) {
    const name = d.file_name || 'dosya';
    const mime = d.mime_type || '';
    if (d.file_size > 20 * 1024 * 1024) throw new Error(`${name}: 20 MB üstü dosyaları Telegram botlara vermiyor.`);
    const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(name);
    const isText = mime.startsWith('text/') || /json|xml|yaml|javascript/.test(mime) || TEXT_EXT.test(name);
    if (!isPdf && !IMAGE_TYPES.has(mime) && !isText) throw new Error(`${name}: bu dosya türü desteklenmiyor.`);
    if (isText && !isPdf && d.file_size > MAX_TEXT_FILE) throw new Error(`${name}: metin dosyası 200 KB'tan büyük.`);
    const { buffer } = await this.tg.download(d.file_id);
    if (isPdf) {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } });
      return `[PDF: ${name}]`;
    }
    if (IMAGE_TYPES.has(mime)) {
      blocks.push(imageBlock(mime, buffer));
      return `[Fotoğraf: ${name}]`;
    }
    blocks.push({ type: 'text', text: `<dosya ad="${name.replace(/"/g, "'")}">\n${buffer.toString('utf8')}\n</dosya>` });
    return `[Dosya: ${name}]`;
  }

  async transcribeVoice(chatId, v) {
    if (!this.cfg.stt.key) throw new Error('Sesli mesaj için .env dosyasına STT_API_KEY ekle (ör. ücretsiz Groq anahtarı).');
    const { buffer, path } = await this.tg.download(v.file_id);
    const ext = (path.split('.').pop() || 'ogg').replace(/^oga$/, 'ogg');
    const said = await transcribe(this.cfg.stt, buffer, `ses.${ext}`, v.mime_type || 'audio/ogg');
    if (!said) throw new Error('Seste konuşma algılanmadı.');
    if (this.cfg.showTranscript) await this.tg.sendText(chatId, `🎙 ${said}`, { html: false });
    return said;
  }

  async handleMessages(chatId, msgs) {
    const s = this.store.get(chatId);
    const stopTyping = this.keepTyping(chatId);
    try {
      const { blocks, lines, notices } = await this.collect(chatId, msgs);
      for (const n of notices) await this.tg.sendText(chatId, `⚠️ ${n}`, { html: false });
      if (!lines.length) return;

      const turnText = `[${this.stamp()}] ${lines.join('\n')}`;
      const messages = [
        ...s.turns.map((t) => ({ role: t.role, content: t.text })),
        { role: 'user', content: [...blocks, { type: 'text', text: turnText }] },
      ];
      const r = await this.claude.chat({
        system: this.buildSystem(s),
        messages,
        effort: s.settings.effort || this.cfg.effort,
        web: this.webOn(s),
      });
      addUsage(s.usage, r.usage);
      s.lastActivity = Date.now();

      if (r.refused) {
        this.store.save(chatId);
        await this.tg.sendText(chatId, '⚠️ Bunu yanıtlayamıyorum (güvenlik filtresi). Farklı ifade etmeyi dene.', { html: false });
        return;
      }

      let reply = r.text || '(boş yanıt)';
      if (r.truncated) reply += '\n\n…(yanıt uzunluk sınırında kesildi)';
      s.turns.push({ role: 'user', text: turnText }, { role: 'assistant', text: reply });
      s.lastPromptTokens = r.promptTokens;
      this.store.save(chatId);

      // Kaynak bağlantıları kullanıcıya gider ama geçmişe yazılmaz (token).
      const links = r.sources.slice(0, 3).map((x) => `🔗 [${x.title.replace(/[[\]]/g, '')}](${x.url})`);
      await this.tg.sendText(chatId, links.length ? `${reply}\n\n${links.join('\n')}` : reply);

      const nextPrompt = r.promptTokens + Math.ceil(reply.length / 3);
      if (nextPrompt > this.cfg.compactAtTokens || s.turns.length > this.cfg.hardMaxTurns) {
        await this.compact(chatId);
      }
    } catch (e) {
      this.log.error(`[sohbet ${chatId}] ${e.stack || e.message}`);
      await this.tg.sendText(chatId, `⚠️ ${friendly(e)}`, { html: false }).catch(() => {});
    } finally {
      stopTyping();
    }
  }

  // Eski mesajları hafıza + özete damıtır; son `keep` mesaj olduğu gibi kalır.
  async compact(chatId, { keep = this.cfg.keepTurns, closing = false } = {}) {
    const s = this.store.get(chatId);
    const cut = s.turns.length - keep;
    if (cut <= 0) return { ok: false, reason: 'damıtılacak mesaj yok' };
    try {
      const r = await this.claude.distill({ memory: s.memory, summary: s.summary, turns: s.turns.slice(0, cut), closing });
      addUsage(s.usage, r.usage);
      Object.assign(s, { memory: r.memory, summary: r.summary, turns: s.turns.slice(cut), lastPromptTokens: 0 });
      s.compactions++;
      this.store.save(chatId);
      this.log.info(`[hafiza ${chatId}] ${cut} mesaj damıtıldı → ${s.memory.length} satır hafıza, ${words(s.summary)} kelime özet`);
      return { ok: true };
    } catch (e) {
      if (e.usage) addUsage(s.usage, e.usage);
      this.log.warn(`[hafiza ${chatId}] damıtma başarısız: ${e.message}`);
      // Son çare: geçmiş sınırsız büyümesin.
      const max = this.cfg.hardMaxTurns - (this.cfg.hardMaxTurns % 2);
      if (s.turns.length > max) s.turns = s.turns.slice(-max);
      this.store.save(chatId);
      return { ok: false, reason: friendly(e) };
    }
  }

  // Uzun süre sessiz kalan sohbeti arka planda damıt: önbellek zaten soğudu,
  // dönüşteki ilk mesaj tam geçmişi pahalıya göndermesin.
  sweepIdle() {
    const idleMs = this.cfg.idleCompactMinutes * 60_000;
    if (!idleMs) return;
    for (const [key, s] of this.store.cache) {
      if (this.pending.has(key) || !s.lastActivity) continue;
      if (s.turns.length <= this.cfg.keepTurns || Date.now() - s.lastActivity < idleMs) continue;
      if ((s.idleCompactedAt || 0) > s.lastActivity) continue; // bu sessizlikte zaten denendi
      s.idleCompactedAt = Date.now();
      this.enqueue(key, () => this.compact(key));
    }
  }

  // ── komutlar ───────────────────────────────────────────────────

  async handleCommand(chatId, cmd) {
    const s = this.store.get(chatId);
    const say = (t, o) => this.tg.sendText(chatId, t, o);
    const save = () => this.store.save(chatId);

    switch (cmd.name) {
      case 'yardim':
        return say(HELP);

      case 'yeni': {
        if (!s.turns.length) return say('Geçmiş zaten temiz.');
        const stopTyping = this.keepTyping(chatId);
        try {
          const r = await this.compact(chatId, { keep: 0, closing: true });
          return r.ok
            ? say(`✅ Konu kapatıldı. Hafıza: ${s.memory.length} satır${s.summary ? ' · açık işler özette' : ''}.`)
            : say(`⚠️ Özetlenemedi, geçmiş korunuyor: ${r.reason}`, { html: false });
        } finally {
          stopTyping();
        }
      }

      case 'hafiza':
        return say(memoryView(s));

      case 'hatirla': {
        const note = cmd.arg.replace(/\s+/g, ' ');
        if (!note) return say('Kullanım: /hatirla <not>');
        if (!s.memory.some((m) => m.toLowerCase() === note.toLowerCase())) s.memory.push(note);
        save();
        return say(`✅ Hafızada (${s.memory.length} satır).`);
      }

      case 'unut': {
        const a = fold(cmd.arg);
        if (!a) return say(`${memoryView(s)}\n\nKullanım: /unut 3 · /unut 2,5 · /unut ozet · /unut hepsi`);
        if (['hepsi', 'tumu', 'all'].includes(a)) {
          Object.assign(s, { memory: [], summary: '', turns: [], lastPromptTokens: 0 });
          save();
          return say('🧹 Hafıza, özet ve geçmiş silindi.');
        }
        if (a === 'ozet') {
          s.summary = '';
          save();
          return say('🧹 Özet silindi.');
        }
        const idx = [...a.matchAll(/\d+/g)].map((x) => +x[0] - 1).filter((i) => i >= 0 && i < s.memory.length);
        if (!idx.length) return say('Geçerli satır numarası yok. /hafiza ile bak.');
        const removed = idx.map((i) => s.memory[i]);
        s.memory = s.memory.filter((_, i) => !idx.includes(i));
        save();
        return say(`🗑 Silindi: ${removed.join(' · ')}`, { html: false });
      }

      case 'durum':
        return say(this.statusText(s));

      case 'efor': {
        const a = cmd.arg.toLowerCase();
        if (!EFFORTS.includes(a)) {
          return say(`Şu an: ${s.settings.effort || this.cfg.effort}\nKullanım: /efor low | medium | high | xhigh | max\nlow: hızlı ve ucuz, sohbet için · high: zor sorular için`);
        }
        s.settings.effort = a;
        save();
        return say(`✅ Efor: ${a}`);
      }

      case 'web': {
        const a = fold(cmd.arg);
        if (/^(ac|on|acik|evet)$/.test(a)) s.settings.web = true;
        else if (/^(kapat|off|kapali|hayir)$/.test(a)) s.settings.web = false;
        else return say(`Web araması: ${this.webOn(s) ? 'açık' : 'kapalı'}\nKullanım: /web ac · /web kapat`);
        save();
        const blocked = s.settings.web && this.claude.disabled.has('web');
        return say(`✅ Web araması ${s.settings.web ? 'açık' : 'kapalı'}.${blocked ? ' (API reddettiği için bu oturumda devre dışı.)' : ''}`);
      }

      default:
        return say('Bilinmeyen komut. /yardim');
    }
  }

  statusText(s) {
    const u = s.usage;
    return [
      '📊 **Durum**',
      `Model: \`${this.cfg.model}\` · efor: ${s.settings.effort || this.cfg.effort} · web: ${this.webOn(s) ? 'açık' : 'kapalı'}`,
      `Geçmiş: ${s.turns.length} mesaj · son istem ~${kfmt(s.lastPromptTokens)} token (damıtma eşiği ${kfmt(this.cfg.compactAtTokens)})`,
      `Hafıza: ${s.memory.length} satır · özet ${words(s.summary)} kelime · ${s.compactions} kez damıtıldı`,
      `Toplam: ${u.requests} istek · giriş ${kfmt(u.input + u.cacheRead + u.cacheWrite)} (önbellekten ${kfmt(u.cacheRead)}) · çıkış ${kfmt(u.output)}${u.webSearches ? ` · ${u.webSearches} arama` : ''}`,
      `Tahmini maliyet: $${u.costUsd.toFixed(3)}`,
    ].join('\n');
  }
}

function imageBlock(mime, buffer) {
  return { type: 'image', source: { type: 'base64', media_type: mime, data: buffer.toString('base64') } };
}

function memoryView(s) {
  const parts = [`🧠 **Kalıcı hafıza** (${s.memory.length})`];
  parts.push(s.memory.length ? s.memory.map((m, i) => `${i + 1}. ${m}`).join('\n') : '— boş —');
  if (s.summary) parts.push(`\n📝 **Özet**\n${s.summary}`);
  parts.push(`\n💬 Geçmiş: ${s.turns.length} mesaj`);
  return parts.join('\n');
}

export function friendly(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Anthropic API anahtarı geçersiz (.env → ANTHROPIC_API_KEY).';
  if (e instanceof Anthropic.PermissionDeniedError) return 'API anahtarının bu modele ya da özelliğe izni yok.';
  if (e instanceof Anthropic.NotFoundError) return 'Model bulunamadı (.env → BOT_MODEL).';
  if (e instanceof Anthropic.RateLimitError) return 'Hız ya da kota sınırı. Biraz sonra tekrar dene.';
  if (e instanceof Anthropic.APIConnectionError) return 'Claude\'a bağlanılamadı (ağ). Tekrar dene.';
  if (e instanceof Anthropic.BadRequestError) return `İstek reddedildi: ${clip(e.error?.error?.message || e.message, 300)}`;
  if (e instanceof Anthropic.APIError && (e.status >= 500 || e.status === 529)) return 'Claude şu an yoğun; birazdan tekrar dene.';
  if (e instanceof TelegramError) return `Telegram hatası: ${e.description || e.code}`;
  return `Beklenmeyen hata: ${e.message}`;
}
