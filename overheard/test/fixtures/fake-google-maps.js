// Testler için Google Maps JS API'nin küçük bir taklidi. Gerçek API ağ ve anahtar ister;
// bu taklit yalnızca Overheard'ün kullandığı yüzeyi (Map, OverlayView, InfoWindow, Circle,
// event) Web Mercator hesabıyla canlandırır, böylece Google uyarlayıcısı gerçek tarayıcıda sınanır.
(() => {
  const TILE = 256;
  const listeners = new WeakMap();
  const on = (target, name, fn) => {
    if (!listeners.has(target)) listeners.set(target, {});
    const all = listeners.get(target);
    (all[name] ||= []).push(fn);
    return { remove: () => { all[name] = all[name].filter((f) => f !== fn); } };
  };
  const emit = (target, name, arg) => {
    for (const fn of [...(listeners.get(target)?.[name] || [])]) fn(arg);
  };

  class LatLng {
    constructor(lat, lng) {
      if (typeof lat === 'object') ({ lat, lng } = lat);
      this._lat = lat;
      this._lng = lng;
    }
    lat() { return this._lat; }
    lng() { return this._lng; }
  }
  const toLatLng = (v) => (v instanceof LatLng ? v : new LatLng(v.lat, v.lng));

  class LatLngBounds {
    constructor(sw, ne) { this.sw = sw; this.ne = ne; }
    getSouthWest() { return this.sw; }
    getNorthEast() { return this.ne; }
    contains(p) {
      const q = toLatLng(p);
      return q.lat() >= this.sw.lat() && q.lat() <= this.ne.lat() && q.lng() >= this.sw.lng() && q.lng() <= this.ne.lng();
    }
  }

  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  class Size { constructor(w, h) { this.width = w; this.height = h; } }

  const world = (zoom) => TILE * 2 ** zoom;
  const project = (latLng, zoom) => {
    const s = Math.sin((latLng.lat() * Math.PI) / 180);
    return {
      x: ((latLng.lng() + 180) / 360) * world(zoom),
      y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world(zoom),
    };
  };
  const unproject = (x, y, zoom) => {
    const n = Math.PI - (2 * Math.PI * y) / world(zoom);
    return new LatLng((180 / Math.PI) * Math.atan(Math.sinh(n)), (x / world(zoom)) * 360 - 180);
  };

  class Map {
    constructor(el, opts = {}) {
      this.el = el;
      this.root = document.createElement('div');
      this.root.className = 'gm-style';
      Object.assign(this.root.style, { position: 'absolute', inset: '0', overflow: 'hidden' });
      this.pane = document.createElement('div');
      Object.assign(this.pane.style, { position: 'absolute', left: '0', top: '0' });
      this.root.append(this.pane);
      el.append(this.root);
      this.center = toLatLng(opts.center || { lat: 0, lng: 0 });
      this.zoom = opts.zoom ?? 3;
      this.overlays = new Set();
      this.idleTimer = null;
      this.root.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const r = this.el.getBoundingClientRect();
        emit(this, 'contextmenu', { latLng: this.fromContainer(e.clientX - r.left, e.clientY - r.top) });
      });
      this.changed();
    }
    size() { return { w: this.el.clientWidth || 390, h: this.el.clientHeight || 844 }; }
    origin() {
      const c = project(this.center, this.zoom);
      const { w, h } = this.size();
      return { x: c.x - w / 2, y: c.y - h / 2 };
    }
    toContainer(latLng) {
      const p = project(toLatLng(latLng), this.zoom);
      const o = this.origin();
      return new Point(p.x - o.x, p.y - o.y);
    }
    fromContainer(x, y) {
      const o = this.origin();
      return unproject(o.x + x, o.y + y, this.zoom);
    }
    changed() {
      for (const ov of this.overlays) ov.draw();
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => emit(this, 'idle'), 30);
    }
    getBounds() {
      const { w, h } = this.size();
      const nw = this.fromContainer(0, 0);
      const se = this.fromContainer(w, h);
      return new LatLngBounds(new LatLng(se.lat(), nw.lng()), new LatLng(nw.lat(), se.lng()));
    }
    getZoom() { return this.zoom; }
    setZoom(z) { this.zoom = z; this.changed(); }
    setCenter(c) { this.center = toLatLng(c); this.changed(); }
    panTo(c) { this.setCenter(c); }
    setOptions() {}
    addListener(name, fn) { return on(this, name, fn); }
  }

  class OverlayView {
    setMap(map) {
      if (this.map) {
        this.map.overlays.delete(this);
        this.onRemove();
      }
      this.map = map;
      if (!map) return;
      map.overlays.add(this);
      this.onAdd();
      this.draw();
    }
    getMap() { return this.map; }
    getPanes() { return { overlayMouseTarget: this.map.pane, floatPane: this.map.pane }; }
    getProjection() {
      const map = this.map;
      if (!map) return null;
      return {
        fromLatLngToDivPixel: (ll) => map.toContainer(ll),
        fromLatLngToContainerPixel: (ll) => map.toContainer(ll),
        fromContainerPixelToLatLng: (p) => map.fromContainer(p.x, p.y),
      };
    }
    static preventMapHitsAndGesturesFrom() {}
  }

  class Circle {
    constructor(opts) { this.opts = opts; this.setMap(opts.map); }
    setMap(map) { this.map = map; }
    setCenter(c) { this.opts.center = c; }
    setRadius(r) { this.opts.radius = r; }
  }

  class Polyline {
    constructor(opts) { this.opts = opts; this.setMap(opts.map); }
    setMap(map) { this.map = map; }
  }

  class InfoWindow {
    constructor(opts = {}) {
      this.opts = opts;
      this.box = document.createElement('div');
      this.box.className = 'gm-style-iw-c';
      Object.assign(this.box.style, { position: 'absolute', left: '16px', right: '16px', top: '140px', zIndex: '50' });
      this.body = document.createElement('div');
      this.body.className = 'gm-style-iw-d';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'gm-ui-hover-effect';
      close.setAttribute('aria-label', 'Close');
      close.textContent = '×';
      close.addEventListener('click', () => {
        this.close();
        emit(this, 'closeclick');
      });
      this.box.append(close, this.body);
    }
    setContent(node) { this.body.replaceChildren(node); }
    setPosition(p) { this.position = p; }
    open({ map }) { this.map = map; map.root.append(this.box); }
    close() { this.box.remove(); emit(this, 'close'); }
    addListener(name, fn) { return on(this, name, fn); }
  }

  window.google = {
    maps: {
      Map,
      OverlayView,
      Circle,
      Polyline,
      InfoWindow,
      LatLng,
      LatLngBounds,
      Point,
      Size,
      ControlPosition: { RIGHT_BOTTOM: 9 },
      event: {
        addListenerOnce(target, name, fn) {
          const handle = on(target, name, (arg) => { handle.remove(); fn(arg); });
          return handle;
        },
      },
    },
  };

  const callback = new URL(document.currentScript.src).searchParams.get('callback');
  if (callback && typeof window[callback] === 'function') setTimeout(() => window[callback](), 0);
})();
