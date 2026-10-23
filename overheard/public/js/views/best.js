import { h, clear, timeAgo, REACTION_EMOJI } from '../util.js';
import { t, errorText } from '../i18n.js';
import { api } from '../api.js';
import { openSheet, closeSheet } from '../ui.js';

// Haftanın en iyileri: şehirde son 7 günde en çok tepki alan herkese açık sözler.
export async function openBest(app) {
  const { city } = app.state;
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('common.loading')));
  openSheet({ key: 'best', title: `🏆 ${t('best.title', { city: city.name })}`, body });

  let overheards;
  try {
    ({ overheards } = await api.best(city.id));
  } catch (err) {
    clear(body).append(h('p', { class: 'form-error' }, errorText(err)));
    return;
  }
  clear(body).append(h('p', { class: 'muted small' }, t('best.hint')));
  if (!overheards.length) {
    body.append(h('p', { class: 'empty' }, `🎈 ${t('best.empty')}`));
    return;
  }
  body.append(h('ol', { class: 'best-list' }, overheards.map((o, i) => h('li', { class: 'best-item' },
    h('button', {
      class: 'best-main',
      type: 'button',
      onclick: () => {
        closeSheet();
        app.openOverheard(o);
      },
    },
    h('span', { class: 'best-rank', 'aria-hidden': 'true' }, i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1)),
    h('span', { class: 'best-text' },
      h('span', { class: 'best-quote' }, `“${o.text}”`),
      h('span', { class: 'muted small' }, `📍 ${o.placeName} · ${timeAgo(o.createdAt)}`),
      h('span', { class: 'best-reactions' }, Object.entries(o.reactions).filter(([, n]) => n).map(([kind, n]) => `${REACTION_EMOJI[kind]} ${n}`).join('  ')))),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('share.button'), title: t('share.button'), onclick: () => app.share(o) }, '📤')))));
}
