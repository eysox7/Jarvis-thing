// Harita sağlayıcısından bağımsız parçalar: balon öğeleri ve hangi işaretçinin nerede,
// hangi boyda çizileceğinin planı. Leaflet ve Google Maps uyarlayıcıları bu planı çizer.
import { h, truncate } from '../util.js';
import { t } from '../i18n.js';

// Bu yakınlaştırmadan itibaren tek tek söz baloncukları, altında mekân baloncukları gösterilir.
export const DETAIL_ZOOM = 15;
export const LONG_PRESS_MS = 600;

export function bubbleElement(o) {
  const classes = ['oh-bubble', o.locked ? 'is-locked' : 'is-open', o.visibility === 'public' && 'is-public', o.mine && 'is-mine', o.sameTime && 'is-same'].filter(Boolean).join(' ');
  if (o.locked) {
    return h('div', { class: classes, dataset: { id: o.id } },
      h('span', { class: 'oh-bubble-lock', 'aria-hidden': 'true' }, '🔒'),
      h('span', { class: 'oh-bubble-blur', style: { width: `${Math.min(110, 24 + o.length)}px` } }),
      h('span', { class: 'visually-hidden' }, t('bubble.locked')));
  }
  return h('div', { class: classes, dataset: { id: o.id } },
    o.visibility === 'public' ? h('span', { class: 'oh-bubble-globe', title: t('visibility.public') }, '🌍') : null,
    h('span', { class: 'oh-bubble-text' }, `“${truncate(o.text, 44)}”`),
    o.reactionTotal ? h('span', { class: 'oh-bubble-count' }, String(o.reactionTotal)) : null);
}

// Mekânın görüntüleyene göre durumu: buradaysan açık; değilsen herkese açık sözü varsa yarı açık,
// yalnızca yerel sözleri varsa kilitli.
export function placeState(p) {
  if (p.here) return { cls: 'is-open', icon: '💬' };
  if (p.publicCount > 0) return { cls: 'is-public', icon: '🌍' };
  return { cls: 'is-locked', icon: '🔒' };
}

export function placeElement(p) {
  const state = placeState(p);
  return h('div', { class: `oh-place ${state.cls}`, dataset: { id: p.id } },
    h('span', { class: 'oh-place-icon', 'aria-hidden': 'true' }, state.icon),
    h('span', { class: 'oh-place-name' }, p.name),
    p.count ? h('span', { class: 'oh-place-count' }, String(p.count)) : null);
}

export const dotElement = (label, classes) => h('div', { class: `oh-dot ${classes}` }, label);

export const meElement = () => h('span', { class: 'oh-me-dot' });

// Açgözlü yerleşim: öncelikli olan (en kalabalık mekân, en yeni söz) tam baloncuğu alır,
// ekranda başka bir baloncukla çakışanlar küçük noktaya iner.
function createLayout() {
  const boxes = [];
  return (point, width, height) => {
    const box = { x1: point.x - width / 2, x2: point.x + width / 2, y1: point.y - height - 12, y2: point.y - 8 };
    if (boxes.some((b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1)) return false;
    boxes.push(box);
    return true;
  };
}

const bubbleWidth = (o) => (o.locked
  ? 50 + Math.min(110, 24 + o.length)
  : Math.min(190, 30 + Math.min(44, [...o.text].length) * 6.4 + (o.reactionTotal ? 26 : 0)));

const placeWidth = (p) => 46 + [...p.name].length * 7.2 + (p.count ? 28 : 0);

// view: { zoom, project(lat, lng) → {x, y} (ekran pikseli), contains(lat, lng) → bool }
// Dönen her öğe: { type: 'area' | 'place' | 'overheard', lat, lng, item, element?, full? }
export function planMarkers(data, view) {
  if (!data) return [];
  const fits = createLayout();
  const plan = [];

  if (view.zoom < DETAIL_ZOOM) {
    const ranked = data.places
      .filter((p) => (p.count > 0 || p.here) && view.contains(p.lat, p.lng))
      .sort((a, b) => b.count - a.count);
    for (const p of ranked) {
      const full = fits(view.project(p.lat, p.lng), placeWidth(p), 30);
      const element = full
        ? placeElement(p)
        : dotElement(p.count ? String(p.count) : placeState(p).icon, `is-place ${placeState(p).cls}`);
      plan.push({ type: 'place', lat: p.lat, lng: p.lng, item: p, element, full, title: p.name });
    }
    return plan;
  }

  for (const p of data.places) {
    if (view.contains(p.lat, p.lng)) plan.push({ type: 'area', lat: p.lat, lng: p.lng, item: p });
  }
  // Sözler en yeniden eskiye sıralı gelir; yeniler tam baloncuk için önceliklidir.
  for (const o of data.overheards) {
    if (!view.contains(o.lat, o.lng)) continue;
    const full = fits(view.project(o.lat, o.lng), bubbleWidth(o), 32);
    const classes = [o.locked ? 'is-locked' : 'is-open', o.mine && 'is-mine'].filter(Boolean).join(' ');
    const element = full ? bubbleElement(o) : dotElement(o.locked ? '🔒' : '“', classes);
    plan.push({ type: 'overheard', lat: o.lat, lng: o.lng, item: o, element, full, title: o.locked ? t('bubble.locked') : truncate(o.text, 80) });
  }
  return plan;
}

// Dokunmatik ekranda basılı tutmayı algılar (iOS Safari contextmenu olayı göndermez).
export function attachLongPress(el, toLatLng, fire) {
  let timer = null;
  let start = null;
  el.addEventListener('touchstart', (e) => {
    clearTimeout(timer);
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    start = { x: touch.clientX, y: touch.clientY };
    timer = setTimeout(() => fire(toLatLng(touch)), LONG_PRESS_MS);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    if (start && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) clearTimeout(timer);
  }, { passive: true });
  el.addEventListener('touchend', () => clearTimeout(timer), { passive: true });
}

// Aynı basışın hem contextmenu hem dokunma ile iki kez tetiklenmesini önler.
export function debounceLongPress(handler) {
  let last = 0;
  return (latlng) => {
    if (Date.now() - last < 800) return;
    last = Date.now();
    handler?.(latlng);
  };
}

export const prefersDark = () => matchMedia('(prefers-color-scheme: dark)');

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
