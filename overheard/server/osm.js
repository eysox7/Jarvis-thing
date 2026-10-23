// OpenStreetMap'ten gündelik buluşma noktalarını ve toplu taşıma hatlarını aktarır. Turistik
// olmayan semtlerde (Sultanbeyli, Sancaktepe, Sultangazi…) Overheard'ün doğal yeri insanların
// birlikte beklediği, geçtiği yerlerdir: istasyonlar, otogar ve iskeleler, semt pazarı, AVM, meydan,
// park, halı saha, kampüs. Bilerek alınmayanlar (hassas): okullar (18 yaş altı), hastane ve
// klinikler (sağlık), ibadethaneler (inanç), karakol ve cezaevi.
// Veri © OpenStreetMap katkıcıları, ODbL (https://www.openstreetmap.org/copyright).
import { transaction } from './db.js';
import { distanceM } from './geo.js';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// İstanbul'un 39 ilçesi (--all-districts).
export const DISTRICTS = {
  istanbul: ['Adalar', 'Arnavutköy', 'Ataşehir', 'Avcılar', 'Bağcılar', 'Bahçelievler', 'Bakırköy', 'Başakşehir',
    'Bayrampaşa', 'Beşiktaş', 'Beykoz', 'Beylikdüzü', 'Beyoğlu', 'Büyükçekmece', 'Çatalca', 'Çekmeköy', 'Esenler',
    'Esenyurt', 'Eyüpsultan', 'Fatih', 'Gaziosmanpaşa', 'Güngören', 'Kadıköy', 'Kağıthane', 'Kartal', 'Küçükçekmece',
    'Maltepe', 'Pendik', 'Sancaktepe', 'Sarıyer', 'Silivri', 'Sultanbeyli', 'Sultangazi', 'Şile', 'Şişli', 'Tuzla',
    'Ümraniye', 'Üsküdar', 'Zeytinburnu'],
};

// İlk eşleşen kural mekânın türünü ve "orada sayılma" yarıçapını (metre) belirler. Alanı olan
// mekânlarda (park, AVM, kampüs) yarıçap gerçek büyüklüğe göre ayarlanır.
const PLACE_RULES = [
  { match: (t) => t.railway === 'station' || t.public_transport === 'station', kind: 'station', r: 150 },
  { match: (t) => t.amenity === 'bus_station', kind: 'station', r: 150 },
  { match: (t) => t.amenity === 'ferry_terminal', kind: 'pier', r: 150 },
  { match: (t) => t.amenity === 'marketplace', kind: 'market', r: 150, sized: true },
  { match: (t) => t.shop === 'mall', kind: 'mall', r: 150, sized: true },
  { match: (t) => t.place === 'square', kind: 'square', r: 120, sized: true },
  { match: (t) => t.leisure === 'park', kind: 'park', r: 150, sized: true },
  { match: (t) => t.leisure === 'pitch' && /soccer/.test(t.sport || ''), kind: 'pitch', r: 80 },
  { match: (t) => t.amenity === 'university' || t.amenity === 'college', kind: 'campus', r: 250, sized: true },
];

const SENSITIVE = (t) => ['school', 'kindergarten', 'childcare', 'hospital', 'clinic', 'doctors', 'place_of_worship', 'prison', 'police'].includes(t.amenity)
  || ['school', 'kindergarten', 'hospital', 'mosque', 'church', 'synagogue'].includes(t.building)
  || Boolean(t.healthcare);

const RAIL_ROUTES = ['subway', 'light_rail', 'train', 'tram', 'monorail', 'funicular'];

