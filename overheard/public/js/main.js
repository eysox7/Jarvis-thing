import { api } from './api.js';
import { t, errorText } from './i18n.js';
import { h, clear, distanceM, truncate, displayName } from './util.js';
import { createMap, DETAIL_ZOOM } from './map.js';
import { toast, closeSheet, sheetKey } from './ui.js';
import { bubbleContent } from './views/bubble.js';
import { openAuth } from './views/auth.js';
import { openCompose } from './views/compose.js';
import { openPlaces } from './views/places.js';
import { openInbox, openConversation, openNewMessage, handleIncoming } from './views/inbox.js';
import { openProfile } from './views/profile.js';
import { createNudge } from './views/nudge.js';
import { maybeShowIntro } from './views/intro.js';
import { openRoom, handleRoomMessage, closeRoomIfLeft } from './views/room.js';
import { shareOverheard } from './share.js';
import { openBest } from './views/best.js';

const CITY_KEY = 'oh_city';
const HINT_KEY = 'oh_demo_hint_seen';
// Keşif modunda yeni check-in için en az bu kadar yürümek ya da beklemek gerekir.
const EXPLORE_MIN_MOVE_M = 40;
const EXPLORE_MIN_WAIT_MS = 3 * 60 * 1000;

const state = {
  config: null,
  user: null,
  stats: null,
  unread: 0,
  city: null,
  data: null,
  position: null,
  exploring: false,
};

let map;
let nudge;
let events = null;
let watchId = null;
let lastCheckIn = null;

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* yok say */ }
  },
};

function setPosition(pos) {
  state.position = { ...pos, at: Date.now() };
  map.showMe(state.position);
  nudge.update();
}

function locateOnce() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      toast(t('toast.locationDenied'), { tone: 'error' });
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPosition({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
        resolve(state.position);
      },
      () => {
        toast(t('toast.locationDenied'), { tone: 'error' });
        resolve(null);
      },
      // "Konumum" taze konum ister: önbellekteki eski konum, ayrıldığın mekânı açık tutmasın.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

// Yakın bakışta görünür alanın sözlerini ayrıca çeker: yoğun mekânlarda şehir listesinin
// sınırına takılmadan tüm balonlar görünsün.
const MAX_BOX_SPAN_DEG = 0.5;
const MAX_CACHED_OVERHEARDS = 1500;
let viewTimer = null;
let lastBox = null;
let lastView = null;
// Her şehir verisi yenilemesinde artar: yenilemeden önce başlamış bir alan isteği (ör. kilit
// açılmadan önceki kilitli hâller) geç dönerse taze veriyi ezmesin.
let dataGeneration = 0;

function onViewChange(view) {
  lastView = view;
  clearTimeout(viewTimer);
  const { zoom, bbox } = view;
  if (zoom < DETAIL_ZOOM || !state.data) return;
  const [w, s, e, n] = bbox;
  if (e - w > MAX_BOX_SPAN_DEG || n - s > MAX_BOX_SPAN_DEG) return;
  viewTimer = setTimeout(async () => {
    const key = bbox.map((v) => v.toFixed(3)).join(',');
    if (key === lastBox) return;
    lastBox = key;
    const generation = dataGeneration;
    try {
      const { overheards } = await api.overheardsInBox(bbox);
      if (generation === dataGeneration) mergeOverheards(overheards);
    } catch {
      lastBox = null;
    }
  }, 250);
}

function mergeOverheards(incoming) {
  if (!state.data || !incoming.length) return;
  const byId = new Map(state.data.overheards.map((o) => [o.id, o]));
  for (const o of incoming) byId.set(o.id, o);
  state.data.overheards = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_CACHED_OVERHEARDS);
  map.render(state.data);
}

function replaceOverheard(updated) {
  if (!state.data) return;
  const i = state.data.overheards.findIndex((o) => o.id === updated.id);
  if (i >= 0) state.data.overheards[i] = updated;
  map.render(state.data);
}

