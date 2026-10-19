import { h, clear, timeAgo, truncate } from '../util.js';
import { t, errorText } from '../i18n.js';
import { api } from '../api.js';
import { openSheet, closeSheet, sheetKey, formError, busy, toast } from '../ui.js';

// Mekân odası: o an aynı mekânda bulunanların geçici grup sohbeti.
let openPlaceId = null;
const lastToast = new Map();

const roomKey = (placeId) => `room:${placeId}`;

function line(m) {
  return h('div', { class: `msg room-msg ${m.mine ? 'is-me' : 'is-them'}` },
    m.mine ? null : h('span', { class: 'room-author' }, `@${m.author}`),
    h('p', { class: 'msg-body' }, m.body),
    h('time', { class: 'msg-time', datetime: new Date(m.createdAt).toISOString() }, timeAgo(m.createdAt)));
}

export async function openRoom(app, place) {
  if (!app.state.user) return app.openAuth(() => openRoom(app, place));
  openPlaceId = place.id;
  const body = h('div', { class: 'chat' }, h('p', { class: 'muted' }, t('common.loading')));
  openSheet({ key: roomKey(place.id), title: `💬 ${t('room.title', { place: place.name })}`, body, onClose: () => { openPlaceId = null; } });

  let room;
  try {
    ({ room } = await api.room(place.id));
  } catch (err) {
    clear(body).append(h('p', { class: 'form-error' }, errorText(err)));
    return;
  }
  const list = h('div', { class: 'msg-list', 'aria-live': 'polite' },
    room.messages.length ? room.messages.map(line) : h('p', { class: 'empty room-empty' }, `👋 ${t('room.empty')}`));
  const error = formError();
  const input = h('textarea', { rows: 1, maxlength: 500, placeholder: t('room.placeholder'), required: true });
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
          const { message } = await api.roomPost(place.id, input.value);
          list.querySelector('.room-empty')?.remove();
          list.append(line(message));
          list.scrollTop = list.scrollHeight;
          input.value = '';
        } catch (err) {
          error.show(errorText(err));
        }
      });
    },
  }, input, send);

  clear(body).append(
    h('div', { class: 'chat-context' },
      h('p', { class: 'muted small' }, t('room.info', { n: room.peopleHere, h: room.retentionHours }))),
    list,
    error.el,
    form);
  list.scrollTop = list.scrollHeight;
  input.focus();
}

// Canlı gelen oda mesajı: oda açıksa oraya eklenir, değilse (seyrek) bildirim gösterilir.
export function handleRoomMessage(app, { placeId, message }) {
  if (openPlaceId === placeId && sheetKey() === roomKey(placeId)) {
    const list = document.querySelector('#sheet .msg-list');
    list.querySelector('.room-empty')?.remove();
    list.append(line({ ...message, mine: false }));
    list.scrollTop = list.scrollHeight;
    return;
  }
  if (Date.now() - (lastToast.get(placeId) || 0) < 2 * 60000) return;
  lastToast.set(placeId, Date.now());
  const place = app.state.data?.places.find((p) => p.id === placeId);
  toast(t('room.toast', { place: place?.name || '', author: message.author, body: truncate(message.body, 50) }), {
    action: t('room.enter'),
    onAction: () => place && openRoom(app, place),
    timeout: 7000,
  });
}

// Mekândan ayrılınca açık oda kapanır.
export function closeRoomIfLeft(leftPlaces) {
  const left = leftPlaces.find((p) => p.id === openPlaceId);
  if (!left) return;
  closeSheet();
  toast(t('room.closed', { place: left.name }));
}
