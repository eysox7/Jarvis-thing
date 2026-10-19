import { h } from '../util.js';
import { t, errorText } from '../i18n.js';
import { api } from '../api.js';
import { openSheet, closeSheet, field, formError, busy } from '../ui.js';

export function openAuth(app, then) {
  let mode = 'login';
  const error = formError();
  const handle = h('input', { name: 'handle', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, minlength: 3, maxlength: 20 });
  const password = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true, minlength: 8 });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('auth.login'));
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
          const call = mode === 'login' ? api.login : api.register;
          await done(await call(handle.value.trim(), password.value));
        } catch (err) {
          error.show(errorText(err));
        }
      });
    },
  },
  h('div', { class: 'tabs', role: 'tablist' }, tabs),
  field(t('auth.handle'), handle),
  field(t('auth.password'), password),
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
      }, `👀 ${t('auth.guest')}`))
    : null;

  openSheet({
    key: 'auth',
    title: t('auth.login'),
    body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('auth.why')), form, guest),
  });
  setTimeout(() => handle.focus(), 50);
}
