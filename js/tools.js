// Araç kayıt defteri. Ajan bunları isimle çağırır.
// Her araç: {name, desc, params, danger?, run(args, ctx)}
// ctx = { confirm(msg), ask(question), notify(t,b), settings, refresh() }

import * as S from './store.js';
import { calcExpression, parseWhen, fmtDate, truncate } from './util.js';
import * as MCP from './mcp.js';
import * as G from './google.js';

const T = {};
const def = (t) => { T[t.name] = t; return t; };

/* ---------------- görevler ---------------- */

def({
  name: 'task_add',
  desc: 'Yeni bir görev oluşturur.',
  params: {
    title: 'string (zorunlu) — görev başlığı',
    notes: 'string — detay',
    due: 'string — son tarih: ISO tarih, "yarın 15:00", "2 saat sonra", "30 dk"',
    priority: '"low" | "normal" | "high"',
  },
  run: (a) => {
    if (!a.title) throw new Error('title zorunlu');
    const t = S.addTask({
      title: String(a.title),
      notes: a.notes ? String(a.notes) : '',
      due: parseWhen(a.due),
      priority: ['low', 'normal', 'high'].includes(a.priority) ? a.priority : 'normal',
    });
    return { id: t.id, title: t.title, due: t.due ? fmtDate(t.due) : null, priority: t.priority };
  },
});

def({
  name: 'task_list',
  desc: 'Görevleri listeler.',
  params: { status: '"open" | "done" | "all" (varsayılan open)', query: 'string — başlıkta arama' },
  run: (a) => {
    const st = a.status || 'open';
    let list = S.db().tasks;
    if (st !== 'all') list = list.filter((t) => t.status === st);
    if (a.query) {
      const q = String(a.query).toLocaleLowerCase('tr');
      list = list.filter((t) => (t.title + ' ' + t.notes).toLocaleLowerCase('tr').includes(q));
    }
    return {
      count: list.length,
      tasks: list.slice(0, 60).map((t) => ({
        id: t.id, title: t.title, status: t.status, priority: t.priority,
        due: t.due ? fmtDate(t.due) : null, notes: t.notes || undefined,
      })),
    };
  },
});

def({
  name: 'task_update',
  desc: 'Bir görevi günceller (tamamlamak için status="done").',
  params: {
    id: 'string (zorunlu) — task_list ile öğrenilir',
    title: 'string', notes: 'string', due: 'string', priority: 'string',
    status: '"open" | "done"',
  },
  run: (a) => {
    if (!a.id) throw new Error('id zorunlu');
    const patch = {};
    for (const k of ['title', 'notes', 'priority', 'status']) if (a[k] !== undefined) patch[k] = a[k];
    if (a.due !== undefined) patch.due = parseWhen(a.due);
    const t = S.updateTask(a.id, patch);
    if (!t) throw new Error('görev bulunamadı: ' + a.id);
    return { id: t.id, title: t.title, status: t.status, due: t.due ? fmtDate(t.due) : null };
  },
});

def({
  name: 'task_delete',
  desc: 'Bir görevi siler.',
  params: { id: 'string (zorunlu)' },
  danger: true,
  run: (a) => {
    const t = S.db().tasks.find((x) => x.id === a.id);
    if (!t) throw new Error('görev bulunamadı: ' + a.id);
    S.removeTask(a.id);
    return { deleted: t.title };
  },
});

/* ---------------- notlar ---------------- */

def({
  name: 'note_add',
  desc: 'Not kaydeder.',
  params: { title: 'string (zorunlu)', body: 'string — not içeriği' },
  run: (a) => {
    if (!a.title && !a.body) throw new Error('title veya body gerekli');
    const n = S.addNote({ title: String(a.title || 'Not'), body: String(a.body || '') });
    return { id: n.id, title: n.title };
  },
});

def({
  name: 'note_search',
  desc: 'Notlarda arama yapar (query boşsa hepsini döner).',
  params: { query: 'string' },
  run: (a) => {
    const q = String(a.query || '').toLocaleLowerCase('tr');
    const list = S.db().notes.filter((n) => !q || (n.title + ' ' + n.body).toLocaleLowerCase('tr').includes(q));
    return { count: list.length, notes: list.slice(0, 25).map((n) => ({ id: n.id, title: n.title, body: truncate(n.body, 600) })) };
  },
});