// Overpass sorgularına girecek adlar: tırnak ve ters bölü kabul edilmez.
function safeName(name) {
  const value = String(name || '').trim();
  if (!value || /["\\]/.test(value)) throw new Error(`geçersiz ad: ${name}`);
  return value;
}

export function placesQuery(province, district) {
  return `[out:json][timeout:120];
area["boundary"="administrative"]["admin_level"="4"]["name"="${safeName(province)}"]->.p;
rel(area.p)["boundary"="administrative"]["admin_level"="6"]["name"="${safeName(district)}"];
map_to_area->.d;
(
  nwr(area.d)["railway"="station"]["name"];
  nwr(area.d)["public_transport"="station"]["name"];
  nwr(area.d)["amenity"~"^(bus_station|ferry_terminal|marketplace|university|college)$"]["name"];
  nwr(area.d)["shop"="mall"]["name"];
  nwr(area.d)["place"="square"]["name"];
  nwr(area.d)["leisure"="park"]["name"];
  nwr(area.d)["leisure"="pitch"]["sport"~"soccer"]["name"];
);
out tags center bb;`;
}

// Raylı sistem hatları (metro, Marmaray/banliyö, tramvay, füniküler) ve isteğe bağlı otobüs hatları
// (ör. metrobüs hatları --bus-ref ile).
export function linesQuery(province, { busRefs = [] } = {}) {
  const bus = busRefs.length
    ? `\n  rel(area.p)["type"="route"]["route"="bus"]["ref"~"^(${busRefs.map((r) => safeName(r).replace(/[^\w-]/g, '')).join('|')})$"];`
    : '';
  return `[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="4"]["name"="${safeName(province)}"]->.p;
(
  rel(area.p)["type"="route"]["route"~"^(${RAIL_ROUTES.join('|')})$"];${bus}
);
out body;
node(r);
out body qt;`;
}

const fold = (s) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const slug = (s) => fold(s).replace(/ /g, '-').slice(0, 40);
const nameOf = (tags) => String(tags['name:tr'] || tags.name || '').trim().slice(0, 60);
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// Overpass yanıtındaki gündelik buluşma noktaları → mekân satırları.
export function parsePlaces(json, { cityId }) {
  const out = [];
  for (const el of json.elements || []) {
    const tags = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const name = nameOf(tags);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || name.length < 2 || SENSITIVE(tags)) continue;
    const rule = PLACE_RULES.find((r) => r.match(tags));
    if (!rule) continue;
    let radius = rule.r;
    if (rule.sized && el.bounds) {
      const half = distanceM(el.bounds.minlat, el.bounds.minlon, el.bounds.maxlat, el.bounds.maxlon) / 2;
      radius = clamp(Math.round(half), 80, 400);
    }
    // Aynı yerin birden çok kaydı (istasyonun düğümü ve alanı gibi) tek mekân olur.
    if (out.some((p) => fold(p.name) === fold(name) && distanceM(p.lat, p.lng, lat, lng) < 300)) continue;
    out.push({ id: `${cityId}-osm-${el.type[0]}${el.id}`, city_id: cityId, name, kind: rule.kind, lat, lng, radius_m: radius, origin: 'osm' });
  }
  return out;
}

// Overpass yanıtındaki güzergâh ilişkileri → hatlar (duraklar sırayla). Her hattın iki yönü ayrı
// ilişkidir; en çok duraklı olan alınır.
export function parseLines(json, { cityId }) {
  const nodes = new Map();
  for (const el of json.elements || []) if (el.type === 'node') nodes.set(el.id, el);
  const best = new Map();
  for (const rel of (json.elements || []).filter((e) => e.type === 'relation' && e.tags?.route)) {
    const tags = rel.tags;
    const ref = String(tags.ref || tags.name || '').trim();
    if (!ref) continue;
    const pick = (test) => (rel.members || []).filter((m) => m.type === 'node' && test(m.role || '')).map((m) => nodes.get(m.ref)).filter(Boolean);
    let points = pick((role) => role.startsWith('stop'));
    if (points.length < 2) points = pick((role) => role.startsWith('platform'));
    // Aynı durağın iki peronu gibi art arda gelen yakın tekrarlar ayıklanır.
    const stops = [];
    for (const n of points) {
      const name = nameOf(n.tags || {}) || null;
      const prev = stops.at(-1);
      if (prev && distanceM(prev.lat, prev.lng, n.lat, n.lon) < 120) continue;
      stops.push({ name, lat: n.lat, lng: n.lon });
    }
    if (stops.length < 2) continue;
    const key = `${tags.route}:${ref}`;
    if ((best.get(key)?.stops.length ?? 0) >= stops.length) continue;
    const from = tags.from || stops[0].name;
    const to = tags.to || stops.at(-1).name;
    const name = (tags.ref && from && to ? `${tags.ref} ${from}–${to}` : nameOf(tags) || ref).slice(0, 60);
    const color = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(tags.colour || '') ? tags.colour : null;
    const middle = stops[Math.floor(stops.length / 2)];
    best.set(key, {
      id: `${cityId}-line-${tags.route}-${slug(ref)}`,
      city_id: cityId,
      name,
      kind: 'line',
      lat: middle.lat,
      lng: middle.lng,
      radius_m: 0,
      color,
      origin: 'osm',
      stops,
    });
  }
  return [...best.values()];
}

// Mekânları ekler. Var olan bir mekânla neredeyse aynı yerdekiler (minGapM) atlanır: "Kadıköy
// İskelesi" ikinci kez açılmasın. Tekrar çalıştırmak güvenlidir.
export function importPlaces(db, places, { minGapM = 60, now = Date.now() } = {}) {
  const near = db.prepare("SELECT lat, lng FROM places WHERE kind != 'line' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?");
  const insert = db.prepare(`INSERT OR IGNORE INTO places (id, city_id, name, kind, lat, lng, radius_m, created_at, origin)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let added = 0;
  let skipped = 0;
  transaction(db, () => {
    for (const p of places) {
      const d = 0.001;
      if (near.all(p.lat - d, p.lat + d, p.lng - d, p.lng + d).some((q) => distanceM(q.lat, q.lng, p.lat, p.lng) < minGapM)) {
        skipped += 1;
        continue;
      }
      if (insert.run(p.id, p.city_id, p.name, p.kind, p.lat, p.lng, p.radius_m, now, p.origin || 'osm').changes) added += 1;
      else skipped += 1;
    }
  });
  return { added, skipped };
}

// Hatları ekler ya da günceller (duraklar baştan yazılır).
export function importLines(db, lines, { now = Date.now() } = {}) {
  const upsert = db.prepare(`INSERT INTO places (id, city_id, name, kind, lat, lng, radius_m, created_at, origin, color)
                             VALUES (?, ?, ?, 'line', ?, ?, 0, ?, ?, ?)
                             ON CONFLICT(id) DO UPDATE SET name = excluded.name, lat = excluded.lat, lng = excluded.lng, color = excluded.color`);
  const clear = db.prepare('DELETE FROM line_stops WHERE place_id = ?');
  const stop = db.prepare('INSERT INTO line_stops (place_id, seq, name, lat, lng) VALUES (?, ?, ?, ?, ?)');
  let stops = 0;
  transaction(db, () => {
    for (const l of lines) {
      upsert.run(l.id, l.city_id, l.name, l.lat, l.lng, now, l.origin || 'osm', l.color ?? null);
      clear.run(l.id);
      l.stops.forEach((s, i) => stop.run(l.id, i, s.name ?? null, s.lat, s.lng));
      stops += l.stops.length;
    }
  });
  return { lines: lines.length, stops };
}

export async function overpass(query, { endpoint = OVERPASS_URL, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'overheard-import/1.0' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
