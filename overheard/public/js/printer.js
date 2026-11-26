import { api } from './api.js';
import { t, errorText } from './i18n.js';
import { h, clear, formatDistance } from './util.js';

// Dedikoydu Kafe yazıcı ekranı: kafedeki bir cihazda personel hesabıyla açık durur. Garson masa
// açtıkça ya da masa açık kaldıkça sunucu fiş kuyruğa ekler; bu ekran canlı haber alıp fişleri
// fiş yazıcısına basar ve "basıldı" diye işaretler. Chrome --kiosk-printing ile açılırsa yazdırma
// penceresi çıkmadan basar.

const placeId = new URLSearchParams(location.search).get('place');
const AUTO_KEY = 'oh_printer_auto';
const RECENT_MAX = 12;

const els = {
  title: document.getElementById('printer-title'),
  status: document.getElementById('printer-status'),
  auto: document.getElementById('auto-print'),
  autoLabel: document.getElementById('auto-label'),
  printNow: document.getElementById('print-now'),
  recentTitle: document.getElementById('recent-title'),
  recent: document.getElementById('recent'),
  area: document.getElementById('print-area'),
};

let qr = null;
let pending = [];
let running = false;
let again = false;
const recent = [];

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* yok say */ }
  },
};

// Sözün saati fişte yalnızca kabaca yazılır: kafe içinden yazanı ele vermesin.
function when(ms) {
  const d = new Date(ms);
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  const part = d.getHours() < 12 ? 'morning' : d.getHours() < 18 ? 'afternoon' : 'evening';
  if (days <= 0) return t(`slip.today.${part}`);
  if (days === 1) return t(`slip.yesterday.${part}`);
  return days < 7 ? t('slip.thisWeek') : t('slip.earlier');
}

function slip(job) {
  const meta = job.inside
    ? t('slip.heardHere', { when: when(job.heardAt) })
    : t('slip.heardNear', { place: job.placeName, distance: formatDistance(job.distanceM), when: when(job.heardAt) });
  return h('article', { class: 'slip' },
    h('p', { class: 'slip-table' }, t('slip.table', { n: job.tableNo })),
    h('p', { class: 'slip-brand' }, h('span', { class: 'slip-mark', 'aria-hidden': 'true' }, '“'), 'dedikoydu'),
    h('blockquote', { class: 'slip-quote' }, `“${job.text}”`),
    h('p', { class: 'slip-meta' }, meta),
    qr ? h('img', { class: 'slip-qr', src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`, alt: '', width: 113, height: 113 }) : null,
    h('p', { class: 'slip-cta' }, t('slip.cta')));
}

async function print(jobs) {
  clear(els.area).append(...jobs.map(slip));
  // QR görseli hazır olmadan yazdırılmasın.
  await Promise.all([...els.area.querySelectorAll('img')].map((img) => img.decode().catch(() => {})));
  window.print();
  clear(els.area);
}

async function printPending() {
  const jobs = pending;
  if (!jobs.length) return;
  await print(jobs);
  for (const job of jobs) await api.venuePrinted(placeId, job.id).catch(() => {});
  // En yeni fiş en başta.
  recent.unshift(...jobs.map((job) => ({ job, at: Date.now() })).reverse());
  recent.length = Math.min(recent.length, RECENT_MAX);
  pending = [];
  renderRecent();
}

function setStatus(text, { error = false, link = null } = {}) {
  els.status.classList.toggle('is-error', error);
  clear(els.status).append(text, link ? ' ' : '', link || '');
}

function renderStatus() {
  const waiting = pending.length;
  setStatus(waiting ? t('printer.waiting', { n: waiting }) : t('printer.idle'));
  els.printNow.hidden = !waiting || els.auto.checked;
  els.printNow.textContent = t('printer.printNow', { n: waiting });
}

function renderRecent() {
  els.recentTitle.textContent = t('printer.recent');
  clear(els.recent).append(...(recent.length
    ? recent.map(({ job, at }) => h('div', { class: 'slip-card' },
      slip(job),
      h('span', { class: 'slip-time' }, new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => print([job]) }, t('printer.reprint'))))
    : [h('p', { class: 'muted' }, t('printer.none'))]));
}

async function check() {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    const data = await api.venueJobs(placeId);
    qr = data.qr;
    els.title.textContent = data.venue.name;
    document.title = `${t('printer.title')} · ${data.venue.name}`;
    pending = data.jobs;
    if (pending.length && els.auto.checked) await printPending();
    renderStatus();
  } catch (err) {
    const login = err.status === 401 ? h('a', { href: '/' }, t('printer.loginLink')) : null;
    setStatus(err.status === 401 ? t('printer.login') : errorText(err), { error: true, link: login });
  } finally {
    running = false;
    if (again) {
      again = false;
      check();
    }
  }
}

function start() {
  els.autoLabel.textContent = t('printer.auto');
  els.auto.checked = storage.get(AUTO_KEY) !== '0';
  els.auto.addEventListener('change', () => {
    storage.set(AUTO_KEY, els.auto.checked ? '1' : '0');
    if (els.auto.checked) check();
    else renderStatus();
  });
  els.printNow.addEventListener('click', async () => {
    await printPending();
    renderStatus();
  });
  renderRecent();
  if (!placeId) {
    setStatus(t('printer.noPlace'), { error: true });
    return;
  }
  setStatus(t('common.loading'));
  // Yeni fiş olunca canlı haber; bağlantı koparsa yarım dakikada bir yoklama da var.
  const events = new EventSource('/api/events');
  events.addEventListener('print', (e) => {
    if (JSON.parse(e.data).placeId === placeId) check();
  });
  setInterval(check, 30000);
  check();
}

start();

// Testler için.
window.overheardPrinter = { check, get pending() { return pending; } };
