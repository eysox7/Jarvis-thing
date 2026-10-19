import { h } from '../util.js';
import { t, getLang, setLang, languages } from '../i18n.js';
import { api } from '../api.js';
import { openSheet, closeSheet } from '../ui.js';

const LANG_NAMES = { tr: 'Türkçe', en: 'English' };

function howItWorks() {
  return h('div', { class: 'stack' },
    h('h3', { class: 'section-title' }, t('profile.how')),
    h('ol', { class: 'how' }, h('li', {}, t('profile.how1')), h('li', {}, t('profile.how2')), h('li', {}, t('profile.how3'))));
}

export async function openProfile(app) {
  const { state } = app;
  const langSelect = h('select', {
    onchange: (e) => {
      setLang(e.target.value);
      app.relabel();
      openProfile(app);
    },
  }, languages.map((l) => h('option', { value: l, selected: l === getLang() }, LANG_NAMES[l] || l)));

  const cities = h('div', { class: 'city-grid' }, state.config.cities.map((c) => h('button', {
    class: `city-card${c.id === state.city.id ? ' is-active' : ''}`,
    type: 'button',
    onclick: () => {
      closeSheet();
      app.selectCity(c.id);
    },
  }, h('span', { class: 'city-name' }, c.name), h('span', { class: 'muted small' }, c.region ? `${c.region}, ${c.country}` : c.country))));

  let account;
  if (state.user) {
    let stats = state.stats;
    try {
      stats = (await api.me()).stats;
    } catch {
      // Eldeki istatistiklerle devam et.
    }
    const stat = (n, label) => h('div', { class: 'stat' }, h('span', { class: 'stat-n' }, String(n ?? 0)), h('span', { class: 'stat-label' }, label));
    account = h('div', { class: 'stack' },
      h('div', { class: 'profile-head' },
        h('span', { class: 'avatar avatar-lg', 'aria-hidden': 'true' }, state.user.handle.slice(0, 1).toUpperCase()),
        h('div', {}, h('p', { class: 'profile-handle' }, `@${state.user.handle}`), state.user.isGuest ? h('p', { class: 'muted small' }, t('profile.guestNote')) : null)),
      h('div', { class: 'stats' },
        stat(stats?.places, t('profile.places')),
        stat(stats?.cities, t('profile.cities')),
        stat(stats?.overheards, t('profile.overheards')),
        stat(stats?.reactionsReceived, t('profile.reactions'))));
  } else {
    account = h('div', { class: 'stack' },
      h('p', { class: 'muted' }, t('auth.why')),
      h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => app.openAuth() }, t('auth.login')));
  }

  openSheet({
    key: 'profile',
    title: t('profile.title'),
    body: h('div', { class: 'stack' },
      account,
      howItWorks(),
      h('h3', { class: 'section-title' }, t('profile.pilot')),
      cities,
      h('label', { class: 'field field-inline' }, h('span', { class: 'field-label' }, t('profile.language')), langSelect),
      state.user ? h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: () => app.logout() }, t('profile.logout')) : null),
  });
}
