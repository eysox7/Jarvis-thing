import { h, BADGE_EMOJI } from '../util.js';
import { t, getLang, setLang, languages, errorText } from '../i18n.js';
import { api } from '../api.js';
import { openSheet, closeSheet, field, formError, busy, toast } from '../ui.js';
import { openAdmin } from './admin.js';
import { openVenue } from './venue.js';
import { googleButton } from '../google.js';

const LANG_NAMES = { tr: 'Türkçe', en: 'English' };

function howItWorks() {
  return h('div', { class: 'stack' },
    h('h3', { class: 'section-title' }, t('profile.how')),
    h('ol', { class: 'how' }, h('li', {}, t('profile.how1')), h('li', {}, t('profile.how2')), h('li', {}, t('profile.how3'))));
}

// Seri, şehir keşif çubukları ve rozetler: dışarı çıkmak için küçük sebepler.
function progressSection(progress, state) {
  const { metrics } = progress;
  const cityName = new Map(state.config.cities.map((c) => [c.id, c.name]));
  const cities = progress.cities
    .filter((c) => cityName.has(c.cityId))
    .sort((a, b) => b.visited / b.total - a.visited / a.total)
    .map((c) => {
      const pct = Math.round((100 * c.visited) / c.total);
      return h('div', { class: 'progress-row' },
        h('div', { class: 'row-between small' }, h('span', {}, cityName.get(c.cityId)), h('span', { class: 'muted' }, `${c.visited}/${c.total}`)),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': cityName.get(c.cityId) },
          h('span', { style: { width: `${pct}%` } })));
    });
  const badges = progress.badges.map((b) => h('div', { class: `badge-card${b.earned ? ' is-earned' : ''}`, title: t(`badge.${b.id}.how`) },
    h('span', { class: 'badge-icon', 'aria-hidden': 'true' }, BADGE_EMOJI[b.id] || '🏅'),
    h('span', { class: 'badge-name' }, t(`badge.${b.id}`)),
    h('span', { class: 'badge-how' }, b.earned ? t(`badge.${b.id}.how`) : `${b.n}/${b.of} · ${t(`badge.${b.id}.how`)}`)));

  return h('div', { class: 'stack' },
    h('div', { class: 'streak' },
      h('span', { class: 'streak-main' }, metrics.streak ? t('profile.streak', { n: metrics.streak }) : t('profile.noStreak')),
      metrics.weekPlaces ? h('span', { class: 'muted small' }, t('profile.weekPlaces', { n: metrics.weekPlaces })) : null),
    h('h3', { class: 'section-title' }, t('profile.cityProgress')),
    h('div', { class: 'stack progress-list' }, cities),
    h('h3', { class: 'section-title' }, `${t('profile.badges')} · ${progress.badges.filter((b) => b.earned).length}/${progress.badges.length}`),
    h('div', { class: 'badge-grid' }, badges));
}