def({
  name: 'note_delete',
  desc: 'Notu siler.',
  params: { id: 'string (zorunlu)' },
  danger: true,
  run: (a) => {
    const n = S.db().notes.find((x) => x.id === a.id);
    if (!n) throw new Error('not bulunamadı');
    S.removeNote(a.id);
    return { deleted: n.title };
  },
});

/* ---------------- kalıcı hafıza ---------------- */

def({
  name: 'memory_remember',
  desc: 'Kullanıcı hakkında kalıcı bilgi saklar; her sohbette sistem mesajına eklenir. Kalıcı tercih/olgu için kullan.',
  params: { key: 'string (zorunlu)', value: 'string (zorunlu)' },
  run: (a) => {
    if (!a.key) throw new Error('key zorunlu');
    S.remember(String(a.key), String(a.value ?? ''));
    return { saved: { [a.key]: a.value } };
  },
});

def({
  name: 'memory_forget',
  desc: 'Hafızadan bir anahtarı siler.',
  params: { key: 'string (zorunlu)' },
  run: (a) => { S.forget(String(a.key)); return { forgot: a.key }; },
});

def({
  name: 'memory_list',
  desc: 'Hafızadaki tüm kayıtları döner.',
  params: {},
  run: () => ({ memory: S.db().memory }),
});

/* ---------------- zaman & hatırlatma ---------------- */

def({
  name: 'get_datetime',
  desc: 'Şu anki tarih, saat ve zaman dilimini döner.',
  params: {},
  run: () => {
    const d = new Date();
    return {
      iso: d.toISOString(),
      yerel: d.toLocaleString('tr-TR'),
      gun: d.toLocaleDateString('tr-TR', { weekday: 'long' }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  },
});

def({
  name: 'reminder_set',
  desc: 'Belirli bir zamanda bildirim çıkarır. Uygulama açıkken çalışır.',
  params: { when: 'string (zorunlu) — "10 dk", "yarın 09:00", ISO tarih', message: 'string (zorunlu)' },
  run: (a, ctx) => {
    const at = parseWhen(a.when);
    if (!at) throw new Error('zaman anlaşılamadı: ' + a.when);
    if (at < Date.now()) throw new Error('geçmiş bir zaman verdin');
    const r = S.addReminder({ at, message: String(a.message || 'Hatırlatma') });
    ctx?.scheduleReminders?.();
    return { id: r.id, at: fmtDate(at), message: r.message };
  },
});

def({
  name: 'reminder_list',
  desc: 'Bekleyen hatırlatmaları listeler.',
  params: {},
  run: () => ({
    reminders: S.db().reminders.filter((r) => !r.fired)
      .map((r) => ({ id: r.id, at: fmtDate(r.at), message: r.message })),
  }),
});

def({
  name: 'reminder_cancel',
  desc: 'Hatırlatmayı iptal eder.',
  params: { id: 'string (zorunlu)' },
  run: (a) => { S.removeReminder(a.id); return { cancelled: a.id }; },
});

/* ---------------- hesap ---------------- */

def({
  name: 'calculate',
  desc: 'Matematiksel ifade hesaplar. + - * / % ^ ve sqrt, abs, sin, cos, tan, log, log10, exp, round, floor, ceil, min, max, pow, pi, e.',
  params: { expression: 'string (zorunlu) — ör. "(1250*1.2)/3"' },
  run: (a) => ({ expression: a.expression, result: calcExpression(a.expression) }),
});

/* ---------------- web ---------------- */

def({
  name: 'web_search',
  desc: 'İnternette arama yapar. Ayarlar > Web arama sağlayıcısı tanımlıysa çalışır.',
  params: { query: 'string (zorunlu)', count: 'number — sonuç sayısı (varsayılan 5)' },
  run: async (a, ctx) => {
    const st = ctx.settings;
    const key = st.searchKey, prov = st.searchProvider;
    if (!prov || !key) throw new Error('Web arama yapılandırılmamış. Ayarlar > Web arama sağlayıcısı ve anahtarını gir.');
    const n = Math.min(Number(a.count) || 5, 10);
    const q = String(a.query || '');
    if (!q) throw new Error('query zorunlu');

    let res, items = [];
    if (prov === 'tavily') {
      res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({ query: q, max_results: n }),
      });
      if (!res.ok) throw new Error('Tavily HTTP ' + res.status);
      const d = await res.json();
      if (d.answer) items.push({ title: 'Özet', snippet: d.answer, url: '' });
      items.push(...(d.results || []).map((r) => ({ title: r.title, url: r.url, snippet: truncate(r.content, 400) })));
    } else if (prov === 'brave') {
      res = await fetch(`https://api.search.brave.com/res/v1/web/search?count=${n}&q=` + encodeURIComponent(q), {
        headers: { accept: 'application/json', 'x-subscription-token': key },
      });
      if (!res.ok) throw new Error('Brave HTTP ' + res.status);
      const d = await res.json();
      items = (d.web?.results || []).map((r) => ({ title: r.title, url: r.url, snippet: truncate(r.description, 400) }));
    } else if (prov === 'serper') {
      res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ q, num: n }),
      });
      if (!res.ok) throw new Error('Serper HTTP ' + res.status);
      const d = await res.json();
      items = (d.organic || []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet }));
    } else {
      throw new Error('bilinmeyen arama sağlayıcısı: ' + prov);
    }
    return { query: q, results: items.slice(0, n + 1) };
  },
});

