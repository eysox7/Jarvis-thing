// Overheard Kafe. Müşteri girişte garsona "overheard istiyorum" der, garson masayı açar; sistem
// rastgele bir söz seçip masa numarasıyla kafenin yazıcısına gönderir, garson fişi masaya götürür.
// Masa açık kaldıkça belli aralıklarla yeni fişler basılır.
// İki mod:
// - inside: bu kafede yazılan sözler. Yazanı ele vermemek için en az inside_delay_min dakika eski
//   sözler, rastgele masalara gider. Herkesin birbirini tanıdığı semtlerde kafe bu süreyi uzatabilir.
// - nearby: yakın mekânların herkese açık sözleri; "kafe içini yazmak müşteriyi rahatsız eder"
//   diyen işletmeler için. Başka mekânların yerel sözleri basılmaz ("yalnızca orada okunur").
import { cascadeDelete } from './db.js';
import { HttpError } from './http.js';
import { boundingBox, distanceM } from './geo.js';
import { cleanText } from './domain.js';

export const VENUE_MODES = ['inside', 'nearby'];
const RANGES = { everyMin: [5, 120], perTable: [1, 20], nearbyM: [200, 3000], insideDelayMin: [10, 240] };
const TABLE_NO_MAX = 12;

const clampInt = (value, [min, max], fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const VENUE_SELECT = `
  SELECT v.*, p.name, p.city_id, p.lat, p.lng FROM venues v JOIN places p ON p.id = v.place_id`;

function serializeVenue(v) {
  return {
    placeId: v.place_id, name: v.name, cityId: v.city_id, mode: v.mode, nearbyM: v.nearby_m, everyMin: v.every_min, perTable: v.per_table, insideDelayMin: v.inside_delay_min,
  };
}

// --- Yönetim (moderatör) ---

export function listVenues(db) {
  const staff = db.prepare('SELECT u.handle FROM venue_staff s JOIN users u ON u.id = s.user_id WHERE s.place_id = ? ORDER BY u.handle');
  return db.prepare(`${VENUE_SELECT} ORDER BY p.name`).all()
    .map((v) => ({ ...serializeVenue(v), staff: staff.all(v.place_id).map((r) => r.handle) }));
}

function readSettings(body, current = {}) {
  return {
    mode: VENUE_MODES.includes(body.mode) ? body.mode : current.mode ?? 'inside',
    nearbyM: clampInt(body.nearbyM ?? current.nearby_m, RANGES.nearbyM, 1500),
    everyMin: clampInt(body.everyMin ?? current.every_min, RANGES.everyMin, 15),
    perTable: clampInt(body.perTable ?? current.per_table, RANGES.perTable, 4),
    insideDelayMin: clampInt(body.insideDelayMin ?? current.inside_delay_min, RANGES.insideDelayMin, 20),
  };
}

// Bir mekânı Overheard Kafe yapar ya da ayarlarını günceller.
export function saveVenue(db, placeId, body = {}) {
  const place = db.prepare('SELECT kind FROM places WHERE id = ?').get(placeId);
  if (!place) throw new HttpError(404, 'place_not_found');
  if (place.kind === 'line') throw new HttpError(400, 'line_not_venue');
  const current = db.prepare('SELECT * FROM venues WHERE place_id = ?').get(placeId);
  const s = readSettings(body, current);
  db.prepare(`INSERT INTO venues (place_id, mode, nearby_m, every_min, per_table, inside_delay_min, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(place_id) DO UPDATE SET mode = excluded.mode, nearby_m = excluded.nearby_m,
                every_min = excluded.every_min, per_table = excluded.per_table, inside_delay_min = excluded.inside_delay_min`)
    .run(placeId, s.mode, s.nearbyM, s.everyMin, s.perTable, s.insideDelayMin, Date.now());
  return serializeVenue(db.prepare(`${VENUE_SELECT} WHERE v.place_id = ?`).get(placeId));
}

export function removeVenue(db, placeId) {
  if (!cascadeDelete(db, 'venues', 'place_id = ?', [placeId])) throw new HttpError(404, 'venue_not_found');
}

export function addStaff(db, placeId, handle) {
  if (!db.prepare('SELECT 1 FROM venues WHERE place_id = ?').get(placeId)) throw new HttpError(404, 'venue_not_found');
  const user = db.prepare('SELECT id FROM users WHERE handle = ? AND is_guest = 0').get(String(handle || '').trim());
  if (!user) throw new HttpError(404, 'user_not_found');
  db.prepare('INSERT OR IGNORE INTO venue_staff (place_id, user_id) VALUES (?, ?)').run(placeId, user.id);
}

export function removeStaff(db, placeId, handle) {
  db.prepare('DELETE FROM venue_staff WHERE place_id = ? AND user_id = (SELECT id FROM users WHERE handle = ?)').run(placeId, handle);
}

// --- Personel ---

export function staffVenues(db, userId) {
  return db.prepare(`${VENUE_SELECT} JOIN venue_staff s ON s.place_id = v.place_id WHERE s.user_id = ? ORDER BY p.name`)
    .all(userId).map(serializeVenue);
}

export const staffIds = (db, placeId) => db.prepare('SELECT user_id FROM venue_staff WHERE place_id = ?').all(placeId).map((r) => r.user_id);

// Kafeyi döndürür; yalnızca o kafenin personeli (ya da moderatör) erişebilir.
export function requireVenue(db, user, placeId, { admin = false } = {}) {
  const venue = db.prepare(`${VENUE_SELECT} WHERE v.place_id = ?`).get(String(placeId));
  if (!venue) throw new HttpError(404, 'venue_not_found');
  if (!admin && !db.prepare('SELECT 1 FROM venue_staff WHERE place_id = ? AND user_id = ?').get(venue.place_id, user.id)) {
    throw new HttpError(403, 'staff_only');
  }
  return venue;
}

// Kafe sahibi modu ve basım sıklığını kendisi seçer.
export function updateSettings(db, venue, body) {
  return saveVenue(db, venue.place_id, readSettings(body, venue));
}

// --- Söz seçimi ---

// Fişe basılmaya uygun sözler: gizlenmemiş, şikâyet almamış, süresi dolmamış, yazarı yasaklı değil.
const PRINTABLE = `
  o.hidden = 0 AND (o.expires_at IS NULL OR o.expires_at > :now)
  AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.overheard_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id AND u.banned_at IS NOT NULL)`;

function nearbyPlaceIds(db, venue, radiusM) {
  const box = boundingBox(venue.lat, venue.lng, radiusM);
  return db.prepare('SELECT id, lat, lng FROM places WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? AND id != ?')
    .all(box.minLat, box.maxLat, box.minLng, box.maxLng, venue.place_id)
    .filter((p) => distanceM(venue.lat, venue.lng, p.lat, p.lng) <= radiusM)
    .map((p) => p.id);
}

// Yakında söz yoksa arama genişler: turistik olmayan, sakin semtlerdeki (Sultanbeyli, Sancaktepe…)
// bir kafede de müşteri boş dönmesin. Fişte sözün nerede ve ne kadar uzakta duyulduğu yazar.
const FALLBACK_RADII_M = [5000, 15000];

// Sırayla denenecek kaynaklar. Kafe içi modda önce kafenin kendi sözleri; henüz yoksa yakın çevre.
// Başka mekânlardan yalnızca herkese açık sözler gelir.
function tiers(db, config, venue, now) {
  const radii = [venue.nearby_m, ...FALLBACK_RADII_M.filter((r) => r > venue.nearby_m)];
  return [
    ...(venue.mode === 'inside' ? [{ sql: 'o.place_id = :place AND o.created_at <= :cutoff', params: { cutoff: now - venue.inside_delay_min * 60000 } }] : []),
    ...radii.map((r) => nearbyPlaceIds(db, venue, r)).filter((ids) => ids.length).map((ids) => ({
      sql: `o.place_id IN (${ids.map((_, i) => `:p${i}`).join(',')}) AND o.visibility = 'public'`,
      params: Object.fromEntries(ids.map((id, i) => [`p${i}`, id])),
    })),
    // Son çare: şehrin geneli.
    { sql: "o.place_id IN (SELECT id FROM places WHERE city_id = :city AND id != :place) AND o.visibility = 'public'", params: { city: venue.city_id } },
  ];
}

const PICK_SQL = (tierSql) => `
  SELECT o.id FROM overheards o
  WHERE ${tierSql} AND ${PRINTABLE}
    AND NOT EXISTS (SELECT 1 FROM print_jobs j WHERE j.table_id = :table AND j.overheard_id = o.id)
  ORDER BY (SELECT COUNT(*) FROM print_jobs j WHERE j.place_id = :place AND j.overheard_id = o.id AND j.created_at > :dayAgo), random()
  LIMIT 1`;

// Masaya daha önce basılmamış bir söz seçer: en yakın kaynaktan, kafede bugün en az basılanlar
// arasından rastgele.
function pickOverheard(db, config, venue, tableId, now) {
  const common = { place: venue.place_id, table: tableId, now, dayAgo: now - 86400000 };
  for (const tier of tiers(db, config, venue, now)) {
    const row = db.prepare(PICK_SQL(tier.sql)).get({ ...common, ...tier.params });
    if (row) return row.id;
  }
  return null;
}

function queueJob(db, config, venue, tableId, now) {
  const overheardId = pickOverheard(db, config, venue, tableId, now);
  if (!overheardId) return null;
  const { lastInsertRowid } = db.prepare('INSERT INTO print_jobs (table_id, place_id, overheard_id, created_at) VALUES (?, ?, ?, ?)')
    .run(tableId, venue.place_id, overheardId, now);
  return Number(lastInsertRowid);
}

// --- Masalar ---

export function venueState(db, config, venue, now = Date.now()) {
  const tables = db.prepare(`
    SELECT t.id, t.table_no, t.opened_at,
           (SELECT COUNT(*) FROM print_jobs j WHERE j.table_id = t.id) AS jobs,
           (SELECT COUNT(*) FROM print_jobs j WHERE j.table_id = t.id AND j.printed_at IS NULL) AS pending
    FROM venue_tables t WHERE t.place_id = ? AND t.closed_at IS NULL ORDER BY t.opened_at`).all(venue.place_id)
    .map((t) => ({ id: t.id, tableNo: t.table_no, openedAt: t.opened_at, printed: t.jobs - t.pending, pending: t.pending }));
  return { venue: serializeVenue(venue), tables, available: countAvailable(db, config, venue, now) };
}

// Basılabilecek söz sayısı (genişleyen arama dahil: kafenin kendi sözleri + şehrin herkese açık sözleri).
function countAvailable(db, config, venue, now) {
  const own = venue.mode === 'inside'
    ? db.prepare(`SELECT COUNT(*) AS n FROM overheards o WHERE o.place_id = ? AND o.created_at <= ? AND ${PRINTABLE.replaceAll(':now', '?')}`)
      .get(venue.place_id, now - venue.inside_delay_min * 60000, now).n
    : 0;
  const city = db.prepare(`SELECT COUNT(*) AS n FROM overheards o JOIN places p ON p.id = o.place_id
    WHERE p.city_id = ? AND o.place_id != ? AND o.visibility = 'public' AND ${PRINTABLE.replaceAll(':now', '?')}`)
    .get(venue.city_id, venue.place_id, now).n;
  return own + city;
}

// Masa açılır ve ilk fiş hemen yazıcıya gönderilir (söz varsa).
export function openTable(db, config, venue, rawNo, now = Date.now()) {
  const tableNo = cleanText(String(rawNo ?? '')).slice(0, TABLE_NO_MAX);
  if (!tableNo) throw new HttpError(400, 'bad_table');
  if (db.prepare('SELECT 1 FROM venue_tables WHERE place_id = ? AND table_no = ? AND closed_at IS NULL').get(venue.place_id, tableNo)) {
    throw new HttpError(409, 'table_open', { tableNo });
  }
  const { lastInsertRowid } = db.prepare('INSERT INTO venue_tables (place_id, table_no, opened_at) VALUES (?, ?, ?)').run(venue.place_id, tableNo, now);
  const tableId = Number(lastInsertRowid);
  return { tableId, tableNo, queued: queueJob(db, config, venue, tableId, now) != null };
}

function openTableRow(db, venue, tableId) {
  const table = db.prepare('SELECT * FROM venue_tables WHERE id = ? AND place_id = ? AND closed_at IS NULL').get(Number(tableId), venue.place_id);
  if (!table) throw new HttpError(404, 'table_not_found');
  return table;
}

export function closeTable(db, venue, tableId, now = Date.now()) {
  const table = openTableRow(db, venue, tableId);
  db.prepare('UPDATE venue_tables SET closed_at = ? WHERE id = ?').run(now, table.id);
  // Henüz basılmamış fişler iptal: müşteri kalktı.
  db.prepare('DELETE FROM print_jobs WHERE table_id = ? AND printed_at IS NULL').run(table.id);
}

// Garsonun isteğiyle masaya bir fiş daha.
export function printAnother(db, config, venue, tableId, now = Date.now()) {
  const table = openTableRow(db, venue, tableId);
  if (queueJob(db, config, venue, table.id, now) == null) throw new HttpError(409, 'no_content');
}

// Açık masalara sıradaki fişleri ekler, unutulan masaları kapatır. { placeId → yeni fiş sayısı }
export function tickVenues(db, config, now = Date.now()) {
  db.prepare('UPDATE venue_tables SET closed_at = ? WHERE closed_at IS NULL AND opened_at < ?').run(now, now - config.venueTableMaxMs);
  const queued = new Map();
  const tables = db.prepare(`
    SELECT t.id, t.place_id,
           (SELECT COUNT(*) FROM print_jobs j WHERE j.table_id = t.id) AS jobs,
           (SELECT MAX(created_at) FROM print_jobs j WHERE j.table_id = t.id) AS last_at
    FROM venue_tables t WHERE t.closed_at IS NULL`).all();
  const venues = new Map();
  for (const t of tables) {
    if (!venues.has(t.place_id)) venues.set(t.place_id, db.prepare(`${VENUE_SELECT} WHERE v.place_id = ?`).get(t.place_id));
    const venue = venues.get(t.place_id);
    if (t.jobs >= venue.per_table) continue;
    if (t.last_at != null && now - t.last_at < venue.every_min * 60000) continue;
    if (queueJob(db, config, venue, t.id, now) != null) queued.set(t.place_id, (queued.get(t.place_id) || 0) + 1);
  }
  return queued;
}

// --- Yazıcı ---

// Basılmayı bekleyen fişler. Yazarın adı hiç yer almaz; kafe içi sözlerin saati yazıcı ekranında
// yalnızca kabaca ("bu öğleden sonra") gösterilir.
export function pendingJobs(db, venue) {
  return db.prepare(`
    SELECT j.id, j.created_at AS queued_at, t.table_no, o.text, o.created_at, o.place_id, p.name AS place_name, p.lat, p.lng
    FROM print_jobs j
    JOIN venue_tables t ON t.id = j.table_id
    JOIN overheards o ON o.id = j.overheard_id
    JOIN places p ON p.id = o.place_id
    WHERE j.place_id = ? AND j.printed_at IS NULL
    ORDER BY j.id LIMIT 20`).all(venue.place_id)
    .map((j) => ({
      id: j.id,
      tableNo: j.table_no,
      text: j.text,
      heardAt: j.created_at,
      inside: j.place_id === venue.place_id,
      placeName: j.place_name,
      distanceM: j.place_id === venue.place_id ? 0 : Math.round(distanceM(venue.lat, venue.lng, j.lat, j.lng) / 50) * 50,
      queuedAt: j.queued_at,
    }));
}

export function markPrinted(db, venue, jobId, now = Date.now()) {
  db.prepare('UPDATE print_jobs SET printed_at = ? WHERE id = ? AND place_id = ? AND printed_at IS NULL').run(now, Number(jobId), venue.place_id);
}

export const cafePlaceIds = (db) => new Set(db.prepare('SELECT place_id FROM venues').all().map((r) => r.place_id));
