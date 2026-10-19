/* global L */
import { h, truncate } from './util.js';
import { t } from './i18n.js';

// Bu yakınlaştırmadan itibaren tek tek söz baloncukları, altında mekân baloncukları gösterilir.
export const DETAIL_ZOOM = 15;
const LONG_PRESS_MS = 600;

const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

export function createMap(el, handlers) {
  const map = L.map(el, { zoomControl: false, minZoom: 3, maxZoom: 19, worldCopyJump: true });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix(false);

  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const tiles = L.tileLayer('', { subdomains: 'abcd', maxZoom: 20, attribution: ATTRIBUTION, detectRetina: true }).addTo(map);
  const applyTheme = () => tiles.setUrl(`https://{s}.basemaps.cartocdn.com/${darkQuery.matches ? 'dark_all' : 'rastertiles/voyager'}/{z}/{x}/{y}{r}.png`);
  applyTheme();
  darkQuery.addEventListener('change', applyTheme);

  const circles = L.layerGroup().addTo(map);
  const placeMarkers = L.layerGroup().addTo(map);
  const bubbles = L.layerGroup().addTo(map);
  let data = null;
  let me = null;
  let meAccuracy = null;

  function bubbleElement(o) {
    const classes = ['oh-bubble', o.locked ? 'is-locked' : 'is-open', o.mine && 'is-mine', o.sameTime && 'is-same'].filter(Boolean).join(' ');
    if (o.locked) {
      return h('div', { class: classes, dataset: { id: o.id } },
        h('span', { class: 'oh-bubble-lock', 'aria-hidden': 'true' }, '🔒'),
        h('span', { class: 'oh-bubble-blur', style: { width: `${Math.min(110, 24 + o.length)}px` } }),
        h('span', { class: 'visually-hidden' }, t('bubble.locked')));
    }
    return h('div', { class: classes, dataset: { id: o.id } },
      h('span', { class: 'oh-bubble-text' }, `“${truncate(o.text, 44)}”`),
      o.reactionTotal ? h('span', { class: 'oh-bubble-count' }, String(o.reactionTotal)) : null);
  }

  function placeElement(p) {
    return h('div', { class: `oh-place ${p.visited ? 'is-open' : 'is-locked'}`, dataset: { id: p.id } },
      h('span', { class: 'oh-place-icon', 'aria-hidden': 'true' }, p.visited ? '💬' : '🔒'),
      h('span', { class: 'oh-place-name' }, p.name),
      p.count ? h('span', { class: 'oh-place-count' }, String(p.count)) : null);
  }

  const divIcon = (element, className) => L.divIcon({ className, html: element, iconSize: [0, 0] });

  const dotElement = (label, classes) => h('div', { class: `oh-dot ${classes}` }, label);

  // Ekranda çakışan etiketleri küçük noktalara indirir: öncelikli olan (en kalabalık mekân,
  // en yeni söz) tam baloncuğu alır, yerleşemeyenler nokta olur.
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

  function redraw() {
    circles.clearLayers();
    placeMarkers.clearLayers();
    bubbles.clearLayers();
    if (!data) return;
    const detail = map.getZoom() >= DETAIL_ZOOM;
    const view = map.getBounds().pad(0.6);
    const fits = createLayout();
    const point = (lat, lng) => map.latLngToContainerPoint([lat, lng]);

    if (!detail) {
      const ranked = data.places
        .filter((p) => (p.count > 0 || p.visited) && view.contains([p.lat, p.lng]))
        .sort((a, b) => b.count - a.count);
      for (const p of ranked) {
        const full = fits(point(p.lat, p.lng), 46 + [...p.name].length * 7.2 + (p.count ? 28 : 0), 30);
        const element = full
          ? placeElement(p)
          : dotElement(p.count ? String(p.count) : '🔒', `is-place ${p.visited ? 'is-open' : 'is-locked'}`);
        L.marker([p.lat, p.lng], { icon: divIcon(element, 'oh-marker'), keyboard: true, title: p.name, zIndexOffset: full ? 100 : 0 })
          .on('click', () => handlers.onPlaceClick(p))
          .addTo(placeMarkers);
      }
      return;
    }

    for (const p of data.places) {
      if (!view.contains([p.lat, p.lng])) continue;
      L.circle([p.lat, p.lng], {
        radius: p.radius,
        interactive: false,
        className: `oh-place-area ${p.visited ? 'is-open' : 'is-locked'}`,
      }).addTo(circles);
    }
    // Sözler en yeniden eskiye sıralı gelir; yeniler tam baloncuk için önceliklidir.
    for (const o of data.overheards) {
      if (!view.contains([o.lat, o.lng])) continue;
      const full = fits(point(o.lat, o.lng), bubbleWidth(o), 32);
      const classes = [o.locked ? 'is-locked' : 'is-open', o.mine && 'is-mine'].filter(Boolean).join(' ');
      const element = full ? bubbleElement(o) : dotElement(o.locked ? '🔒' : '“', classes);
      L.marker([o.lat, o.lng], {
        icon: divIcon(element, 'oh-marker'),
        keyboard: true,
        riseOnHover: true,
        zIndexOffset: full ? 100 : 0,
        title: o.locked ? t('bubble.locked') : truncate(o.text, 80),
      })
        .on('click', () => handlers.onBubbleClick(o))
        .addTo(bubbles);
    }
  }

  map.on('zoomend moveend', redraw);

  // Uzun basma: masaüstünde sağ tık, dokunmatikte basılı tutma (iOS contextmenu göndermez).
  let pressTimer = null;
  let pressStart = null;
  let lastLongPress = 0;
  const fireLongPress = (latlng) => {
    if (Date.now() - lastLongPress < 800) return;
    lastLongPress = Date.now();
    handlers.onLongPress?.(latlng);
  };
  map.on('contextmenu', (e) => fireLongPress(e.latlng));
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return clearTimeout(pressTimer);
    const touch = e.touches[0];
    pressStart = { x: touch.clientX, y: touch.clientY };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => fireLongPress(map.mouseEventToLatLng(touch)), LONG_PRESS_MS);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    if (pressStart && Math.hypot(touch.clientX - pressStart.x, touch.clientY - pressStart.y) > 10) clearTimeout(pressTimer);
  }, { passive: true });
  el.addEventListener('touchend', () => clearTimeout(pressTimer), { passive: true });

  let current = null;
  function popup(latlng, content, className = 'oh-popup') {
    current = L.popup({
      className,
      maxWidth: 330,
      minWidth: 250,
      offset: [0, -4],
      autoPanPaddingTopLeft: [16, 130],
      autoPanPaddingBottomRight: [16, 110],
    }).setLatLng(latlng).setContent(content).openOn(map);
    return current;
  }

  return {
    leaflet: map,

    setCity(city) {
      map.setView([city.lat, city.lng], city.zoom, { animate: false });
    },

    render(next) {
      data = next;
      redraw();
    },

    // Sözü büyük bir konuşma balonu olarak açar; gerekirse önce yakınlaşır.
    openOverheard(o, content) {
      const show = () => popup([o.lat, o.lng], content);
      if (map.getZoom() < DETAIL_ZOOM || !map.getBounds().contains([o.lat, o.lng])) {
        map.once('moveend', show);
        map.flyTo([o.lat, o.lng], Math.max(map.getZoom(), 16), { duration: 0.6 });
      } else {
        show();
      }
    },

    openAt(latlng, content) {
      return popup(latlng, content, 'oh-popup oh-popup-small');
    },

    // Açık balonun içeriğini (ör. kilit açılınca) yerinde günceller.
    updateOpen(content) {
      if (current && map.hasLayer(current)) current.setContent(content);
    },

    closePopup() {
      map.closePopup();
    },

    flyTo(lat, lng, zoom = 16) {
      map.flyTo([lat, lng], zoom, { duration: 0.7 });
    },

    showMe(pos) {
      const latlng = [pos.lat, pos.lng];
      if (!me) {
        me = L.marker(latlng, {
          icon: divIcon(h('span', { class: 'oh-me-dot' }), 'oh-me-marker'),
          interactive: false,
          keyboard: false,
          zIndexOffset: 1000,
        }).addTo(map);
        meAccuracy = L.circle(latlng, { radius: pos.accuracy || 0, interactive: false, className: 'oh-me-accuracy' }).addTo(map);
      } else {
        me.setLatLng(latlng);
        meAccuracy.setLatLng(latlng).setRadius(pos.accuracy || 0);
      }
      me.getElement()?.classList.toggle('is-demo', Boolean(pos.simulated));
    },
  };
}