def({
  name: 'http_fetch',
  desc: 'Bir URL çeker ve içeriğini döner. Hedef site CORS izni vermezse başarısız olur (Ayarlar > proxy ön eki yardımcı olabilir).',
  params: {
    url: 'string (zorunlu)',
    method: '"GET" | "POST" (varsayılan GET)',
    body: 'string — POST gövdesi',
    headers: 'object — ek başlıklar',
    as: '"text" | "json" (varsayılan text)',
  },
  danger: true,
  run: async (a, ctx) => {
    if (!/^https?:\/\//i.test(a.url || '')) throw new Error('geçerli bir http(s) adresi ver');
    const proxy = ctx.settings.proxy;
    const url = proxy
      ? (proxy.includes('{url}') ? proxy.replace('{url}', encodeURIComponent(a.url))
        : proxy.endsWith('=') ? proxy + encodeURIComponent(a.url) : proxy.replace(/\/+$/, '') + '/' + a.url)
      : a.url;
    const res = await fetch(url, {
      method: a.method || 'GET',
      headers: a.headers || {},
      body: a.method && a.method !== 'GET' ? a.body : undefined,
    });
    const raw = await res.text();
    let out = raw;
    if ((a.as || 'text') === 'json') { try { out = JSON.parse(raw); } catch { /* metin bırak */ } }
    else out = raw.replace(/<script[\s\S]*?<\/script>/gi, '')
                  .replace(/<style[\s\S]*?<\/style>/gi, '')
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/\s{2,}/g, ' ')
                  .trim();
    return { status: res.status, content: truncate(out, 6000) };
  },
});

def({
  name: 'open_url',
  desc: 'Telefonda bir bağlantıyı yeni sekmede açar.',
  params: { url: 'string (zorunlu)' },
  danger: true,
  run: (a) => {
    if (!/^https?:\/\//i.test(a.url || '')) throw new Error('geçerli bir http(s) adresi ver');
    window.open(a.url, '_blank', 'noopener');
    return { opened: a.url };
  },
});

/* ---------------- cihaz ---------------- */

def({
  name: 'device_info',
  desc: 'Cihaz/tarayıcı bilgisi: platform, dil, ekran, ağ, pil.',
  params: {},
  run: async () => {
    const out = {
      platform: navigator.platform,
      dil: navigator.language,
      ekran: `${screen.width}x${screen.height}`,
      cevrimici: navigator.onLine,
      cekirdek: navigator.hardwareConcurrency,
    };
    try {
      if (navigator.getBattery) {
        const b = await navigator.getBattery();
        out.pil = Math.round(b.level * 100) + '%' + (b.charging ? ' (şarjda)' : '');
      }
    } catch { /* yoksay */ }
    if (navigator.connection?.effectiveType) out.baglanti = navigator.connection.effectiveType;
    return out;
  },
});

def({
  name: 'geolocate',
  desc: 'Cihazın konumunu alır (kullanıcı izni gerekir).',
  params: {},
  danger: true,
  run: () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('bu cihazda konum yok'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5), dogruluk_m: Math.round(p.coords.accuracy) }),
      (e) => reject(new Error('konum alınamadı: ' + e.message)),
      { timeout: 12000, enableHighAccuracy: false },
    );
  }),
});

