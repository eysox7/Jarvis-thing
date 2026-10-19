import { h, distanceM, formatDistance, formatDate } from '../util.js';
import { t, errorText } from '../i18n.js';
import { api } from '../api.js';
import { openSheet, closeSheet } from '../ui.js';

function placeRow(p, { app, meta, locked }) {
  return h('li', {},
    h('button', {
      class: `list-item${locked ? ' is-locked' : ''}`,
      type: 'button',
      onclick: () => {
        closeSheet();
        app.goToPlace(p);
      },
    },
    h('span', { class: 'list-icon', 'aria-hidden': 'true' }, locked ? '🔒' : '📍'),
    h('span', { class: 'list-main' }, h('span', { class: 'list-title' }, p.name), h('span', { class: 'list-sub' }, meta)),
    p.count ? h('span', { class: 'pill' }, t('places.count', { n: p.count })) : null));
}

export async function openPlaces(app) {
  if (!app.state.user) return app.openAuth(() => openPlaces(app));
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('places.subtitle')), h('p', { class: 'muted' }, t('common.loading')));
  openSheet({ key: 'places', title: t('places.title'), body });

  let places;
  try {
    ({ places } = await api.myPlaces());
  } catch (err) {
    body.lastChild.textContent = errorText(err);
    return;
  }
  body.lastChild.remove();

  const cityName = new Map(app.state.config.cities.map((c) => [c.id, c.name]));
  const hereNow = places.filter((p) => p.here);
  if (hereNow.length) {
    body.append(
      h('h3', { class: 'section-title' }, `💬 ${t('places.hereNow')}`),
      h('ul', { class: 'list' }, hereNow.map((p) => {
        const people = app.state.data?.places.find((x) => x.id === p.id)?.peopleHere;
        const meta = [people ? `👥 ${t('place.peopleHere', { n: people })}` : null, t('places.hereHint', { n: app.state.config.presenceMinutes })].filter(Boolean).join(' · ');
        return placeRow(p, { app, meta });
      })));
  }
  if (!places.length) body.append(h('p', { class: 'empty' }, `🚶 ${t('places.empty')}`));
  else {
    body.append(
      h('h3', { class: 'section-title' }, `${t('places.unlocked')} · ${places.length}`),
      h('ul', { class: 'list' }, places.map((p) => placeRow(p, {
        app,
        meta: [cityName.get(p.cityId), t('places.visits', { n: p.visits }), t('places.firstVisit', { date: formatDate(p.firstAt) })].join(' · '),
      }))));
  }

  // Bulunduğun şehirdeki, henüz gitmediğin ve sözü olan mekânlar: yürümek için bir sebep.
  const origin = app.state.position || app.state.city;
  const waiting = (app.state.data?.places || [])
    .filter((p) => !p.here && p.localCount > 0)
    .map((p) => ({ ...p, distance: distanceM(origin.lat, origin.lng, p.lat, p.lng) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8);
  if (waiting.length) {
    body.append(
      h('h3', { class: 'section-title' }, t('places.nearby')),
      h('ul', { class: 'list' }, waiting.map((p) => placeRow({ ...p, count: p.localCount }, { app, locked: true, meta: `🚶 ${formatDistance(p.distance)}` }))));
  }
}
