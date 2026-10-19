import { h, clear } from './util.js';
import { t } from './i18n.js';

// --- Alt sayfa (bottom sheet) -------------------------------------------
// Tek bir <dialog> yeniden kullanılır; yeni bir sayfa açmak öncekinin yerine geçer.
// Modal değil: sekme çubuğu açık sayfanın altında kullanılabilir kalsın diye show() ile açılır;
// arka plan perdesi, Esc tuşu ve odak yönetimi burada elle yapılır.
const dialog = document.getElementById('sheet');
const backdrop = document.getElementById('sheet-backdrop');
let onCloseHandler = null;
let currentKey = null;
let returnFocus = null;

dialog.addEventListener('close', () => {
  backdrop.hidden = true;
  const handler = onCloseHandler;
  onCloseHandler = null;
  currentKey = null;
  handler?.();
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  returnFocus = null;
});
backdrop.addEventListener('click', () => dialog.close());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && dialog.open) dialog.close();
});

export function openSheet({ key, title, body, onClose, back }) {
  const previous = onCloseHandler;
  onCloseHandler = null;
  previous?.();
  clear(dialog);
  dialog.append(
    h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    h('header', { class: 'sheet-head' },
      back ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': '←', onclick: back }, '←') : null,
      h('h2', { class: 'sheet-title' }, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('common.close'), onclick: () => dialog.close() }, '✕')),
    h('div', { class: 'sheet-body' }, body));
  onCloseHandler = onClose || null;
  currentKey = key || null;
  if (!dialog.open) {
    returnFocus = document.activeElement;
    backdrop.hidden = false;
    dialog.show();
  }
  dialog.querySelector('.sheet-title')?.setAttribute('id', 'sheet-title');
  dialog.setAttribute('aria-labelledby', 'sheet-title');
  return dialog;
}

export function closeSheet() {
  if (dialog.open) dialog.close();
}

export const sheetKey = () => (dialog.open ? currentKey : null);

// --- Bildirimler ----------------------------------------------------------
const toasts = document.getElementById('toasts');

export function toast(message, { action, onAction, timeout = 4200, tone = 'info' } = {}) {
  const item = h('div', { class: `toast toast-${tone}`, role: 'status' },
    h('span', { class: 'toast-text' }, message),
    action ? h('button', { class: 'toast-action', type: 'button', onclick: () => { onAction?.(); item.remove(); } }, action) : null);
  toasts.append(item);
  while (toasts.children.length > 3) toasts.firstChild.remove();
  setTimeout(() => {
    item.classList.add('is-leaving');
    setTimeout(() => item.remove(), 300);
  }, timeout);
}

export function field(label, input) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input);
}

export function formError() {
  const el = h('p', { class: 'form-error', role: 'alert', hidden: true });
  return {
    el,
    show(message) { el.textContent = message; el.hidden = false; },
    hide() { el.hidden = true; },
  };
}

// Gönderim sırasında düğmeyi kilitler, hatayı kullanıcıya gösterir.
export async function busy(button, fn) {
  if (button.disabled) return;
  button.disabled = true;
  button.classList.add('is-busy');
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
  }
}