def({
  name: 'clipboard_write',
  desc: 'Metni panoya kopyalar.',
  params: { text: 'string (zorunlu)' },
  run: async (a) => { await navigator.clipboard.writeText(String(a.text ?? '')); return { copied: true, length: String(a.text ?? '').length }; },
});

def({
  name: 'share',
  desc: 'Telefonun paylaş menüsünü açar (WhatsApp, mail vb.).',
  params: { text: 'string', url: 'string', title: 'string' },
  danger: true,
  run: async (a) => {
    if (!navigator.share) throw new Error('bu tarayıcıda paylaşım yok');
    await navigator.share({ title: a.title, text: a.text, url: a.url });
    return { shared: true };
  },
});

def({
  name: 'notify',
  desc: 'Cihazda anlık bildirim gösterir.',
  params: { title: 'string (zorunlu)', body: 'string' },
  run: async (a, ctx) => { await ctx.notify(String(a.title || 'N.E.X.U.S.'), String(a.body || '')); return { shown: true }; },
});

def({
  name: 'speak',
  desc: 'Metni sesli okur.',
  params: { text: 'string (zorunlu)' },
  run: (a, ctx) => { ctx.speak(String(a.text || '')); return { spoken: true }; },
});

def({
  name: 'vibrate',
  desc: 'Telefonu titretir.',
  params: { ms: 'number — süre (varsayılan 200)' },
  run: (a) => {
    if (!navigator.vibrate) throw new Error('titreşim desteklenmiyor');
    navigator.vibrate(Math.min(Number(a.ms) || 200, 3000));
    return { vibrated: true };
  },
});

/* ---------------- etkileşim ---------------- */

def({
  name: 'ask_user',
  desc: 'Kullanıcıya soru sorar ve cevabını bekler. Eksik bilgi varsa uydurma, bunu kullan.',
  params: { question: 'string (zorunlu)', options: 'string[] — hazır seçenekler (opsiyonel)' },
  run: async (a, ctx) => {
    const ans = await ctx.ask(String(a.question || '?'), Array.isArray(a.options) ? a.options : []);
    return { answer: ans };
  },
});

/* ---------------- skiller (uzmanlık paketleri) ---------------- */

def({
  name: 'skill_save',
  desc: 'Yeniden kullanılabilir bir "skill" kaydeder: bir işi nasıl yapacağının kalıbı. '
      + 'Kullanıcı "şunu şöyle yap, bunu hatırla ve bir daha böyle yap" derse ya da tekrarlanan '
      + 'bir prosedür öğrendiysen kaydet. Etkin skiller sonraki her sohbette sistem mesajına eklenir.',
  params: {
    name: 'string (zorunlu) — kısa ad, ör. "Toplantı notu"',
    when: 'string (zorunlu) — ne zaman devreye girer, ör. "kullanıcı toplantı özeti isteyince"',
    instructions: 'string (zorunlu) — adım adım nasıl yapılacağı',
  },
  run: (a) => {
    if (!a.name || !a.instructions) throw new Error('name ve instructions zorunlu');
    const s = S.addSkill({
      name: String(a.name),
      when: String(a.when || ''),
      instructions: String(a.instructions),
    });
    return { id: s.id, name: s.name, saved: true };
  },
});

def({
  name: 'skill_list',
  desc: 'Kayıtlı skilleri listeler.',
  params: {},
  run: () => ({
    skills: S.db().skills.map((s) => ({ id: s.id, name: s.name, when: s.when, enabled: s.enabled })),
  }),
});

def({
  name: 'skill_delete',
  desc: 'Bir skili siler.',
  params: { id: 'string (zorunlu) — skill_list ile öğrenilir' },
  danger: true,
  run: (a) => {
    const s = S.db().skills.find((x) => x.id === a.id);
    if (!s) throw new Error('skill bulunamadı: ' + a.id);
    S.removeSkill(a.id);
    return { deleted: s.name };
  },
});

