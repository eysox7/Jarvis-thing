import { h, clear, timeAgo, truncate } from '../util.js';
import { t } from '../i18n.js';
import { openSheet, closeSheet } from '../ui.js';
import { store } from '../store.js';

// Gönderilmeyi bekleyen çevrimdışı sözler (ve kulaktan kulağa taşınanlar).
export async function openOutbox(app) {
  const body = h('div', { class: 'stack' });
  openSheet({ key: 'outbox', title: `📤 ${t('outbox.title')}`, body });

  async function render() {
    const items = await app.offline.pending();
    clear(body).append(
      h('p', { class: 'muted small' }, navigator.onLine ? t('outbox.online') : t('offline.note')),
      items.length
        ? h('ul', { class: 'list' }, items.map((item) => h('li', { class: 'admin-item' },
          h('blockquote', { class: 'chat-quote' }, item.kind === 'relay' ? truncate(item.preview || '', 140) : item.text),
          h('p', { class: 'muted small' }, [
            item.kind === 'relay' ? `📡 ${t('outbox.relay')}` : null,
            item.placeName,
            timeAgo(item.heardAt),
          ].filter(Boolean).join(' · ')),
          h('div', { class: 'bubble-actions' },
            app.p2p && item.kind !== 'relay'
              ? h('button', { class: 'btn', type: 'button', onclick: () => app.p2p.show(item) }, `📡 ${t('p2p.show')}`)
              : null,
            h('button', {
              class: 'btn btn-ghost btn-danger',
              type: 'button',
              onclick: async () => {
                if (!window.confirm(t('outbox.confirmRemove'))) return;
                await store.del('outbox', item.id);
                await app.offline.render();
                render();
              },
            }, t('outbox.remove'))))))
        : h('p', { class: 'empty' }, t('outbox.empty')),
      navigator.onLine && items.length
        ? h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => { await app.offline.flush(); if (!(await app.offline.pending()).length) closeSheet(); else render(); } }, t('outbox.sendNow'))
        : null);
  }
  await render();
}
