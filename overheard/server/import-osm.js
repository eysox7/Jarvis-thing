// OpenStreetMap'ten mekân ve hat aktarımı.
//
//   npm run import:osm -- --city istanbul --district Sultanbeyli --district Sancaktepe
//   npm run import:osm -- --city istanbul --all-districts
//   npm run import:osm -- --city istanbul --lines --bus-ref 34,34A,34AS,34BZ,34C,34G,34Z
//   npm run import:osm -- --city istanbul --from-file overpass.json --lines   (ağsız ortam)
//
// --dry-run veritabanına yazmaz, yalnızca ne ekleneceğini listeler. Vekil arkasında Node'un fetch'i
// için NODE_USE_ENV_PROXY=1 gerekir.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { CITY_BY_ID } from './data/cities.js';
import { cityAt } from './domain.js';
import { DISTRICTS, importLines, importPlaces, linesQuery, overpass, parseLines, parsePlaces, placesQuery } from './osm.js';

const PROVINCES = { istanbul: 'İstanbul', ankara: 'Ankara', izmir: 'İzmir' };

const { values } = parseArgs({
  options: {
    city: { type: 'string', default: 'istanbul' },
    province: { type: 'string' },
    district: { type: 'string', multiple: true, default: [] },
    'all-districts': { type: 'boolean', default: false },
    lines: { type: 'boolean', default: false },
    'bus-ref': { type: 'string', default: '' },
    'from-file': { type: 'string' },
    endpoint: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const cityId = values.city;
if (!CITY_BY_ID.has(cityId)) throw new Error(`bilinmeyen şehir: ${cityId}`);
const province = values.province || PROVINCES[cityId];
const districts = values['all-districts'] ? DISTRICTS[cityId] || [] : values.district;
const busRefs = values['bus-ref'].split(',').map((s) => s.trim()).filter(Boolean);
const options = values.endpoint ? { endpoint: values.endpoint } : {};

// Pilot bölgenin dışındakiler (şehir yarıçapı) alınmaz.
const inCity = (p) => cityAt(p.lat, p.lng)?.id === cityId;

const config = loadConfig();
const db = values['dry-run'] ? null : openDb(config.dbPath);
const report = (label, items) => {
  console.log(`\n${label}: ${items.length}`);
  for (const p of items.slice(0, 60)) console.log(`  ${p.kind.padEnd(8)} ${p.name}${p.stops ? ` (${p.stops.length} durak)` : ''}`);
  if (items.length > 60) console.log(`  … ve ${items.length - 60} tane daha`);
};

try {
  if (values['from-file']) {
    const json = JSON.parse(await readFile(values['from-file'], 'utf8'));
    const places = parsePlaces(json, { cityId }).filter(inCity);
    const lines = values.lines ? parseLines(json, { cityId }).filter(inCity) : [];
    report('Mekânlar', places);
    report('Hatlar', lines);
    if (db) console.log(importPlaces(db, places), importLines(db, lines));
  } else {
    if (!province) throw new Error('--province gerekli');
    for (const district of districts) {
      const places = parsePlaces(await overpass(placesQuery(province, district), options), { cityId }).filter(inCity);
      report(`${district} mekânları`, places);
      if (db) console.log(importPlaces(db, places));
    }
    if (values.lines) {
      const lines = parseLines(await overpass(linesQuery(province, { busRefs }), options), { cityId }).filter(inCity);
      report('Hatlar', lines);
      if (db) console.log(importLines(db, lines));
    }
    if (!districts.length && !values.lines) console.log('Ne aktarılacağını söyle: --district, --all-districts ya da --lines');
  }
} finally {
  db?.close();
}