/* ---------------- Google (Gmail · Takvim · Classroom · Drive) ---------------- */
// Not: Okul (Workspace) hesaplarına erişim, okulun yöneticisinin politikasına tabidir.
// Tümü onay ister (dış hesaba dokunurlar); kimlik doğrulama js/google.js'te.

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary';
const CLASSROOM = 'https://classroom.googleapis.com/v1';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

def({
  name: 'google_status',
  desc: 'Google bağlantısının durumunu döner (giriş yapılmış mı, hangi yetkiler, kalan süre).',
  params: {},
  run: () => G.status(),
});

def({
  name: 'gmail_search',
  desc: 'Gmail\'de e-posta arar (okul veya kişisel hesap). Konu, gönderen, tarih ve özet döner.',
  params: {
    query: 'string — Gmail arama söz dizimi, ör. "is:unread from:hoca", boşsa son gelenler',
    count: 'number — sonuç sayısı (varsayılan 5, en çok 10)',
  },
  danger: true,
  run: async (a) => {
    const n = Math.min(Number(a.count) || 5, 10);
    const q = a.query ? `&q=${encodeURIComponent(a.query)}` : '';
    const list = await G.gfetch(`${GMAIL}/messages?maxResults=${n}${q}`);
    const ids = (list.messages || []).map((m) => m.id);
    const msgs = [];
    for (const id of ids) {
      const m = await G.gfetch(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
      const h = Object.fromEntries((m.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
      msgs.push({ id, from: h.from, subject: h.subject, date: h.date, snippet: truncate(m.snippet || '', 300), unread: (m.labelIds || []).includes('UNREAD') });
    }
    return { count: msgs.length, messages: msgs };
  },
});

def({
  name: 'gmail_read',
  desc: 'Bir e-postanın tam metnini okur (gmail_search ile bulunan id ile).',
  params: { id: 'string (zorunlu)' },
  danger: true,
  run: async (a) => {
    if (!a.id) throw new Error('id zorunlu');
    const m = await G.gfetch(`${GMAIL}/messages/${a.id}?format=full`);
    const h = Object.fromEntries((m.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
    const body = extractGmailBody(m.payload) || m.snippet || '';
    return { from: h.from, to: h.to, subject: h.subject, date: h.date, body: truncate(body, 6000) };
  },
});

def({
  name: 'gmail_send',
  desc: 'E-posta gönderir. Göndermeden önce içeriği kullanıcıya onaylatır.',
  params: { to: 'string (zorunlu) — alıcı', subject: 'string (zorunlu)', body: 'string (zorunlu)' },
  danger: true,
  run: async (a) => {
    if (!a.to || !a.subject) throw new Error('to ve subject zorunlu');
    const subject = `=?UTF-8?B?${G.toBase64Url(String(a.subject)).replace(/-/g, '+').replace(/_/g, '/')}?=`;
    const raw = G.toBase64Url(
      `To: ${a.to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${a.body || ''}`,
    );
    const res = await G.gfetch(`${GMAIL}/messages/send`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw }),
    });
    return { sent: true, id: res.id, to: a.to, subject: a.subject };
  },
});

def({
  name: 'calendar_list',
  desc: 'Google Takvim\'deki yaklaşan etkinlikleri listeler.',
  params: { count: 'number — (varsayılan 10)', query: 'string — metin araması (opsiyonel)' },
  danger: true,
  run: async (a) => {
    const n = Math.min(Number(a.count) || 10, 25);
    const q = a.query ? `&q=${encodeURIComponent(a.query)}` : '';
    const d = await G.gfetch(`${CAL}/events?timeMin=${encodeURIComponent(new Date().toISOString())}&maxResults=${n}&singleEvents=true&orderBy=startTime${q}`);
    return {
      events: (d.items || []).map((e) => ({
        id: e.id, title: e.summary || '(başlıksız)',
        start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date,
        location: e.location, link: e.htmlLink,
      })),
    };
  },
});

def({
  name: 'calendar_add',
  desc: 'Google Takvim\'e etkinlik ekler.',
  params: {
    title: 'string (zorunlu)',
    start: 'string (zorunlu) — "yarın 15:00", "2 saat sonra" veya ISO tarih',
    end: 'string — bitiş; boşsa başlangıçtan 1 saat sonra',
    description: 'string', location: 'string',
  },
  danger: true,
  run: async (a) => {
    if (!a.title) throw new Error('title zorunlu');
    const startMs = parseWhen(a.start);
    if (!startMs) throw new Error('başlangıç zamanı anlaşılamadı: ' + a.start);
    const endMs = a.end ? parseWhen(a.end) : startMs + 3600000;
    const body = {
      summary: String(a.title),
      description: a.description ? String(a.description) : undefined,
      location: a.location ? String(a.location) : undefined,
      start: { dateTime: new Date(startMs).toISOString(), timeZone: TZ },
      end: { dateTime: new Date(endMs || startMs + 3600000).toISOString(), timeZone: TZ },
    };
    const e = await G.gfetch(`${CAL}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { added: true, id: e.id, title: e.summary, start: e.start?.dateTime, link: e.htmlLink };
  },
});

def({
  name: 'classroom_courses',
  desc: 'Google Classroom\'daki etkin derslerini listeler.',
  params: {},
  danger: true,
  run: async () => {
    const d = await G.gfetch(`${CLASSROOM}/courses?courseStates=ACTIVE&pageSize=30`);
    return { courses: (d.courses || []).map((c) => ({ id: c.id, name: c.name, section: c.section, room: c.room, link: c.alternateLink })) };
  },
});

def({
  name: 'classroom_work',
  desc: 'Classroom ödev/görevlerini (son teslim tarihiyle) listeler. courseId verilmezse etkin tüm dersleri tarar.',
  params: { courseId: 'string — classroom_courses ile öğrenilir (opsiyonel)', count: 'number — ders başına (varsayılan 10)' },
  danger: true,
  run: async (a) => {
    const per = Math.min(Number(a.count) || 10, 20);
    let courses;
    if (a.courseId) courses = [{ id: String(a.courseId), name: '' }];
    else {
      const d = await G.gfetch(`${CLASSROOM}/courses?courseStates=ACTIVE&pageSize=5`);
      courses = (d.courses || []).map((c) => ({ id: c.id, name: c.name }));
    }
    const work = [];
    for (const c of courses) {
      const d = await G.gfetch(`${CLASSROOM}/courses/${c.id}/courseWork?pageSize=${per}&orderBy=dueDate%20desc`);
      for (const w of d.courseWork || []) {
        const due = w.dueDate ? `${w.dueDate.year}-${String(w.dueDate.month).padStart(2, '0')}-${String(w.dueDate.day).padStart(2, '0')}` : null;
        work.push({ course: c.name, courseId: c.id, id: w.id, title: w.title, due, link: w.alternateLink, points: w.maxPoints });
      }
    }
    return { count: work.length, work };
  },
});

def({
  name: 'drive_search',
  desc: 'Google Drive\'da dosya arar.',
  params: { query: 'string — ad/metin araması', count: 'number — (varsayılan 10)' },
  danger: true,
  run: async (a) => {
    const n = Math.min(Number(a.count) || 10, 25);
    const q = a.query ? `name contains '${String(a.query).replace(/'/g, "\\'")}' or fullText contains '${String(a.query).replace(/'/g, "\\'")}'` : "trashed=false";
    const url = `${DRIVE}/files?pageSize=${n}&orderBy=modifiedTime desc&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))')}&q=${encodeURIComponent(q + ' and trashed=false')}`;
    const d = await G.gfetch(url);
    return { files: (d.files || []).map((f) => ({ id: f.id, name: f.name, type: f.mimeType, modified: f.modifiedTime, link: f.webViewLink, owner: f.owners?.[0]?.displayName })) };
  },
});

/** Gmail gövdesini (text/plain öncelikli) çıkarır. */
function extractGmailBody(payload) {
  if (!payload) return '';
  const decode = (data) => {
    try {
      const bin = atob(String(data).replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    } catch { return ''; }
  };
  if (payload.body?.data && (!payload.mimeType || payload.mimeType.startsWith('text/'))) return decode(payload.body.data);
  const parts = payload.parts || [];
  const plain = parts.find((p) => p.mimeType === 'text/plain');
  if (plain?.body?.data) return decode(plain.body.data);
  for (const p of parts) { const inner = extractGmailBody(p); if (inner) return inner; }
  return '';
}

/* ---------------- dışa açılan API ---------------- */

export const tools = T;
export const getTool = (name) => T[name];

/** Yerleşik araçların adları (MCP araçlarından ayırmak için). */
export const builtinToolNames = () => Object.keys(T);

/** Bağlı MCP sunucularının araçlarını mcp__sunucu__araç adıyla düzleştirir. */
export function mcpToolList() {
  const out = [];
  for (const srv of S.enabledMcpServers()) {
    const slug = MCP.serverSlug(srv.name);
    for (const tool of srv.tools || []) {
      out.push({
        name: `mcp__${slug}__${tool.name}`,
        server: srv,
        tool,
        desc: tool.description || '',
        schema: tool.inputSchema || tool.input_schema || null,
      });
    }
  }
  return out;
}

/** MCP araçlarının sistem mesajı kataloğu (boşsa boş string). */
export function mcpCatalog() {
  const list = mcpToolList();
  if (!list.length) return '';
  return list.map((t) => {
    let params = '';
    const props = t.schema?.properties;
    if (props && typeof props === 'object') {
      const req = new Set(Array.isArray(t.schema.required) ? t.schema.required : []);
      params = Object.entries(props).map(([k, v]) =>
        `    - ${k}: ${v?.type || 'any'}${req.has(k) ? ' (zorunlu)' : ''}${v?.description ? ' — ' + v.description : ''}`).join('\n');
    }
    return `• ${t.name} [MCP · ${t.server.name}] — ${t.desc}` + (params ? `\n${params}` : '');
  }).join('\n');
}

/** Bir MCP araç adının hangi sunucu+araca karşılık geldiğini bulur. */
function resolveMcpTool(name) {
  const parsed = MCP.parseToolName(name);
  if (!parsed) return null;
  for (const srv of S.enabledMcpServers()) {
    if (MCP.serverSlug(srv.name) !== parsed.server) continue;
    const tool = (srv.tools || []).find((t) => t.name === parsed.tool);
    if (tool) return { srv, tool: parsed.tool };
  }
  return null;
}

/** Sistem mesajına gömülecek araç kataloğu (yerleşik + MCP). */
export function toolCatalog() {
  const builtin = Object.values(T).map((t) => {
    const p = Object.entries(t.params || {}).map(([k, v]) => `    - ${k}: ${v}`).join('\n');
    return `• ${t.name}${t.danger ? ' [onay gerektirir]' : ''} — ${t.desc}` + (p ? `\n${p}` : '');
  }).join('\n');
  const mcp = mcpCatalog();
  return mcp ? `${builtin}\n\nDIŞ ARAÇLAR (MCP sunucularından — onay gerektirir):\n${mcp}` : builtin;
}

/** Bir araç riskli mi? MCP araçları daima onay ister (dış sisteme dokunurlar). */
export function isDangerTool(name) {
  if (MCP.parseToolName(name)) return true;
  return !!T[name]?.danger;
}

/** Bir aracı çalıştırır; sonucu daima {ok, result|error} olarak sarar. */
export async function runTool(name, args, ctx) {
  // MCP aracı mı?
  if (MCP.parseToolName(name)) {
    const hit = resolveMcpTool(name);
    if (!hit) {
      const avail = mcpToolList().map((t) => t.name).join(', ') || '(bağlı MCP aracı yok)';
      return { ok: false, error: `Bilinmeyen MCP aracı: ${name}. Kullanılabilir: ${avail}` };
    }
    try {
      const res = await MCP.callTool(hit.srv, hit.tool, args || {}, ctx?.settings?.proxy || '');
      if (res.isError) return { ok: false, error: typeof res.content === 'object' ? (res.content.text || JSON.stringify(res.content)) : String(res.content) };
      return { ok: true, result: res.content };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  const t = T[name];
  if (!t) return { ok: false, error: `Bilinmeyen araç: ${name}. Kullanılabilir: ${Object.keys(T).join(', ')}` };
  try {
    const result = await t.run(args || {}, ctx);
    return { ok: true, result: result === undefined ? { done: true } : result };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
