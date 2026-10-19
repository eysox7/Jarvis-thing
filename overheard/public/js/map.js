// Harita cephesi: Google Maps anahtarı varsa Google Maps, yoksa (ya da yüklenemezse) Leaflet/OSM.
// Uygulamanın geri kalanı yalnızca bu dosyanın döndürdüğü arayüzü görür.
import { getLang } from './i18n.js';
import { createLeafletMap } from './maps/leaflet.js';
import { createGoogleMap, loadGoogleMaps } from './maps/google.js';

export { DETAIL_ZOOM } from './maps/common.js';

export async function createMap(el, handlers, { googleMapsKey } = {}) {
  let adapter = null;
  // Sağlayıcı değişirse (Google başarısız olursa) yeni haritaya aynı durumu yeniden uygulamak için.
  const last = { city: null, data: null, me: null };

  function useLeaflet() {
    el.replaceChildren();
    el.removeAttribute('style');
    adapter = createLeafletMap(el, handlers);
    if (last.city) adapter.setCity(last.city);
    if (last.data) adapter.render(last.data);
    if (last.me) adapter.showMe(last.me);
  }

  const fallBack = () => {
    if (adapter?.provider === 'leaflet') return;
    useLeaflet();
    handlers.onProviderFallback?.();
  };

  if (googleMapsKey) {
    try {
      await loadGoogleMaps(googleMapsKey, getLang(), fallBack);
      adapter = createGoogleMap(el, handlers);
    } catch {
      fallBack();
    }
  } else {
    useLeaflet();
  }

  return {
    get provider() { return adapter.provider; },
    setCity(city) { last.city = city; adapter.setCity(city); },
    render(data) { last.data = data; adapter.render(data); },
    showMe(pos) { last.me = pos; adapter.showMe(pos); },
    openOverheard: (o, content) => adapter.openOverheard(o, content),
    openAt: (latlng, content) => adapter.openAt(latlng, content),
    openId: () => adapter.openId(),
    updateOpen: (content) => adapter.updateOpen(content),
    replaceOpen: (content) => adapter.replaceOpen(content),
    closePopup: () => adapter.closePopup(),
    flyTo: (lat, lng, zoom) => adapter.flyTo(lat, lng, zoom),
  };
}
