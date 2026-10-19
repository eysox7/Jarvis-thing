import { api } from './api.js';
import { t, errorText } from './i18n.js';
import { h, clear, distanceM, truncate } from './util.js';
import { createMap } from './map.js';
import { toast, closeSheet } from './ui.js';
import { bubbleContent } from './views/bubble.js';
import { openAuth } from './views/auth.js';
import { openCompose } from './views/compose.js';
import { openPlaces } from './views/places.js';
import { openInbox, openConversation, openNewMessage, handleIncoming } from './views/inbox.js';
import { openProfile } from './views/profile.js';

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
};

let map;
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
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
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
      state.data = await api.cityMap(state.city.id);
      map.render(state.data);
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
      const { overheard } = await api.react(o.id, kind);
      replaceOverheard(overheard);
      if (map.openId() === overheard.id) map.replaceOpen(bubbleContent(overheard, app));
      else app.openOverheard(overheard);
    } catch (err) {
      toast(errorText(err), { tone: 'error' });
    }
  },

  startMessage: (o, to) => openNewMessage(app, o, to),

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
    if (!window.confirm(t('bubble.confirmBlock', { handle: o.author }))) return;
    try {
      await api.block(o.author);
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

  async checkIn(pos, { silent = false } = {}) {
    if (!state.user) {
      app.openAuth(() => app.checkIn(pos, { silent }));
      return { places: [], city: null };
    }
    const result = await api.checkIn({ lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy });
    lastCheckIn = { lat: pos.lat, lng: pos.lng, at: Date.now() };
    const unlocked = result.places.filter((p) => p.newlyUnlocked);
    if (result.city && result.city !== state.city.id) await app.selectCity(result.city, { keepView: true });
    else if (unlocked.length) await app.refresh();
    for (const p of unlocked) toast(t('toast.unlocked', { place: p.name }), { tone: 'success', timeout: 6000 });
    if (!silent && !unlocked.length) {
      if (result.places.length) toast(t('toast.checkedIn', { places: result.places.map((p) => p.name).join(', ') }));
      else toast(result.city ? t('toast.noPlacesHere') : t('toast.outsidePilot'));
    }
    if (unlocked.length) refreshMe();
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
};

async function refreshMe() {
  try {
    const me = await api.me();
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
  events.addEventListener('dm', async (e) => {
    const data = JSON.parse(e.data);
    if (await handleIncoming(app, data)) return;
    state.unread += 1;
    renderBadge();
    toast(t('toast.message', { from: data.from, body: truncate(data.body, 60) }), {
      action: t('nav.inbox'),
      onAction: () => openConversation(app, data.conversationId),
      timeout: 7000,
    });
  });
}

// --- Keşif modu: yürüdükçe otomatik check-in ---
function stopExplore() {
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
    () => {
      toast(t('toast.locationDenied'), { tone: 'error' });
      stopExplore();
      renderChrome();
    },
    { enableHighAccuracy: true, maximumAge: 10000 },
  );
  toast(t('map.exploreOn'), { tone: 'success' });
  renderChrome();
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
  clear(nav).append(...state.config.cities.map((c) => h('button', {
    class: `city-chip${c.id === state.city.id ? ' is-active' : ''}`,
    type: 'button',
    'aria-pressed': c.id === state.city.id ? 'true' : 'false',
    onclick: () => app.selectCity(c.id),
  }, c.name)));
  nav.querySelector('.is-active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
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
    onProviderFallback: () => toast(t('toast.mapFallback')),
  }, config);
  map.setCity(state.city);

  bindNav();
  renderChrome();
  showDemoHint();
  connectEvents();
  await app.refresh();
  document.body.classList.add('is-ready');

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