const app = {
  state,

  openAuth: (then) => openAuth(app, then),

  async setUser(user) {
    state.user = user;
    await refreshMe();
    connectEvents();
    await app.refresh();
    renderChrome();
  },

  async logout() {
    await api.logout().catch(() => {});
    state.user = null;
    state.stats = null;
    state.unread = 0;
    stopExplore();
    connectEvents();
    closeSheet();
    await app.refresh();
    renderChrome();
  },

  async refresh() {
    try {
      const data = await api.cityMap(state.city.id);
      dataGeneration += 1;
      state.data = data;
      lastBox = null;
      map.render(state.data);
      // Yakın bakıştaysak görünür alanın sözlerini de tazele.
      if (lastView) onViewChange(lastView);
      nudge.update();
      renderRoomButton();
      const openId = map.openId();
      const open = openId && state.data.overheards.find((o) => o.id === openId);
      if (open) map.updateOpen(bubbleContent(open, app));
    } catch (err) {
      toast(errorText(err), { tone: 'error' });
    }
  },

  async selectCity(id, { keepView = false } = {}) {
    const city = state.config.cities.find((c) => c.id === id) || state.config.cities[0];
    state.city = city;
    storage.set(CITY_KEY, city.id);
    map.closePopup();
    if (!keepView) map.setCity(city);
    renderCities();
    await app.refresh();
  },

  async goToPlace(p) {
    if (p.cityId !== state.city.id) await app.selectCity(p.cityId, { keepView: true });
    map.flyTo(p.lat, p.lng, 16);
  },

  openOverheard(o) {
    map.openOverheard(o, bubbleContent(o, app));
  },

  async react(o, kind) {
    if (!state.user) return app.openAuth();
    try {
      const { overheard, newBadges } = await api.react(o.id, kind);
      app.celebrate(newBadges);
      replaceOverheard(overheard);
      if (map.openId() === overheard.id) map.replaceOpen(bubbleContent(overheard, app));
      else app.openOverheard(overheard);
    } catch (err) {
      toast(errorText(err), { tone: 'error' });
    }
  },

  startMessage: (o, to) => openNewMessage(app, o, to),

  compose: () => openCompose(app),

  async share(o) {
    const city = state.config.cities.find((c) => c.id === o.cityId);
    const result = await shareOverheard(o, city?.name);
    if (result === 'downloaded') toast(t('share.downloaded'), { tone: 'success' });
  },

  async reportOverheard(o) {
    if (!state.user) return app.openAuth();
    if (!window.confirm(t('bubble.confirmReport'))) return;
    try {
      await api.report(o.id, 'inappropriate');
      toast(t('toast.reported'));
    } catch (err) {
      toast(errorText(err), { tone: 'error' });
    }
  },

  async blockAuthor(o) {
    if (!state.user) return app.openAuth();
    if (!window.confirm(t('bubble.confirmBlock', { handle: displayName(o.author) }))) return;
    try {
      await api.blockAuthor(o.id);
      map.closePopup();
      toast(t('toast.blocked'));
      await app.refresh();
    } catch (err) {
      toast(errorText(err), { tone: 'error' });
    }
  },

  async deleteOverheard(o) {
    if (!window.confirm(t('bubble.confirmDelete'))) return;
    try {
      await api.remove(o.id);
      map.closePopup();
      toast(t('toast.deleted'));
      await app.refresh();
    } catch (err) {
      toast(errorText(err), { tone: 'error' });
    }
  },

  // Taze bir konum döndürür: demo konumu ya da son bir dakikadaki gerçek konum, yoksa yenisini ister.
  async currentPosition() {
    const pos = state.position;
    if (pos && (pos.simulated || Date.now() - pos.at < 60000)) return pos;
    return locateOnce();
  },

  // qrCode verilirse giriş mekânın QR kodu iledir: kapalı alanda kaba konum yeter.
  async checkIn(pos, { silent = false, qrCode = null } = {}) {
    if (!state.user) {
      app.openAuth(() => app.checkIn(pos, { silent, qrCode }));
      return { places: [], city: null };
    }
    const coords = { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy };
    const result = qrCode ? await api.qrCheckIn(qrCode, coords) : await api.checkIn(coords);
    lastCheckIn = { lat: pos.lat, lng: pos.lng, at: Date.now() };
    if (result.blocked) {
      warnLocation(result.blocked);
      return result;
    }
    // Yerel sözler yalnızca oradayken okunur: vardığın mekânların sözleri açılır, ayrıldıklarınınki kilitlenir.
    const arrived = result.places.filter((p) => p.arrived);
    const left = (result.left || []).map((id) => state.data?.places.find((p) => p.id === id)).filter(Boolean);
    if (result.city && result.city !== state.city.id) await app.selectCity(result.city, { keepView: true });
    else if (arrived.length || left.length) await app.refresh();
    for (const p of arrived) {
      toast(t(p.qr ? 'qr.arrived' : p.line ? 'toast.boarded' : 'toast.arrived', { place: p.name }), { tone: 'success', timeout: 6000, action: t('room.enter'), onAction: () => openRoom(app, p) });
    }
    closeRoomIfLeft(left);
    for (const p of left) if (p.localCount) toast(t('toast.left', { place: p.name }));
    app.celebrate(result.newBadges);
    if (!silent && !arrived.length) {
      if (result.places.length) toast(t('toast.checkedIn', { places: result.places.map((p) => p.name).join(', ') }));
      else toast(result.city ? t('toast.noPlacesHere') : t('toast.outsidePilot'));
    }
    if (result.places.some((p) => p.firstVisit)) refreshMe();
    return result;
  },

  // Demo: seçilen noktaya "ışınlanıp" orada check-in yapar.
  async teleport(latlng, reopenId) {
    if (!state.user) return app.openAuth(() => app.teleport(latlng, reopenId));
    map.closePopup();
    setPosition({ lat: latlng.lat, lng: latlng.lng, accuracy: 10, simulated: true });
    try {
      await app.checkIn(state.position);
    } catch (err) {
      toast(errorText(err), { tone: 'error' });
      return;
    }
    const reopened = reopenId && state.data?.overheards.find((o) => o.id === reopenId);
    if (reopened) app.openOverheard(reopened);
  },

  async refreshUnread() {
    await refreshMe();
    renderBadge();
  },

  relabel: () => renderChrome(),

  // Sunucu yeni rozet bildirdiyse kutla.
  celebrate(newBadges = []) {
    for (const id of newBadges) toast(t('toast.badge', { name: t(`badge.${id}`) }), { tone: 'success', timeout: 6000 });
  },
};

