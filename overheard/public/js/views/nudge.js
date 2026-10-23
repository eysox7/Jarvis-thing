import { h, clear, distanceM, formatDistance } from '../util.js';
import { t } from '../i18n.js';
import { toast, sheetKey } from '../ui.js';

// Bu mesafedeki en yakın kilitli (ve sözü olan) mekân kartta gösterilir.
const MAX_DISTANCE_M = 5000;
// Bu yarıçapta hiç söz yoksa "sakin bölge": ilk sözü bırakmaya ve en yakın Overheard Kafe'ye çağırır.
const QUIET_RADIUS_M = 1500;
const CAFE_DISTANCE_M = 8000;
// Keşif modunda yaklaştıkça verilen ipuçlarının eşikleri.
const HOT_THRESHOLDS_M = [300, 100];

const directionsUrl = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking`;

// "250 m ötede 4 kilitli söz seni bekliyor" kartı: insanları bir sonraki mekâna yürümeye çağırır.
export function createNudge(app) {
  const el = document.getElementById('nudge');
  const dismissed = new Set();
  const warned = new Map();

  function hide() {
    el.hidden = true;
    document.body.classList.remove('has-nudge');
  }

  // Hatlarda uzaklık ve yol tarifi en yakın durağa.
  const pointOf = (p, position) => (p.line && p.stops?.length
    ? p.stops.map(([lat, lng]) => ({ lat, lng })).reduce((a, b) => (distanceM(position.lat, position.lng, a.lat, a.lng) <= distanceM(position.lat, position.lng, b.lat, b.lng) ? a : b))
    : p);

  function update() {
    const { position, data } = app.state;
    if (!position || !data) return hide();
    const point = (p) => pointOf(p, position);
    const nearest = data.places
      .filter((p) => !p.here && p.localCount > 0 && !dismissed.has(p.id))
      .map((p) => {
        const at = point(p);
        return { ...p, goal: at, distance: distanceM(position.lat, position.lng, at.lat, at.lng) };
      })
      .filter((p) => p.distance <= MAX_DISTANCE_M)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!nearest) return quiet(position, data);
    if (el.dataset.place !== nearest.id) delete el.dataset.hot;
    el.dataset.place = nearest.id;

    clear(el).append(
      h('span', { class: 'nudge-icon', 'aria-hidden': 'true' }, '🔒'),
      h('button', { class: 'nudge-main', type: 'button', onclick: () => app.goToPlace(nearest) },
        h('span', { class: 'nudge-title' }, t('nudge.waiting', { n: nearest.localCount })),
        h('span', { class: 'nudge-sub' }, `🚶 ${formatDistance(nearest.distance)} · ${nearest.name}`)),
      h('a', { class: 'btn btn-primary nudge-go', href: directionsUrl(nearest.goal), target: '_blank', rel: 'noopener' }, t('bubble.directions')),
      h('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': t('common.close'),
        onclick: () => {
          dismissed.add(nearest.id);
          update();
        },
      }, '✕'));
    el.hidden = false;
    document.body.classList.add('has-nudge');

    // Keşif modunda yaklaştıkça "sıcak" ipucu; her eşik için bir kez.
    if (!app.state.exploring || sheetKey()) return;
    for (const threshold of HOT_THRESHOLDS_M) {
      if (nearest.distance <= threshold && (warned.get(nearest.id) ?? Infinity) > threshold) {
        warned.set(nearest.id, threshold);
        el.dataset.hot = String(threshold);
        toast(t('nudge.hot', { place: nearest.name, d: formatDistance(nearest.distance) }), { tone: 'success' });
      }
    }
  }

  // Sakin bölge (Sultanbeyli, Sancaktepe gibi henüz sözü olmayan yerler): boş harita bir eksik değil,
  // bir davet. Yakında bir Overheard Kafe varsa o da gösterilir (sözler masana fiş olarak gelir).
  function quiet(position, data) {
    const near = (p, max) => {
      const at = pointOf(p, position);
      return distanceM(position.lat, position.lng, at.lat, at.lng) <= max;
    };
    if (dismissed.has('quiet') || data.places.some((p) => p.count > 0 && near(p, QUIET_RADIUS_M))) return hide();
    const cafe = data.places
      .filter((p) => p.cafe)
      .map((p) => ({ ...p, distance: distanceM(position.lat, position.lng, p.lat, p.lng) }))
      .filter((p) => p.distance <= CAFE_DISTANCE_M)
      .sort((a, b) => a.distance - b.distance)[0];
    delete el.dataset.hot;
    el.dataset.place = 'quiet';
    clear(el).append(
      h('span', { class: 'nudge-icon', 'aria-hidden': 'true' }, '🌱'),
      h('div', { class: 'nudge-main' },
        h('span', { class: 'nudge-title' }, t('nudge.quiet')),
        cafe
          ? h('a', { class: 'nudge-sub nudge-link', href: directionsUrl(cafe), target: '_blank', rel: 'noopener' }, `☕ ${t('nudge.cafe', { place: cafe.name, d: formatDistance(cafe.distance) })}`)
          : h('span', { class: 'nudge-sub' }, t('nudge.quietSub'))),
      h('button', { class: 'btn btn-primary nudge-go', type: 'button', onclick: () => app.compose() }, t('nudge.drop')),
      h('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': t('common.close'),
        onclick: () => {
          dismissed.add('quiet');
          hide();
        },
      }, '✕'));
    el.hidden = false;
    document.body.classList.add('has-nudge');
  }

  return { update };
}
