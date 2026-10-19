import { h, clear, timeAgo, truncate } from '../util.js';
import { t, errorText } from '../i18n.js';
import { api } from '../api.js';
import { openSheet, sheetKey, formError, busy } from '../ui.js';

let activeConversation = null;

export async function openInbox(app) {
  if (!app.state.user) return app.openAuth(() => openInbox(app));
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('common.loading')));
  openSheet({ key: 'inbox', title: t('inbox.title'), body });
  activeConversation = null;
  try {
    const { conversations } = await api.conversations();
    clear(body);
    if (!conversations.length) {
      body.append(h('p', { class: 'empty' }, `💬 ${t('inbox.empty')}`));
      return;
    }
    body.append(h('ul', { class: 'list' }, conversations.map((c) => h('li', {},
      h('button', { class: `list-item${c.unread ? ' is-unread' : ''}`, type: 'button', onclick: () => openConversation(app, c.id) },
        h('span', { class: 'avatar', 'aria-hidden': 'true' }, c.with.slice(0, 1).toUpperCase()),
        h('span', { class: 'list-main' },
          h('span', { class: 'list-title' }, `@${c.with}`, h('span', { class: 'list-time' }, timeAgo(c.lastAt))),
          h('span', { class: 'list-quote' }, `“${truncate(c.overheardText, 60)}” · ${c.placeName}`),
          h('span', { class: 'list-sub' }, (c.lastFromMe ? t('inbox.you') : '') + truncate(c.lastMessage || '', 70))),
        c.unread ? h('span', { class: 'dot', 'aria-label': '•' }) : null)))));
  } catch (err) {
    clear(body).append(h('p', { class: 'form-error' }, errorText(err)));
  }
}

function messageBubble(m) {
  return h('div', { class: `msg ${m.fromMe ? 'is-me' : 'is-them'}` },
    h('p', { class: 'msg-body' }, m.body),
    h('time', { class: 'msg-time', datetime: new Date(m.createdAt).toISOString() }, timeAgo(m.createdAt)));
}

function composer({ placeholder, onSend }) {
  const error = formError();
  const input = h('textarea', { rows: 1, maxlength: 1000, placeholder, required: true });
  const send = h('button', { class: 'btn btn-primary', type: 'submit' }, t('chat.send'));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  const form = h('form', {
    class: 'composer',
    onsubmit: (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      error.hide();
      busy(send, async () => {
        try {
          await onSend(input.value);
          input.value = '';
        } catch (err) {
          error.show(errorText(err));
        }
      });
    },
  }, input, send);
  return { el: h('div', {}, error.el, form), focus: () => input.focus() };
}

export async function openConversation(app, id) {
  activeConversation = id;
  const body = h('div', { class: 'chat' }, h('p', { class: 'muted' }, t('common.loading')));
  openSheet({ key: `chat:${id}`, title: '…', body, back: () => openInbox(app), onClose: () => { activeConversation = null; } });
  let conv;
  try {
    ({ conversation: conv } = await api.conversation(id));
  } catch (err) {
    clear(body).append(h('p', { class: 'form-error' }, errorText(err)));
    return;
  }
  app.refreshUnread();
  document.querySelector('#sheet .sheet-title').textContent = `@${conv.with}`;

  const list = h('div', { class: 'msg-list', 'aria-live': 'polite' }, conv.messages.map(messageBubble));
  const box = composer({
    placeholder: t('chat.placeholder'),
    onSend: async (text) => {
      const { message } = await api.reply(id, text);
      list.append(messageBubble(message));
      list.scrollTop = list.scrollHeight;
    },
  });

  clear(body).append(
    h('div', { class: 'chat-context' },
      h('p', { class: 'chat-about' }, t('chat.about')),
      h('blockquote', { class: 'chat-quote' }, conv.overheard.text, h('span', { class: 'chat-place' }, ` — ${conv.overheard.placeName}`)),
      conv.mutualPlaces.length
        ? h('div', { class: 'chat-mutual' },
          h('span', { class: 'muted small' }, `${t('chat.mutual')}: `),
          conv.mutualPlaces.map((p) => h('span', { class: 'chip' }, `📍 ${p.name}`)))
        : null,
      h('p', { class: 'muted small' }, chatHint(conv))),
    list,
    box.el);
  list.scrollTop = list.scrollHeight;
  box.focus();
}

function chatHint(conv) {
  if (conv.kind === 'witness') return t('chat.witnessHint');
  return conv.role === 'owner' ? t('chat.ownerHint') : t('chat.starterHint');
}

// Bir söz hakkında ilk mesaj: sözün sahibine ya da (to verilirse) bir tanığa.
// İki kişi arasında bu söz için konuşma zaten varsa ona eklenir.
export function openNewMessage(app, o, to) {
  if (!app.state.user) return app.openAuth(() => openNewMessage(app, o, to));
  const recipient = to || o.author;
  const toWitness = recipient !== o.author;
  const box = composer({
    placeholder: t('chat.placeholder'),
    onSend: async (text) => {
      const { conversationId } = await api.messageAbout(o.id, text, toWitness ? recipient : undefined);
      await openConversation(app, conversationId);
    },
  });
  openSheet({
    key: 'new-message',
    title: `@${recipient}`,
    body: h('div', { class: 'chat' },
      h('div', { class: 'chat-context' },
        h('p', { class: 'chat-about' }, t('chat.about')),
        h('blockquote', { class: 'chat-quote' }, o.text, h('span', { class: 'chat-place' }, ` — ${o.placeName}`)),
        h('p', { class: 'muted small' }, toWitness || o.mine ? t('chat.witnessHint') : t('chat.starterHint'))),
      box.el),
  });
  setTimeout(box.focus, 50);
}

// Canlı gelen mesaj açık konuşmaya aitse orada gösterilir; değilse false döner.
export async function handleIncoming(app, event) {
  if (activeConversation !== event.conversationId || sheetKey() !== `chat:${event.conversationId}`) return false;
  const list = document.querySelector('#sheet .msg-list');
  if (!list) return false;
  list.append(messageBubble({ body: event.body, createdAt: event.createdAt, fromMe: false }));
  list.scrollTop = list.scrollHeight;
  // Okundu olarak işaretlemek için konuşmayı sessizce yeniden çek.
  api.conversation(event.conversationId).then(() => app.refreshUnread()).catch(() => {});
  return true;
}