// Misafir hesabını kullanıcı adı + parola ile kalıcı hesaba çevirir.
function upgradeForm(app) {
  const error = formError();
  const handle = h('input', { name: 'handle', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, minlength: 3, maxlength: 20 });
  const password = h('input', { name: 'password', type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('profile.upgrade'));
  return h('form', {
    class: 'stack upgrade',
    onsubmit: (e) => {
      e.preventDefault();
      error.hide();
      busy(submit, async () => {
        try {
          const { user } = await api.upgrade(handle.value.trim(), password.value);
          await app.setUser(user);
          toast(t('profile.upgradeDone'), { tone: 'success' });
          openProfile(app);
        } catch (err) {
          error.show(errorText(err));
        }
      });
    },
  },
  h('h3', { class: 'section-title' }, `💾 ${t('profile.upgrade')}`),
  h('p', { class: 'muted small' }, t('profile.upgradeHint')),
  field(t('auth.handle'), handle),
  field(t('auth.password'), password),
  error.el,
  submit);
}

// Google hesabını bağlama (misafir hesabı da böylece kalıcı olur); bağlıysa durum satırı.
function googleSection(app, auth) {
  const clientId = app.state.config.googleClientId;
  if (!clientId || !auth) return null;
  if (auth.google) return h('p', { class: 'muted small' }, `✅ ${t('profile.googleLinked')}`);
  return h('div', { class: 'stack' },
    h('h3', { class: 'section-title' }, t('profile.googleLink')),
    googleButton(clientId, async (credential) => {
      try {
        const { user } = await api.google(credential);
        toast(t('profile.googleLinkedDone'), { tone: 'success' });
        await app.setUser(user);
        openProfile(app);
      } catch (err) {
        toast(errorText(err), { tone: 'error' });
      }
    }));
}

// Parolası olmayan (Google ile açılmış) hesabın silinmesi: Google hesabını seçerek onaylanır.
function confirmDeleteWithGoogle(app) {
  openSheet({
    key: 'delete-google',
    title: t('profile.delete'),
    body: h('div', { class: 'stack' },
      h('p', {}, t('profile.deleteConfirm')),
      h('p', { class: 'muted small' }, t('profile.deleteGoogle')),
      googleButton(app.state.config.googleClientId, async (credential) => {
        try {
          await api.deleteAccount({ googleIdToken: credential });
          toast(t('profile.deleted'));
          await app.logout();
        } catch (err) {
          toast(errorText(err), { tone: 'error' });
        }
      })),
  });
}

// KVKK/GDPR hakları: verilerin bir kopyası ve hesabın kalıcı silinmesi.
function privacySection(app, auth) {
  const { user } = app.state;
  // Silme onayı: parola, Google ile yeniden giriş ya da (Google sunucuda kapalıysa) kullanıcı adı.
  const confirmWith = user.isGuest ? 'none' : (auth?.confirm ?? 'password');
  const remove = h('button', {
    class: 'btn btn-ghost btn-danger btn-block',
    type: 'button',
    onclick: (e) => busy(e.currentTarget, async () => {
      if (confirmWith === 'google') {
        confirmDeleteWithGoogle(app);
        return;
      }
      if (!window.confirm(t('profile.deleteConfirm'))) return;
      let proof = {};
      if (confirmWith === 'password' || confirmWith === 'handle') {
        const value = window.prompt(t(confirmWith === 'password' ? 'profile.deletePassword' : 'profile.deleteHandle'));
        if (value === null) return;
        proof = { [confirmWith]: value };
      }
      try {
        await api.deleteAccount(proof);
        toast(t('profile.deleted'));
        await app.logout();
      } catch (err) {
        toast(errorText(err), { tone: 'error' });
      }
    }),
  }, t('profile.delete'));
  return h('div', { class: 'stack' },
    h('h3', { class: 'section-title' }, t('profile.privacy')),
    h('a', { class: 'btn btn-block', href: '/api/me/export', download: 'overheard-verilerim.json' }, `⬇️ ${t('profile.export')}`),
    remove);
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
  let auth = null;
  if (state.user) {
    let stats = state.stats;
    let progress = null;
    let venues = [];
    try {
      ({ stats, progress, venues = [], auth } = await api.me());
    } catch {
      // Eldeki istatistiklerle devam et.
    }
    const stat = (n, label) => h('div', { class: 'stat' }, h('span', { class: 'stat-n' }, String(n ?? 0)), h('span', { class: 'stat-label' }, label));
    account = h('div', { class: 'stack' },
      h('div', { class: 'profile-head' },
        h('span', { class: 'avatar avatar-lg', 'aria-hidden': 'true' }, state.user.handle.slice(0, 1).toUpperCase()),
        h('div', {},
          h('p', { class: 'profile-handle' }, `@${state.user.handle}`),
          state.user.isGuest ? h('p', { class: 'muted small' }, t('profile.guestNote')) : null,
          state.user.banned ? h('p', { class: 'form-error' }, t('profile.bannedNote')) : null)),
      state.user.isAdmin ? h('button', { class: 'btn btn-block', type: 'button', onclick: () => openAdmin(app) }, `🛡️ ${t('admin.open')}`) : null,
      ...venues.map((v) => h('button', { class: 'btn btn-block', type: 'button', onclick: () => openVenue(app, v) }, `☕ ${t('venue.panel', { name: v.name })}`)),
      state.user.isGuest ? upgradeForm(app) : null,
      googleSection(app, auth),
      h('div', { class: 'stats' },
        stat(stats?.places, t('profile.places')),
        stat(stats?.cities, t('profile.cities')),
        stat(stats?.overheards, t('profile.overheards')),
        stat(stats?.reactionsReceived, t('profile.reactions'))),
      progress ? progressSection(progress, state) : null);
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
      h('button', { class: 'btn btn-block', type: 'button', onclick: () => app.p2p.list() }, `📡 ${t('p2p.list')}`),
      h('h3', { class: 'section-title' }, t('profile.pilot')),
      cities,
      h('label', { class: 'field field-inline' }, h('span', { class: 'field-label' }, t('profile.language')), langSelect),
      state.user ? h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: () => app.logout() }, t('profile.logout')) : null,
      state.user ? privacySection(app, auth) : null,
      h('p', { class: 'legal' },
        h('a', { href: '/privacy.html', target: '_blank', rel: 'noopener' }, t('legal.privacy')),
        ' · ',
        h('a', { href: '/terms.html', target: '_blank', rel: 'noopener' }, t('legal.terms')))),
  });
}
