import { h, clear, timeAgo, displayName } from '../util.js';
import { t, errorText } from '../i18n.js';
import { api } from '../api.js';
import { openSheet, toast, busy } from '../ui.js';

// Moderasyon paneli: şikâyet edilen ve otomatik gizlenen sözler.
export async function openAdmin(app) {
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('common.loading')));
  openSheet({ key: 'admin', title: `🛡️ ${t('admin.title')}`, body });

  let items;
  try {
    ({ overheards: items } = await api.adminReports());
  } catch (err) {
    clear(body).append(h('p', { class: 'form-error' }, errorText(err)));
    return;
  }
  clear(body);
  if (!items.length) {
    body.append(h('p', { class: 'empty' }, `✅ ${t('admin.empty')}`));
    return;
  }

  const act = (fn, done) => (e) => busy(e.currentTarget, async () => {
    try {
      await fn();
      toast(done);
      await app.refresh();
      await openAdmin(app);
    } catch (err) {
      toast(errorText(err), { tone: 'error' });
    }
  });

  body.append(h('ul', { class: 'list' }, items.map((o) => h('li', { class: 'admin-item' },
    h('blockquote', { class: 'chat-quote' }, o.text),
    h('p', { class: 'muted small' }, [
      displayName(o.author) + (o.anonymous ? ` (${t('anon.name')})` : ''),
      o.placeName,
      timeAgo(o.createdAt),
      t('admin.reports', { n: o.reports }),
      o.reasons.length ? o.reasons.join(', ') : null,
    ].filter(Boolean).join(' · ')),
    h('div', { class: 'bubble-badges' },
      o.hidden ? h('span', { class: 'chip chip-hot' }, t('admin.hidden')) : null,
      o.authorBanned ? h('span', { class: 'chip' }, t('admin.banned')) : null),
    h('div', { class: 'bubble-actions' },
      h('button', { class: 'btn', type: 'button', onclick: act(() => api.adminRestore(o.id), t('admin.restored')) }, t('admin.restore')),
      h('button', { class: 'btn btn-ghost btn-danger', type: 'button', onclick: act(() => api.adminDelete(o.id), t('toast.deleted')) }, t('bubble.delete')),
      h('button', {
        class: 'btn btn-ghost',
        type: 'button',
        onclick: act(() => api.adminBan(o.author, !o.authorBanned), o.authorBanned ? t('admin.unbanned') : t('admin.bannedToast')),
      }, o.authorBanned ? t('admin.unban') : t('admin.ban')))))));
}