// Konum uyarıları (belirsiz konum, imkânsız seyahat...) keşif modunda her adımda tekrarlanmasın.
const lastWarning = new Map();
function warnLocation(reason) {
  if (Date.now() - (lastWarning.get(reason) || 0) < 5 * 60000) return;
  lastWarning.set(reason, Date.now());
  toast(t(`location.${reason}`), { tone: 'error', timeout: 7000 });
}

// Yalnızca en son başlatılan /api/me yanıtı uygulanır: girişten önce başlamış eski bir istek
// geç dönerse yeni oturumu ezmesin.
let meSeq = 0;
async function refreshMe() {
  const seq = ++meSeq;
  try {
    const me = await api.me();
    if (seq !== meSeq) return;
    state.user = me.user;
    state.stats = me.stats || null;
    state.unread = me.unread || 0;
  } catch {
    // Çevrimdışıysak eldeki durumla devam.
  }
}

function connectEvents() {
  events?.close();
  events = null;
  if (!state.user) return;
  events = new EventSource('/api/events');
  events.addEventListener('reveal', (e) => {
    const data = JSON.parse(e.data);
    toast(t('toast.revealed', { handle: `@${data.handle}` }));
    if (sheetKey() === `chat:${data.conversationId}`) openConversation(app, data.conversationId);
  });
  events.addEventListener('room', (e) => handleRoomMessage(app, JSON.parse(e.data)));
  events.addEventListener('dm', async (e) => {
    const data = JSON.parse(e.data);
    if (await handleIncoming(app, data)) return;
    state.unread += 1;
    renderBadge();
    toast(t('toast.message', { from: displayName(data.from), body: truncate(data.body, 60) }), {
      action: t('nav.inbox'),
      onAction: () => openConversation(app, data.conversationId),
      timeout: 7000,
    });
  });
}

