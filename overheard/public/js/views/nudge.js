import { h, clear, distanceM, formatDistance } from '../util.js';
import { t } from '../i18n.js';
import { toast, sheetKey } from '../ui.js';

// Bu mesafedeki en yakın kilitli (ve sözü olan) mekân kartta gösterilir.
const MAX_DISTANCE_M = 5000;
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

  function update() {
    const { position, data } = app.state;
    if (!position || !data) return hide();
    const nearest = data.places
      .filter((p) => !p.visited && p.count > 0 && !dismissed.has(p.id))
      .map((p) => ({ ...p, distance: distanceM(position.lat, position.lng, p.lat, p.lng) }))
      .filter((p) => p.distance <= MAX_DISTANCE_M)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!nearest) return hide();

    clear(el).append(
      h('span', { class: 'nudge-icon', 'aria-hidden': 'true' }, '🔒'),
      h('button', { class: 'nudge-main', type: 'button', onclick: () => app.goToPlace(nearest) },
        h('span', { class: 'nudge-title' }, t('nudge.waiting', { n: nearest.count })),
        h('span', { class: 'nudge-sub' }, `🚶 ${formatDistance(nearest.distance)} · ${nearest.name}`)),
      h('a', { class: 'btn btn-primary nudge-go', href: directionsUrl(nearest), target: '_blank', rel: 'noopener' }, t('bubble.directions')),
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
        toast(t('nudge.hot', { place: nearest.name, d: formatDistance(nearest.distance) }), { tone: 'success' });
      }
    }
  }

  return { update };
}
