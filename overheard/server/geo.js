const EARTH_RADIUS_M = 6371008.8;
const rad = (deg) => (deg * Math.PI) / 180;

export function distanceM(aLat, aLng, bLat, bLng) {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Noktanın çevresinde, metre cinsinden yarıçaplı kaba bir kutu (SQL ön filtresi için).
export function boundingBox(lat, lng, radiusM) {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.max(0.01, Math.cos(rad(lat))));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

export function isValidCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

// Kimliğe bağlı, kararlı bir sözde rastgele sayı (0..1). Aynı söz her seferinde
// mekânın aynı köşesinde görünsün diye kullanılır.
function hashUnit(text, salt) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// Sözü, yazanın gerçek konumunu açık etmeden mekân dairesinin içine yerleştirir.
export function scatterInPlace(id, place) {
  const angle = hashUnit(id, 1) * 2 * Math.PI;
  const dist = Math.sqrt(hashUnit(id, 2)) * place.radius_m * 0.65;
  const lat = place.lat + (dist * Math.cos(angle)) / 111320;
  const lng = place.lng + (dist * Math.sin(angle)) / (111320 * Math.cos(rad(place.lat)));
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}