// --- Keşif modu: yürüdükçe otomatik check-in ---
function stopExplore() {
  state.exploring = false;
  if (watchId == null) return;
  navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function toggleExplore() {
  if (watchId != null) {
    stopExplore();
    toast(t('map.exploreOff'));
    renderChrome();
    return;
  }
  if (!state.user) return app.openAuth(toggleExplore);
  if (!('geolocation' in navigator)) return toast(t('toast.locationDenied'), { tone: 'error' });
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      setPosition({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      const moved = !lastCheckIn
        || distanceM(lastCheckIn.lat, lastCheckIn.lng, state.position.lat, state.position.lng) > EXPLORE_MIN_MOVE_M
        || Date.now() - lastCheckIn.at > EXPLORE_MIN_WAIT_MS;
      if (moved) app.checkIn(state.position, { silent: true }).catch(() => {});
    },
    (err) => {
      // Yalnızca izin reddi keşfi bitirir; zaman aşımı ya da geçici konum hatasında (tünel, kapalı
      // alan) izleme sürer ve konum gelince kaldığı yerden devam eder.
      if (err.code === err.PERMISSION_DENIED) {
        toast(t('toast.locationDenied'), { tone: 'error' });
        stopExplore();
        renderChrome();
      } else {
        warnLocation('signal_lost');
      }
    },
    { enableHighAccuracy: true, maximumAge: 0 },
  );
  state.exploring = true;
  toast(t('map.exploreOn'), { tone: 'success' });
  renderChrome();
}

// --- Mekân QR kodu: /?qr=mekân.imza ---
// Kod adres çubuğundan hemen silinir: yenilemede ya da paylaşılan ekran görüntüsünde kalmasın.
function takeQrCode() {
  const params = new URLSearchParams(location.search);
  const code = params.get('qr');
  if (!code) return null;
  params.delete('qr');
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  return code;
}

// Kapalı alanda GPS beklenmez: Wi-Fi/baz istasyonu konumu yeter.
function coarsePosition() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  });
}

async function qrCheckIn(code) {
  if (!state.user) return app.openAuth(() => qrCheckIn(code));
  const locating = toast(t('qr.locating'), { timeout: 15000 });
  const pos = await coarsePosition();
  locating();
  if (!pos) return toast(t('qr.needLocation'), { tone: 'error', timeout: 8000 });
  setPosition(pos);
  try {
    const result = await app.checkIn(pos, { qrCode: code });
    const venue = result.places?.find((p) => p.qr);
    if (venue) map.flyTo(venue.lat, venue.lng, 17);
  } catch (err) {
    toast(errorText(err), { tone: 'error', timeout: 8000 });
  }
  return null;
}

async function locateAndCheckIn() {
  const pos = await locateOnce();
  if (!pos) return;
  map.flyTo(pos.lat, pos.lng, 16);
  try {
    await app.checkIn(pos);
  } catch (err) {
    toast(errorText(err), { tone: 'error' });
  }
}

function onLongPress(latlng) {
  if (!state.config.demoMode) return;
  const button = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => app.teleport(latlng) }, `✨ ${t('map.teleport')}`);
  map.openAt(latlng, h('div', { class: 'teleport' }, button));
}

// --- Arayüz iskeleti ---
function renderCities() {
  const nav = document.getElementById('cities');
  const best = h('button', { class: 'city-chip best-chip', type: 'button', title: t('best.open'), 'aria-label': t('best.open'), onclick: () => openBest(app) }, '🏆');
  clear(nav).append(best, ...state.config.cities.map((c) => h('button', {
    class: `city-chip${c.id === state.city.id ? ' is-active' : ''}`,
    type: 'button',
    'aria-pressed': c.id === state.city.id ? 'true' : 'false',
    onclick: () => app.selectCity(c.id),
  }, c.name)));
  nav.querySelector('.is-active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

// Bir mekândaysan haritada mekân odası düğmesi görünür (yanında oradaki kişi sayısı).
function hereNow() {
  return state.user ? (state.data?.places || []).filter((p) => p.here) : [];
}

function renderRoomButton() {
  const button = document.getElementById('btn-room');
  const here = hereNow()[0];
  button.hidden = !here;
  const count = button.querySelector('.tool-count');
  count.hidden = !here?.peopleHere;
  count.textContent = here?.peopleHere ? String(here.peopleHere) : '';
}

function renderBadge() {
  const badge = document.querySelector('[data-nav="inbox"] .badge');
  badge.hidden = !state.unread;
  badge.textContent = state.unread > 9 ? '9+' : String(state.unread);
}

function renderChrome() {
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-label]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nLabel));
    el.title = t(el.dataset.i18nLabel);
  }
  document.getElementById('btn-explore').classList.toggle('is-on', watchId != null);
  document.getElementById('btn-explore').setAttribute('aria-pressed', watchId != null ? 'true' : 'false');
  renderCities();
  renderBadge();
}

