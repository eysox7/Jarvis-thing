// Arayüz ilkelleri: toast, modal, onay, soru, sohbet balonları ve kartlar.
import { $, el, mdToHtml, uid, truncate } from './util.js';

const modalHost = $('#modalHost');
const toastHost = $('#toastHost');
const chatLog = $('#chatLog');

/* ---------------- toast ---------------- */
export function toast(msg, kind = '') {
  const t = el('div', { class: 'toast ' + kind, text: msg });
  toastHost.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 5200 : 2600);
}

/* ---------------- modal ---------------- */
export function openModal({ title, render, onClose }) {
  modalHost.hidden = false;
  modalHost.innerHTML = '';
  const box = el('div', { class: 'modal' });
  if (title) box.append(el('h2', { text: title }));
  const close = () => { modalHost.hidden = true; modalHost.innerHTML = ''; onClose?.(); };
  box.append(render(close));
  modalHost.append(box);
  modalHost.onclick = (e) => { if (e.target === modalHost) close(); };
  return close;
}

export function confirmDialog(message, { okText = 'Onayla', cancelText = 'Reddet', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; close(); resolve(v); };
    const close = openModal({
      title: 'Onay gerekiyor',
      render: () => el('div', {},
        el('p', { class: 'small', style: 'white-space:pre-wrap;word-break:break-word', text: message }),
        el('div', { class: 'actions' },
          el('button', { class: 'btn', onclick: () => done(false) }, cancelText),
          el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => done(true) }, okText),
        ),
      ),
      onClose: () => done(false),
    });
  });
}

export function askDialog(question, options = []) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; close(); resolve(v); };
    const close = openModal({
      title: 'N.E.X.U.S. soruyor',
      render: () => {
        const input = el('input', { placeholder: 'Cevabın…' });
        const wrap = el('div', {},
          el('p', { style: 'white-space:pre-wrap', text: question }),
          options.length
            ? el('div', { class: 'row gap wrap', style: 'margin:10px 0' },
                ...options.map((o) => el('button', { class: 'btn tiny', onclick: () => done(String(o)) }, String(o))))
            : null,
          input,
          el('div', { class: 'actions' },
            el('button', { class: 'btn', onclick: () => done('(kullanıcı cevaplamadı)') }, 'Geç'),
            el('button', { class: 'btn primary', onclick: () => done(input.value.trim() || '(boş)') }, 'Gönder'),
          ),
        );
        setTimeout(() => input.focus(), 60);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value.trim() || '(boş)'); });
        return wrap;
      },
      onClose: () => done('(kullanıcı pencereyi kapattı)'),
    });
  });
}

export function promptDialog(title, fields, onSubmit) {
  const close = openModal({
    title,
    render: () => {
      const inputs = {};
      const wrap = el('div', {});
      for (const f of fields) {
        const node = f.type === 'textarea'
          ? el('textarea', { rows: f.rows || 4, placeholder: f.placeholder || '' })
          : el('input', { type: f.type || 'text', placeholder: f.placeholder || '' });
        node.value = f.value ?? '';
        inputs[f.key] = node;
        wrap.append(el('label', {}, f.label, node));
      }
      wrap.append(el('div', { class: 'actions' },
        el('button', { class: 'btn', onclick: () => close() }, 'Vazgeç'),
        el('button', {
          class: 'btn primary',
          onclick: () => {
            const vals = {};
            for (const k of Object.keys(inputs)) vals[k] = inputs[k].value;
            if (onSubmit(vals) !== false) close();
          },
        }, 'Kaydet'),
      ));
      return wrap;
    },
  });
  return close;
}

/* ---------------- sohbet ---------------- */
export function scrollChat(force = false) {
  const near = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 160;
  if (force || near) chatLog.scrollTop = chatLog.scrollHeight;
}

export function addMessage(role, content, { html = false } = {}) {
  const node = el('div', { class: 'msg ' + role });
  if (html) node.innerHTML = mdToHtml(content);
  else node.textContent = content;
  chatLog.append(node);
  scrollChat(role === 'user');
  return node;
}

export function addTyping() {
  const n = el('div', { class: 'msg bot typing' }, el('span'), el('span'), el('span'));
  chatLog.append(n);
  scrollChat(true);
  return n;
}

export function addPlanCard(plan, steps = []) {
  const body = el('div', { class: 'card-body' });
  if (plan) body.append(el('div', { style: 'margin-bottom:6px', text: plan }));
  if (steps.length) body.append(el('ol', {}, ...steps.map((s) => el('li', { text: String(s) }))));
  const card = el('div', { class: 'card plan' },
    el('div', {
      class: 'card-head',
      onclick: (e) => {
        body.classList.toggle('hidden');
        e.currentTarget.querySelector('.chev').textContent = body.classList.contains('hidden') ? '▸' : '▾';
      },
    },
      el('span', { text: '🧭' }),
      el('span', { class: 't', text: 'Planım' }),
      el('span', { class: 'chev', text: '▾' }),
    ),
    body,
  );
  chatLog.append(card);
  scrollChat();
  return card;
}

export function addToolCard(name, args) {
  const id = uid();
  const body = el('div', { class: 'card-body hidden' },
    el('div', { class: 'tool-io', text: 'girdi: ' + truncate(JSON.stringify(args ?? {}, null, 1), 1200) }),
  );
  const badge = el('span', { class: 'badge run', text: 'çalışıyor' });
  const card = el('div', { class: 'card', 'data-tool': id },
    el('div', {
      class: 'card-head',
      onclick: (e) => {
        body.classList.toggle('hidden');
        e.currentTarget.querySelector('.chev').textContent = body.classList.contains('hidden') ? '▸' : '▾';
      },
    },
      el('span', { text: '🔧' }),
      el('span', { class: 't', text: name }),
      badge,
      el('span', { class: 'chev', text: '▸' }),
    ),
    body,
  );
  chatLog.append(card);
  scrollChat();
  return { id, card, badge, body };
}

export function finishToolCard(handle, out) {
  if (!handle) return;
  handle.badge.className = 'badge ' + (out.ok ? 'ok' : 'err');
  handle.badge.textContent = out.ok ? 'tamam' : 'hata';
  handle.body.append(el('div', {
    class: 'tool-io',
    text: (out.ok ? 'sonuç: ' : 'HATA: ') + truncate(out.ok ? JSON.stringify(out.result, null, 1) : out.error, 2000),
  }));
  if (!out.ok) handle.body.classList.remove('hidden');
  scrollChat();
}

export function clearChatLog() { chatLog.innerHTML = ''; }
