/* global google */
import { DETAIL_ZOOM, planMarkers, meElement, attachLongPress, debounceLongPress, prefersDark, cssVar } from './common.js';

const LOAD_TIMEOUT_MS = 12000;
const CALLBACK = '__ohGoogleMapsReady';

// Google Maps JS API'yi yükler. Anahtar geçersizse Google sonradan gm_authFailure'ı çağırır;
// bu durumda onAuthFailure ile Leaflet'e geri dönülür.
export function loadGoogleMaps(key, language, onAuthFailure) {
  window.gm_authFailure = () => onAuthFailure?.();
  if (window.google?.maps?.Map) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('google_maps_timeout')), LOAD_TIMEOUT_MS);
    window[CALLBACK] = () => {
      clearTimeout(timer);
      delete window[CALLBACK];
      resolve();
    };
    const script = document.createElement('script');
    const params = new URLSearchParams({ key, v: 'weekly', language, callback: CALLBACK, loading: 'async' });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('google_maps_load_failed'));
    };
    document.head.append(script);
  });
}

// Karmaşayı azalt: işletme/durak ikonları balonlarla yarışmasın.
const QUIET = [
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];
const DARK = [
  { elementType: 'geometry', stylers: [{ color: '#1f1c25' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a59eb0' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#15131a' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2d2935' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a1820' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#101b29' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1d2a22' }] },
  ...QUIET,
];

export function createGoogleMap(el, handlers) {
  const { maps } = google;
  const dark = prefersDark();
  const map = new maps.Map(el, {
    center: { lat: 0, lng: 0 },
    zoom: 3,
    minZoom: 3,
    disableDefaultUI: true,
    zoomControl: true,
    zoomControlOptions: { position: maps.ControlPosition.RIGHT_BOTTOM },
    gestureHandling: 'greedy',
    clickableIcons: false,
    styles: dark.matches ? DARK : QUIET,
    backgroundColor: cssVar('--paper-2'),
  });
  dark.addEventListener('change', () => map.setOptions({ styles: dark.matches ? DARK : QUIET }));

  // Konuşma balonlarını Google haritasına DOM öğesi olarak yerleştirir.
  class HtmlMarker extends maps.OverlayView {
    constructor(position, element, { className, zIndex = 0, onClick, title } = {}) {
      super();
      this.position = new maps.LatLng(position.lat, position.lng);
      this.div = document.createElement('div');
      this.div.className = className;
      this.div.style.position = 'absolute';
      this.div.style.zIndex = String(zIndex);
      this.div.append(element);
      if (onClick) {
        this.div.tabIndex = 0;
        this.div.setAttribute('role', 'button');
        if (title) this.div.title = title;
        this.div.addEventListener('click', (e) => {
          e.stopPropagation();
          onClick();
        });
        this.div.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        });
      }
    }

    onAdd() {
      this.getPanes().overlayMouseTarget.append(this.div);
    }

    draw() {
      const point = this.getProjection()?.fromLatLngToDivPixel(this.position);
      if (!point) return;
      this.div.style.left = `${point.x}px`;
      this.div.style.top = `${point.y}px`;
    }

    onRemove() {
      this.div.remove();
    }

    setPosition(position) {
      this.position = new maps.LatLng(position.lat, position.lng);
      this.draw();
    }
  }

  // Ekran pikselini koordinata çevirmek için boş bir katman (uzun basma için).
  const projector = new (class extends maps.OverlayView {
    onAdd() {}
    draw() {}
    onRemove() {}
  })();
  projector.setMap(map);

  let data = null;
  let drawn = [];
  let me = null;
  let meAccuracy = null;
  const info = new maps.InfoWindow({ maxWidth: 330, pixelOffset: new maps.Size(0, -6) });
  let openState = null; // { id, position, small }
  info.addListener('closeclick', () => { openState = null; });

  function redraw() {
    for (const item of drawn) item.setMap(null);
    drawn = [];
    const bounds = map.getBounds();
    if (!data || !bounds) return;
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const padLat = (ne.lat() - sw.lat()) * 0.6;
    const padLng = (ne.lng() - sw.lng()) * 0.6;
    const projection = projector.getProjection();
    const plan = planMarkers(data, {
      zoom: map.getZoom(),
      project: (lat, lng) => projection?.fromLatLngToContainerPixel(new maps.LatLng(lat, lng)) || { x: 0, y: 0 },
      contains: (lat, lng) => lat <= ne.lat() + padLat && lat >= sw.lat() - padLat && lng <= ne.lng() + padLng && lng >= sw.lng() - padLng,
    });
    const open = cssVar('--open');
    const locked = cssVar('--locked');
    for (const m of plan) {
      if (m.type === 'area') {
        const color = m.item.visited ? open : locked;
        drawn.push(new maps.Circle({
          map,
          center: { lat: m.lat, lng: m.lng },
          radius: m.item.radius,
          clickable: false,
          strokeColor: color,
          strokeOpacity: 0.8,
          strokeWeight: 1.5,
          fillColor: color,
          fillOpacity: 0.07,
        }));
        continue;
      }
      const onClick = m.type === 'place' ? () => handlers.onPlaceClick(m.item) : () => handlers.onBubbleClick(m.item);
      const marker = new HtmlMarker(m, m.element, { className: 'oh-marker oh-gmarker', zIndex: m.full ? 100 : 1, onClick, title: m.title });
      marker.setMap(map);
      drawn.push(marker);
    }
  }

  map.addListener('idle', () => {
    redraw();
    const bounds = map.getBounds();
    if (!bounds) return;
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    handlers.onViewChange?.({ zoom: map.getZoom(), bbox: [sw.lng(), sw.lat(), ne.lng(), ne.lat()] });
  });

  const longPress = debounceLongPress(handlers.onLongPress);
  map.addListener('contextmenu', (e) => longPress({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
  attachLongPress(el, (touch) => {
    const rect = el.getBoundingClientRect();
    const latLng = projector.getProjection().fromContainerPixelToLatLng(new maps.Point(touch.clientX - rect.left, touch.clientY - rect.top));
    return { lat: latLng.lat(), lng: latLng.lng() };
  }, longPress);

  function showInfo(position, content, { id = null, small = false } = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = small ? 'oh-iw oh-iw-small' : 'oh-iw';
    wrapper.append(content);
    info.setContent(wrapper);
    info.setPosition(position);
    info.open({ map, shouldFocus: false });
    openState = { id, position, small };
  }

  const inView = (lat, lng) => map.getBounds()?.contains(new maps.LatLng(lat, lng));

  return {
    provider: 'google',

    setCity(city) {
      map.setCenter({ lat: city.lat, lng: city.lng });
      map.setZoom(city.zoom);
    },

    render(next) {
      data = next;
      redraw();
    },

    openOverheard(o, content) {
      const position = { lat: o.lat, lng: o.lng };
      const show = () => showInfo(position, content, { id: o.id });
      if (map.getZoom() < DETAIL_ZOOM || !inView(o.lat, o.lng)) {
        maps.event.addListenerOnce(map, 'idle', show);
        map.setZoom(Math.max(map.getZoom(), 16));
        map.panTo(position);
      } else {
        show();
      }
    },

    openAt(latlng, content) {
      showInfo({ lat: latlng.lat, lng: latlng.lng }, content, { small: true });
    },

    openId() {
      return openState?.id ?? null;
    },

    updateOpen(content) {
      if (openState) showInfo(openState.position, content, openState);
    },

    replaceOpen(content) {
      if (!openState) return;
      const wrapper = document.createElement('div');
      wrapper.className = openState.small ? 'oh-iw oh-iw-small' : 'oh-iw';
      wrapper.append(content);
      info.setContent(wrapper);
    },

    closePopup() {
      info.close();
      openState = null;
    },

    flyTo(lat, lng, zoom = 16) {
      map.setZoom(zoom);
      map.panTo({ lat, lng });
    },

    showMe(pos) {
      if (!me) {
        me = new HtmlMarker(pos, meElement(), { className: 'oh-me-marker', zIndex: 1000 });
        me.setMap(map);
        meAccuracy = new maps.Circle({
          map,
          center: { lat: pos.lat, lng: pos.lng },
          radius: pos.accuracy || 0,
          clickable: false,
          strokeColor: '#2f80ff',
          strokeWeight: 1,
          fillColor: '#2f80ff',
          fillOpacity: 0.08,
        });
      } else {
        me.setPosition(pos);
        meAccuracy.setCenter({ lat: pos.lat, lng: pos.lng });
        meAccuracy.setRadius(pos.accuracy || 0);
      }
      me.div.classList.toggle('is-demo', Boolean(pos.simulated));
    },
  };
}