function showDemoHint() {
  if (!state.config.demoMode || storage.get(HINT_KEY)) return;
  const hint = document.getElementById('demo-hint');
  clear(hint).append(
    h('span', {}, `✨ ${t('map.demoHint')}`),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('common.close'), onclick: () => { hint.hidden = true; storage.set(HINT_KEY, '1'); } }, '✕'));
  hint.hidden = false;
}

function bindNav() {
  const actions = {
    map: () => closeSheet(),
    places: () => openPlaces(app),
    post: () => openCompose(app),
    inbox: () => openInbox(app),
    profile: () => openProfile(app),
  };
  for (const button of document.querySelectorAll('[data-nav]')) {
    button.addEventListener('click', () => actions[button.dataset.nav]());
  }
  document.getElementById('btn-locate').addEventListener('click', locateAndCheckIn);
  document.getElementById('btn-explore').addEventListener('click', toggleExplore);
  document.getElementById('btn-room').addEventListener('click', () => {
    const here = hereNow()[0];
    if (here) openRoom(app, here);
  });
}

// Konum izni daha önce verildiyse açılışta sessizce konum alıp check-in yap: uygulamayı açmak,
// bulunduğun mekânın kilidini açmaya yetsin.
async function autoLocate() {
  if (!state.user || !navigator.permissions?.query || !('geolocation' in navigator)) return;
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    if (status.state !== 'granted') return;
  } catch {
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (p) => {
      setPosition({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      app.checkIn(state.position, { silent: true }).catch(() => {});
    },
    () => {},
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

// Bir mekândaysan açık ekran konumu ara ara sessizce tazeler: içeride oturan kişi "orada olma"
// süresi (30 dk) dolunca düşmesin. Kapalı alandaki belirsiz konum da yeter (sunucu girişi hatırlar).
async function heartbeat() {
  if (!hereNow().length || watchId != null || state.position?.simulated || !('geolocation' in navigator)) return;
  try {
    if ((await navigator.permissions?.query({ name: 'geolocation' }))?.state !== 'granted') return;
  } catch {
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (p) => {
      setPosition({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      app.checkIn(state.position, { silent: true }).catch(() => {});
    },
    () => {},
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

async function boot() {
  const [config, me] = await Promise.all([api.config(), api.me().catch(() => ({ user: null }))]);
  state.config = config;
  state.user = me.user;
  state.stats = me.stats || null;
  state.unread = me.unread || 0;
  document.documentElement.lang = document.documentElement.lang || 'tr';

  const saved = storage.get(CITY_KEY);
  state.city = config.cities.find((c) => c.id === saved) || config.cities[0];

  map = await createMap(document.getElementById('map'), {
    onBubbleClick: (o) => app.openOverheard(o),
    onPlaceClick: (p) => map.flyTo(p.lat, p.lng, 16),
    onLongPress,
    onViewChange,
    onProviderFallback: () => toast(t('toast.mapFallback')),
  }, config);
  map.setCity(state.city);
  nudge = createNudge(app);

  bindNav();
  renderChrome();
  const qrCode = takeQrCode();
  if (!qrCode) maybeShowIntro(app);
  showDemoHint();
  connectEvents();
  await app.refresh();
  document.body.classList.add('is-ready');
  if (qrCode) qrCheckIn(qrCode);
  else autoLocate();
  // "Orada olma" süresi dolunca yerel sözler sunucuda kilitlenir; açık ekran da bunu yakalasın.
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    heartbeat();
    app.refresh();
  }, 5 * 60000);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

boot().catch((err) => {
  console.error(err);
  toast(errorText(err), { tone: 'error', timeout: 10000 });
});

// Testlerin ve hata ayıklamanın uygulama durumuna erişebilmesi için.
window.overheard = {
  app,
  get openBubbleId() { return map?.openId() ?? null; },
  get mapProvider() { return map?.provider ?? null; },
};
