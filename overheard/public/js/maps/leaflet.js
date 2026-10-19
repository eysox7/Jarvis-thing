/* global L */
import { DETAIL_ZOOM, planMarkers, meElement, attachLongPress, debounceLongPress, prefersDark } from './common.js';

const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

export function createLeafletMap(el, handlers) {
  const map = L.map(el, { zoomControl: false, minZoom: 3, maxZoom: 19, worldCopyJump: true });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix(false);

  const dark = prefersDark();
  const tiles = L.tileLayer('', { subdomains: 'abcd', maxZoom: 20, attribution: ATTRIBUTION, detectRetina: true }).addTo(map);
  const applyTheme = () => tiles.setUrl(`https://{s}.basemaps.cartocdn.com/${dark.matches ? 'dark_all' : 'rastertiles/voyager'}/{z}/{x}/{y}{r}.png`);
  applyTheme();
  dark.addEventListener('change', applyTheme);

  const layer = L.layerGroup().addTo(map);
  let data = null;
  let me = null;
  let meAccuracy = null;
  let current = null;

  const divIcon = (element, className) => L.divIcon({ className, html: element, iconSize: [0, 0] });

  function redraw() {
    layer.clearLayers();
    const bounds = map.getBounds().pad(0.6);
    const plan = planMarkers(data, {
      zoom: map.getZoom(),
      project: (lat, lng) => map.latLngToContainerPoint([lat, lng]),
      contains: (lat, lng) => bounds.contains([lat, lng]),
    });
    for (const m of plan) {
      if (m.type === 'area') {
        L.circle([m.lat, m.lng], {
          radius: m.item.radius,
          interactive: false,
          className: `oh-place-area ${m.item.visited ? 'is-open' : 'is-locked'}`,
        }).addTo(layer);
        continue;
      }
      const onClick = m.type === 'place' ? () => handlers.onPlaceClick(m.item) : () => handlers.onBubbleClick(m.item);
      L.marker([m.lat, m.lng], {
        icon: divIcon(m.element, 'oh-marker'),
        keyboard: true,
        riseOnHover: m.type === 'overheard',
        zIndexOffset: m.full ? 100 : 0,
        title: m.title,
      }).on('click', onClick).addTo(layer);
    }
  }

  map.on('zoomend moveend', redraw);

  const longPress = debounceLongPress(handlers.onLongPress);
  map.on('contextmenu', (e) => longPress(e.latlng));
  attachLongPress(el, (touch) => map.mouseEventToLatLng(touch), longPress);

  function popup(latlng, content, className = 'oh-popup', overheardId = null) {
    current = L.popup({
      className,
      maxWidth: 330,
      minWidth: 250,
      offset: [0, -4],
      autoPanPaddingTopLeft: [16, 176],
      autoPanPaddingBottomRight: [16, 110],
    }).setLatLng(latlng).setContent(content).openOn(map);
    current.overheardId = overheardId;
    return current;
  }

  return {
    provider: 'leaflet',

    setCity(city) {
      map.setView([city.lat, city.lng], city.zoom, { animate: false });
    },

    render(next) {
      data = next;
      redraw();
    },

    // Sözü büyük bir konuşma balonu olarak açar; gerekirse önce yakınlaşır.
    openOverheard(o, content) {
      const show = () => popup([o.lat, o.lng], content, 'oh-popup', o.id);
      if (map.getZoom() < DETAIL_ZOOM || !map.getBounds().contains([o.lat, o.lng])) {
        map.once('moveend', show);
        map.flyTo([o.lat, o.lng], Math.max(map.getZoom(), 16), { duration: 0.6 });
      } else {
        show();
      }
    },

    openAt(latlng, content) {
      popup(latlng, content, 'oh-popup oh-popup-small');
    },

    // Açık büyük balondaki sözün kimliği (yoksa null).
    openId() {
      return current && map.hasLayer(current) ? current.overheardId : null;
    },

    // Açık balonu yeni içerikle (ör. kilit açılınca) aynı yerde yeniden açar; boyut değişse de
    // ekrana sığacak şekilde yeniden kaydırılır.
    updateOpen(content) {
      if (current && map.hasLayer(current)) popup(current.getLatLng(), content, current.options.className, current.overheardId);
    },

    // Açık balonun içeriğini yeniden açmadan değiştirir (ör. tepki sayısı).
    replaceOpen(content) {
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
        me = L.marker(latlng, { icon: divIcon(meElement(), 'oh-me-marker'), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
        meAccuracy = L.circle(latlng, { radius: pos.accuracy || 0, interactive: false, className: 'oh-me-accuracy' }).addTo(map);
      } else {
        me.setLatLng(latlng);
        meAccuracy.setLatLng(latlng).setRadius(pos.accuracy || 0);
      }
      me.getElement()?.classList.toggle('is-demo', Boolean(pos.simulated));
    },
  };
}
