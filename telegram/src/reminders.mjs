// Hatırlatmalar: Claude araç olarak kurar, bot zamanı gelince Telegram'dan yollar.
// Zamanlar kullanıcının yerel saat diliminde yorumlanır (TIMEZONE), epoch ms olarak saklanır.

export const REPEATS = { yok: '', her_gun: 'her gün', hafta_ici: 'hafta içi her gün', her_hafta: 'her hafta' };
const MAX_PER_CHAT = 50;

// Araç tanımları: sabit sırada ve değişmeden gönderilir ki önek önbelleği bozulmasın.
export const REMINDER_TOOLS = [
  {
    name: 'hatirlatici_kur',
    description: 'Belirtilen yerel zamanda kullanıcıya Telegram\'dan hatırlatma mesajı gönderir. Kullanıcı "hatırlat", "uyar", "haber ver" dediğinde kullan. "Yarın 15:00", "2 saat sonra" gibi göreli zamanları kullanıcı mesajındaki [tarih saat] damgasına göre mutlak zamana çevir.',
    input_schema: {
      type: 'object',
      properties: {
        zaman: { type: 'string', description: 'Yerel saat, "YYYY-MM-DD HH:MM" biçiminde' },
        metin: { type: 'string', description: 'Hatırlatma metni: kısa ve tek başına anlaşılır' },
        tekrar: { type: 'string', enum: Object.keys(REPEATS), description: 'Tekrar yoksa "yok"' },
      },
      required: ['zaman', 'metin', 'tekrar'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'hatirlaticilari_listele',
    description: 'Kurulu hatırlatmaları numaralarıyla listeler.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'hatirlatici_iptal',
    description: 'Numarası verilen hatırlatmayı iptal eder. Numarayı bilmiyorsan önce listele.',
    input_schema: {
      type: 'object',
      properties: { no: { type: 'integer', description: 'Hatırlatma numarası (#)' } },
      required: ['no'],
      additionalProperties: false,
    },
    strict: true,
  },
];

// ── saat dilimi hesapları (bağımlılıksız) ────────────────────────

const partsFmt = new Map();
export function tzParts(t, tz) {
  if (!partsFmt.has(tz)) {
    partsFmt.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }));
  }
  const p = Object.fromEntries(partsFmt.get(tz).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, wd: p.weekday };
}

// Yerel saat bileşenleri → epoch ms. Gün taşması (31+1) Date.UTC ile normalleşir.
export function zonedToEpoch({ y, mo, d, h, mi }, tz) {
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = tzParts(t, tz);
    const diff = want - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    if (!diff) break;
    t += diff;
  }
  return t;
}

export function parseLocal(str, tz) {
  const m = String(str).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/);
  if (!m) throw new Error(`Zaman "YYYY-MM-DD HH:MM" biçiminde olmalı: ${str}`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const check = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) {
    throw new Error(`Geçersiz tarih ya da saat: ${str}`);
  }
  return zonedToEpoch({ y, mo, d, h, mi }, tz);
}

const pad = (n) => String(n).padStart(2, '0');
const TR_DAYS = { Mon: 'Pzt', Tue: 'Sal', Wed: 'Çar', Thu: 'Per', Fri: 'Cum', Sat: 'Cmt', Sun: 'Paz' };

export function formatLocal(t, tz) {
  const p = tzParts(t, tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${TR_DAYS[p.wd]} ${pad(p.h)}:${pad(p.mi)}`;
}

// Tekrarlı hatırlatmanın `after`dan sonraki ilk zamanı; tekrar yoksa null.
export function nextOccurrence(at, repeat, tz, after = at) {
  if (!REPEATS[repeat]) return null;
  const p = tzParts(at, tz);
  for (let k = 1; k <= 3700; k++) {
    const t = zonedToEpoch({ ...p, d: p.d + k }, tz);
    if (repeat === 'her_hafta' && k % 7) continue;
    if (repeat === 'hafta_ici' && ['Sat', 'Sun'].includes(tzParts(t, tz).wd)) continue;
    if (t > after) return t;
  }
  return null;
}

// ── sohbet başına işlemler ───────────────────────────────────────

export function listReminders(s, tz) {
  const items = [...(s.reminders || [])].sort((a, b) => a.at - b.at);
  if (!items.length) return '';
  return items
    .map((r) => `#${r.id} · ${formatLocal(r.at, tz)}${REPEATS[r.repeat] ? ` (${REPEATS[r.repeat]})` : ''} — ${r.text}`)
    .join('\n');
}

export function addReminder(s, { zaman, metin, tekrar }, tz, now = Date.now()) {
  const at = parseLocal(zaman, tz);
  if (at < now - 60_000) throw new Error(`Bu zaman geçmişte: ${formatLocal(at, tz)} (şu an ${formatLocal(now, tz)})`);
  const text = String(metin || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!text) throw new Error('Hatırlatma metni boş.');
  s.reminders = s.reminders || [];
  if (s.reminders.length >= MAX_PER_CHAT) throw new Error(`En fazla ${MAX_PER_CHAT} hatırlatma kurulabilir.`);
  const repeat = REPEATS[tekrar] === undefined ? 'yok' : tekrar;
  const r = { id: (s.nextReminderId = (s.nextReminderId || 0) + 1), at, text, repeat };
  s.reminders.push(r);
  return r;
}

export function cancelReminder(s, id) {
  const r = (s.reminders || []).find((x) => x.id === Number(id));
  if (!r) throw new Error(`#${id} numaralı hatırlatma yok.`);
  s.reminders = s.reminders.filter((x) => x !== r);
  return r;
}

// ── zamanlayıcı ──────────────────────────────────────────────────

export class ReminderScheduler {
  constructor({ store, telegram, tz, log = console, now = () => Date.now(), everyMs = 15_000 }) {
    Object.assign(this, { store, tg: telegram, tz, log, now, everyMs });
  }

  start() {
    this.timer = setInterval(() => this.tick(), this.everyMs);
    this.timer.unref?.();
    return this.tick();
  }

  stop() {
    clearInterval(this.timer);
    return this.running;
  }

  tick() {
    if (!this.running) this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  async run() {
    const now = this.now();
    for (const [key, s] of this.store.cache) {
      const due = (s.reminders || []).filter((r) => r.at <= now);
      if (!due.length) continue;
      for (const r of due) {
        const late = now - r.at > 5 * 60_000;
        try {
          await this.tg.sendText(key, `⏰ ${r.text}${late ? `\n(gecikmeli; ${formatLocal(r.at, this.tz)} içindi)` : ''}`, { html: false });
        } catch (e) {
          this.log.warn(`[hatırlatma ${key}] gönderilemedi: ${e.message}`);
          r.failures = (r.failures || 0) + 1;
          if (r.failures < 5) continue; // sonraki turda yeniden dene
        }
        // Bir sonraki mesajda modele bağlam olarak gider (geçmişe kısa bir işaret).
        s.notes = [...(s.notes || []), `[${formatLocal(now, this.tz)} hatırlattım: «${r.text}»]`].slice(-5);
        const next = nextOccurrence(r.at, r.repeat, this.tz, now);
        if (next) Object.assign(r, { at: next, failures: 0 });
        else s.reminders = s.reminders.filter((x) => x !== r);
      }
      this.store.save(key);
    }
  }
}
