import { h, timeAgo, distanceM, formatDistance, displayName, REACTION_EMOJI } from '../util.js';
import { t } from '../i18n.js';

const directionsUrl = (o) => `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}&travelmode=walking`;

// Hat sözünde hedef sözün yeri değil, hattın sana en yakın durağıdır (oradan binilir).
function target(o, app) {
  const stops = o.onLine ? app.state.data?.places.find((p) => p.id === o.placeId)?.stops : null;
  if (!stops?.length) return { lat: o.lat, lng: o.lng };
  const from = app.state.position || o;
  const [lat, lng] = stops.reduce((best, s) => (distanceM(from.lat, from.lng, s[0], s[1]) < distanceM(from.lat, from.lng, best[0], best[1]) ? s : best));
  return { lat, lng };
}

// Kilitli sözün yerine, uzunluğuna göre bulanık "hayalet" satırlar.
function ghostLines(length) {
  const lines = Math.max(1, Math.min(4, Math.ceil(length / 48)));
  return Array.from({ length: lines }, (_, i) => h('span', {
    class: 'ghost-line',
    style: { width: `${i === lines - 1 && lines > 1 ? 35 + ((length * 7) % 45) : 92}%` },
  }));
}

const peopleHere = (app, o) => app.state.data?.places.find((p) => p.id === o.placeId)?.peopleHere || 0;

function lockedCard(o, app) {
  const { state } = app;
  const goal = target(o, app);
  const distance = state.position ? distanceM(state.position.lat, state.position.lng, goal.lat, goal.lng) : null;
  return h('div', { class: 'bubble-card is-locked' },
    h('div', { class: 'bubble-ghost', 'aria-hidden': 'true' }, h('span', { class: 'bubble-lock-icon' }, '🔒'), h('div', { class: 'ghost-lines' }, ghostLines(o.length))),
    h('p', { class: 'bubble-where' }, t(o.onLine ? 'bubble.lockedWhereLine' : 'bubble.lockedWhere', { place: o.placeName })),
    peopleHere(app, o) ? h('p', { class: 'bubble-distance' }, `👥 ${t(o.onLine ? 'place.peopleOnLine' : 'place.peopleHere', { n: peopleHere(app, o) })}`) : null,
    h('p', { class: 'bubble-how' }, state.user ? t(o.onLine ? 'bubble.lockedHowLine' : 'bubble.lockedHow') : t('bubble.loginToRead')),
    distance != null ? h('p', { class: 'bubble-distance' }, `🚶 ${t('bubble.distance', { d: formatDistance(distance) })}`) : null,
    h('div', { class: 'bubble-actions' },
      h('a', { class: 'btn btn-primary', href: directionsUrl(goal), target: '_blank', rel: 'noopener' }, `🧭 ${t(o.onLine ? 'bubble.directionsStop' : 'bubble.directions')}`),
      !state.user ? h('button', { class: 'btn', type: 'button', onclick: () => app.openAuth() }, t('auth.login')) : null,
      state.config.demoMode && state.user
        ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => app.teleport(goal, o.id) }, `✨ ${t('map.teleport')}`)
        : null));
}

function openCard(o, app) {
  const reactions = app.state.config.reactions.map((kind) => {
    const count = o.reactions[kind] || 0;
    const pressed = o.myReactions.includes(kind);
    // 👂 "Ben de duydum" bir tanıklık iddiasıdır: yalnızca o sırada orada olanlara açık.
    const blocked = kind === 'same' && !pressed && !o.canWitness;
    return h('button', {
      class: `react${pressed ? ' is-pressed' : ''}`,
      type: 'button',
      title: blocked ? t('react.sameOnly') : t(`react.${kind}`),
      'aria-pressed': pressed ? 'true' : 'false',
      disabled: blocked,
      onclick: () => app.react(o, kind),
    }, h('span', { 'aria-hidden': 'true' }, REACTION_EMOJI[kind]), count ? h('span', { class: 'react-count' }, String(count)) : null,
    h('span', { class: 'visually-hidden' }, t(`react.${kind}`)));
  });

  const place = app.state.data?.places.find((p) => p.id === o.placeId);
  const badges = [
    place?.peopleHere ? h('span', { class: 'chip' }, `👥 ${t(o.onLine ? 'place.peopleOnLine' : 'place.peopleHere', { n: place.peopleHere })}`) : null,
    o.visibility === 'public'
      ? h('span', { class: 'chip' }, `🌍 ${t('visibility.public')}`)
      : h('span', { class: 'chip' }, `📍 ${t('visibility.local')}`),
    o.expiresAt ? h('span', { class: 'chip' }, `⏳ ${t('bubble.expires', { n: Math.max(1, Math.ceil((o.expiresAt - Date.now()) / 3600000)) })}`) : null,
    o.offline ? h('span', { class: 'chip' }, `📡 ${o.hops ? t('bubble.offlineHops', { n: o.hops }) : t('bubble.offline')}`) : null,
    o.sameTime ? h('span', { class: 'chip chip-hot' }, `👂 ${t('bubble.sameTime')}`) : null,
    o.mutualPlaces ? h('span', { class: 'chip' }, `📍 ${t('bubble.mutual', { n: o.mutualPlaces })}`) : null,
  ].filter(Boolean);

  const me = app.state.user?.handle;
  const witnesses = o.witnesses.length
    ? h('div', { class: 'bubble-witnesses' },
      h('span', { class: 'muted small' }, `👂 ${t('bubble.witnesses')}:`),
      o.witnesses.map((handle) => (o.canMessageWitnesses && handle !== me
        ? h('button', { class: 'chip chip-btn', type: 'button', title: t('bubble.writeWitness', { handle }), onclick: () => app.startMessage(o, handle) }, `@${handle}`)
        : h('span', { class: 'chip' }, `@${handle}`))))
    : null;

  return h('div', { class: 'bubble-card' },
    h('blockquote', { class: 'bubble-quote' }, o.text),
    h('div', { class: 'bubble-meta' },
      h('span', { class: 'bubble-author' }, o.mine ? t(o.anonymous ? 'bubble.mineAnon' : 'bubble.mine') : displayName(o.author)),
      h('span', { 'aria-hidden': 'true' }, ' · '),
      h('span', {}, o.placeName),
      h('span', { 'aria-hidden': 'true' }, ' · '),
      h('time', { datetime: new Date(o.createdAt).toISOString() }, timeAgo(o.createdAt))),
    badges.length ? h('div', { class: 'bubble-badges' }, badges) : null,
    h('div', { class: 'bubble-reactions' }, reactions),
    witnesses,
    h('div', { class: 'bubble-actions' },
      o.canMessage ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => app.startMessage(o) }, `💬 ${t('bubble.message')}`) : null,
      // Yalnızca herkese açık sözler dışarı paylaşılır; yerel sözler yerinde kalır.
      o.visibility === 'public' ? h('button', { class: 'btn', type: 'button', onclick: () => app.share(o) }, `📤 ${t('share.button')}`) : null,
      o.mine
        ? h('button', { class: 'btn btn-ghost btn-danger', type: 'button', onclick: () => app.deleteOverheard(o) }, t('bubble.delete'))
        : h('span', { class: 'bubble-more' },
          h('button', { class: 'link-btn', type: 'button', onclick: () => app.reportOverheard(o) }, t('bubble.report')),
          h('span', { 'aria-hidden': 'true' }, ' · '),
          h('button', { class: 'link-btn', type: 'button', onclick: () => app.blockAuthor(o) }, t('bubble.block')))));
}

export function bubbleContent(o, app) {
  return o.locked ? lockedCard(o, app) : openCard(o, app);
}
