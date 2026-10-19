import { h } from '../util.js';
import { t, errorText } from '../i18n.js';
import { api } from '../api.js';
import { openSheet, closeSheet, busy, toast } from '../ui.js';

const KEY = 'oh_intro_seen';

const seen = () => {
  try { return Boolean(localStorage.getItem(KEY)); } catch { return true; }
};
const markSeen = () => {
  try { localStorage.setItem(KEY, '1'); } catch { /* yok say */ }
};

// İlk açılışta üç adımlık tanıtım: ne olduğunu ve neden yürümek gerektiğini anlatır.
export function maybeShowIntro(app) {
  if (seen() || app.state.user) return;
  const step = (icon, title, text) => h('li', { class: 'intro-step' },
    h('span', { class: 'intro-icon', 'aria-hidden': 'true' }, icon),
    h('span', {}, h('strong', {}, title), h('span', { class: 'muted small intro-text' }, text)));

  const actions = [
    app.state.config.demoMode
      ? h('button', {
        class: 'btn btn-primary btn-block',
        type: 'button',
        onclick: (e) => busy(e.currentTarget, async () => {
          try {
            const { user } = await api.guest();
            await app.setUser(user);
            closeSheet();
          } catch (err) {
            toast(errorText(err), { tone: 'error' });
          }
        }),
      }, `👀 ${t('auth.guest')}`)
      : null,
    h('button', { class: 'btn btn-block', type: 'button', onclick: () => app.openAuth() }, t('auth.login')),
    h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: () => closeSheet() }, t('intro.look')),
  ];

  openSheet({
    key: 'intro',
    title: t('intro.title'),
    onClose: markSeen,
    body: h('div', { class: 'stack' },
      h('p', { class: 'intro-lead' }, t('app.tagline')),
      h('ol', { class: 'intro-steps' },
        step('“', t('intro.step1'), t('profile.how1')),
        step('🔒', t('intro.step2'), t('profile.how2')),
        step('🤝', t('intro.step3'), t('profile.how3'))),
      h('div', { class: 'stack intro-actions' }, actions)),
  });
  markSeen();
}
