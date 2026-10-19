import { h } from '../util.js';
import { t, errorText } from '../i18n.js';
import { api } from '../api.js';
import { openSheet, closeSheet, field, formError, busy } from '../ui.js';

// "{terms}" ve "{privacy}" yer tutucularını bağlantılara çevirir.
export function legalText(key) {
  const parts = t(key).split(/(\{terms\}|\{privacy\})/);
  return h('span', {}, parts.map((part) => {
    if (part === '{terms}') return h('a', { href: '/terms.html', target: '_blank', rel: 'noopener' }, t('legal.terms'));
    if (part === '{privacy}') return h('a', { href: '/privacy.html', target: '_blank', rel: 'noopener' }, t('legal.privacy'));
    return part;
  }));
}

export function openAuth(app, then) {
  let mode = 'login';
  const error = formError();
  const handle = h('input', { name: 'handle', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, minlength: 3, maxlength: 20 });
  const password = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true, minlength: 8 });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('auth.login'));
  const consent = h('input', { type: 'checkbox', name: 'acceptTerms' });
  const consentRow = h('label', { class: 'check', hidden: true }, consent, legalText('auth.consent'));
  const tabs = ['login', 'register'].map((m) => h('button', {
    class: `tab${m === mode ? ' is-active' : ''}`,
    type: 'button',
    role: 'tab',
    onclick: () => setMode(m),
  }, t(`auth.${m}`)));

  function setMode(next) {
    mode = next;
    tabs.forEach((tab, i) => tab.classList.toggle('is-active', ['login', 'register'][i] === mode));
    submit.textContent = t(`auth.${mode}`);
    password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    consentRow.hidden = mode !== 'register';
    error.hide();
  }

  const done = async (result) => {
    await app.setUser(result.user);
    closeSheet();
    then?.();
  };

  const form = h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      error.hide();
      busy(submit, async () => {
        try {
          if (mode === 'register' && !consent.checked) {
            error.show(t('errors.terms_required'));
            return;
          }
          const result = mode === 'login'
            ? await api.login(handle.value.trim(), password.value)
            : await api.register(handle.value.trim(), password.value, true);
          await done(result);
        } catch (err) {
          error.show(errorText(err));
        }
      });
    },
  },
  h('div', { class: 'tabs', role: 'tablist' }, tabs),
  field(t('auth.handle'), handle),
  field(t('auth.password'), password),
  consentRow,
  error.el,
  submit);

  const guest = app.state.config.demoMode
    ? h('div', { class: 'stack' },
      h('p', { class: 'divider' }, t('auth.or')),
      h('button', {
        class: 'btn btn-block',
        type: 'button',
        onclick: (e) => busy(e.currentTarget, async () => {
          try {
            await done(await api.guest());
          } catch (err) {
            error.show(errorText(err));
          }
        }),
      }, `👀 ${t('auth.guest')}`),
      h('p', { class: 'legal' }, legalText('auth.guestConsent')))
    : null;

  openSheet({
    key: 'auth',
    title: t('auth.login'),
    body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('auth.why')), form, guest),
  });
  setTimeout(() => handle.focus(), 50);
}
