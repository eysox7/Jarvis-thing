// Overheard'ün kuralları burada yaşar. En önemlisi görünürlük kuralı:
// - Yerel söz (varsayılan): yalnızca o mekânda ŞU AN bulunan kişi okuyabilir. Bir kez gidip
//   okumak kalıcı erişim vermez; oradan ayrılınca söz yeniden kilitlenir.
// - Herkese açık söz: herkes, her yerden okuyabilir.
// Söz bırakmak için her iki durumda da o mekânda olmak gerekir.
import { transaction } from './db.js';
import { newId } from './auth.js';
import { HttpError } from './http.js';
import { boundingBox, distanceM, isValidCoord, scatterInPlace } from './geo.js';
import { CITIES, CITY_BY_ID } from './data/cities.js';
import { moderatePublicText, moderatePrivateText } from './moderation.js';

export const REACTIONS = ['lol', 'wow', 'same', 'heart'];
export const LIMITS = { textMin: 3, textMax: 280, placeNameMin: 2, placeNameMax: 60, messageMax: 1000, roomMessageMax: 500 };

// Kontrol karakterlerini atar, boşlukları sadeleştirir.
export function cleanText(value, { multiline = false } = {}) {
  if (typeof value !== 'string') return '';
  let text = value.normalize('NFC').replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u2028-\u202E]/g, '');
  text = multiline
    ? text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
    : text.replace(/\s+/g, ' ');
  return text.trim();
}

export function readCoords(body) {
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!isValidCoord(lat, lng)) throw new HttpError(400, 'bad_coords');
  const accuracy = Number.isFinite(Number(body.accuracy)) ? Math.max(0, Number(body.accuracy)) : 0;
  return { lat, lng, accuracy };
}

export function cityAt(lat, lng) {
  let best = null;
  for (const city of CITIES) {
    const d = distanceM(lat, lng, city.lat, city.lng);
    if (d <= city.radiusKm * 1000 && (!best || d < best.d)) best = { city, d };
  }
  return best?.city || null;
}

// Noktayı içine alan mekânlar, en yakından uzağa.
export function placesContaining(db, config, { lat, lng, accuracy }) {
  const bonus = Math.min(accuracy || 0, config.maxAccuracyBonusM);
  const box = boundingBox(lat, lng, 1000);
  const rows = db.prepare(`
    SELECT * FROM places WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`)
    .all(box.minLat, box.maxLat, box.minLng, box.maxLng);
  return rows
    .map((p) => ({ ...p, distance: distanceM(lat, lng, p.lat, p.lng) }))
    .filter((p) => p.distance <= p.radius_m + bonus)
    .sort((a, b) => a.distance - b.distance);
}

export const VISIBILITIES = ['local', 'public'];

// Kullanıcının şu an bulunduğu mekânlar: son bildirilen konum taze (presenceTtlMs) ve mekânın
// içindeyse, ve kullanıcı orada check-in yapabilmişse (saatlik açma sınırına takılmamışsa).
export function currentPlaceIds(db, config, userId, now = Date.now()) {
  if (!userId) return new Set();
  const last = db.prepare('SELECT lat, lng, accuracy, at FROM location_reports WHERE user_id = ?').get(userId);
  if (!last || now - last.at > config.presenceTtlMs) return new Set();
  const checked = db.prepare('SELECT 1 FROM checkins WHERE user_id = ? AND place_id = ? LIMIT 1');
  return new Set(placesContaining(db, config, last).filter((p) => checked.get(userId, p.id)).map((p) => p.id));
}

// Mekânlarda şu an bulunan kişi sayıları (isimsiz): konum bildirimi taze olanlar mekân dairesine göre sayılır.
export function presenceCounts(db, config, places, now = Date.now()) {
  const counts = new Map();
  if (!places.length) return counts;
  const lats = places.map((p) => p.lat);
  const lngs = places.map((p) => p.lng);
  const pad = 0.02;
  const reports = db.prepare(`
    SELECT lat, lng, accuracy FROM location_reports
    WHERE at > ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`)
    .all(now - config.presenceTtlMs, Math.min(...lats) - pad, Math.max(...lats) + pad, Math.min(...lngs) - pad, Math.max(...lngs) + pad);
  for (const r of reports) {
    const bonus = Math.min(r.accuracy || 0, config.maxAccuracyBonusM);
    for (const p of places) {
      if (distanceM(r.lat, r.lng, p.lat, p.lng) <= p.radius_m + bonus) counts.set(p.id, (counts.get(p.id) || 0) + 1);
    }
  }
  return counts;
}

function recordPresence(db, user, coords, now) {
  db.prepare(`INSERT INTO location_reports (user_id, lat, lng, accuracy, at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy, at = excluded.at`)
    .run(user.id, coords.lat, coords.lng, coords.accuracy || 0, now);
}

export function visitedPlaceIds(db, userId) {
  if (!userId) return new Set();
  return new Set(db.prepare('SELECT DISTINCT place_id FROM checkins WHERE user_id = ?').all(userId).map((r) => r.place_id));
}

export function serializePlace(p, extra = {}) {
  return {
    id: p.id,
    cityId: p.city_id,
    name: p.name,
    kind: p.kind,
    lat: p.lat,
    lng: p.lng,
    radius: p.radius_m,
    userCreated: p.created_by != null,
    ...extra,
  };
}

// --- Konum güvenilirliği -----------------------------------------------------
// Tarayıcıdan gelen konum doğrulanamaz; bu denetimler kaba sahteciliği (ışınlanma, belirsiz
// konum, toplu mekân açma) frenler ve moderatörlere şüpheli hesapları gösterir.

function flagLocation(db, userId, reason, detail) {
  db.prepare('INSERT INTO location_flags (user_id, reason, detail, at) VALUES (?, ?, ?, ?)')
    .run(userId, reason, detail ? JSON.stringify(detail) : null, Date.now());
}

// { ok: true } ya da { ok: false, reason }. Güvenilen konum çağıran tarafından recordPresence ile saklanır.
export function verifyLocation(db, config, user, coords, now = Date.now()) {
  if (!config.antiSpoofing) return { ok: true };
  if (coords.accuracy > config.maxAccuracyM) return { ok: false, reason: 'low_accuracy' };
  const { n: flags } = db.prepare('SELECT COUNT(*) AS n FROM location_flags WHERE user_id = ? AND at > ?').get(user.id, now - 86400000);
  if (flags >= config.flagLimitPerDay) return { ok: false, reason: 'location_cooldown' };

  const last = db.prepare('SELECT lat, lng, at FROM location_reports WHERE user_id = ?').get(user.id);
  if (last) {
    const meters = distanceM(last.lat, last.lng, coords.lat, coords.lng);
    const hours = Math.max(1, now - last.at) / 3600000;
    const kmh = meters / 1000 / hours;
    if (meters > config.minJumpM && kmh > config.maxSpeedKmh) {
      flagLocation(db, user.id, 'impossible_travel', { km: Math.round(meters / 1000), minutes: Math.round(hours * 60), kmh: Math.round(kmh) });
      return { ok: false, reason: 'impossible_travel' };
    }
  }
  return { ok: true };
}

export function locationFlags(db) {
  return db.prepare(`
    SELECT u.handle, u.banned_at, COUNT(*) AS flags, MAX(f.at) AS last_at,
           (SELECT reason || ' ' || COALESCE(detail, '') FROM location_flags x WHERE x.user_id = f.user_id ORDER BY x.at DESC LIMIT 1) AS last
    FROM location_flags f JOIN users u ON u.id = f.user_id
    WHERE f.at > ?
    GROUP BY f.user_id ORDER BY flags DESC, last_at DESC LIMIT 100`).all(Date.now() - 7 * 86400000)
    .map((r) => ({ handle: r.handle, banned: r.banned_at != null, flags: r.flags, lastAt: r.last_at, last: r.last }));
}

// --- Check-in -------------------------------------------------------------

export function checkIn(db, config, user, coords) {
  const now = Date.now();
  const city = cityAt(coords.lat, coords.lng)?.id || null;
  const trust = verifyLocation(db, config, user, coords, now);
  if (!trust.ok) return { places: [], city, left: [], blocked: trust.reason };

  const before = currentPlaceIds(db, config, user.id, now);
  recordPresence(db, user, coords, now);
  const found = placesContaining(db, config, coords);
  const lastAt = db.prepare('SELECT MAX(at) AS at FROM checkins WHERE user_id = ? AND place_id = ?');
  const insert = db.prepare('INSERT INTO checkins (user_id, place_id, at) VALUES (?, ?, ?)');
  // Son bir saatte ilk kez uğranan mekân sayısı: aşılırsa yeni mekân sayılmaz (eskiler yine sayılır).
  let unlocksLeft = config.antiSpoofing
    ? config.maxUnlocksPerHour - db.prepare(`
        SELECT COUNT(*) AS n FROM (SELECT MIN(at) AS first FROM checkins WHERE user_id = ? GROUP BY place_id) WHERE first > ?`)
      .get(user.id, now - 3600000).n
    : Infinity;
  let throttled = false;
  const places = transaction(db, () => found.flatMap((p) => {
    const { at } = lastAt.get(user.id, p.id);
    if (at == null) {
      if (unlocksLeft <= 0) {
        throttled = true;
        return [];
      }
      unlocksLeft -= 1;
    }
    if (at == null || now - at >= config.checkinCooldownMs) insert.run(user.id, p.id, now);
    // arrived: az önce burada değildin (yerel sözler şimdi açıldı); firstVisit: ilk kez geldin.
    return [serializePlace(p, { visited: true, here: true, arrived: !before.has(p.id), firstVisit: at == null, distance: Math.round(p.distance) })];
  }));
  if (throttled) flagLocation(db, user.id, 'unlock_burst', { limit: config.maxUnlocksPerHour });
  // Ayrıldığın mekânlar: oradaki yerel sözler yeniden kilitlendi.
  const here = new Set(places.map((p) => p.id));
  const left = [...before].filter((id) => !here.has(id));
  return { places, city, left, ...(throttled ? { blocked: 'unlock_burst' } : {}) };
}

// --- Sözler ---------------------------------------------------------------

const OVERHEARD_SELECT = `
  SELECT o.id, o.user_id, o.place_id, o.text, o.created_at, o.hidden, o.anonymous, o.visibility, o.expires_at,
         u.handle, p.name AS place_name, p.city_id, p.lat AS place_lat, p.lng AS place_lng, p.radius_m
  FROM overheards o
  JOIN users u ON u.id = o.user_id
  JOIN places p ON p.id = o.place_id`;

const NOT_BLOCKED = `
  NOT EXISTS (SELECT 1 FROM blocks b
              WHERE (b.blocker_id = :viewer AND b.blocked_id = o.user_id)
                 OR (b.blocker_id = o.user_id AND b.blocked_id = :viewer))`;

// Görünen sözler: engelleme yok ve (24 saatlikse) süresi dolmamış. :viewer ve :now parametreleri gerekir.
const VISIBLE = `${NOT_BLOCKED} AND (o.expires_at IS NULL OR o.expires_at > :now)`;

// Bir grup söz için görüntüleyene özel bağlamı (reaksiyonlar, ortak mekânlar...) tek seferde hazırlar.
function buildContext(db, config, viewer, rows) {
  const ids = rows.map((r) => r.id);
  const ctx = {
    viewer,
    config,
    visited: visitedPlaceIds(db, viewer?.id),
    here: currentPlaceIds(db, config, viewer?.id),
    reactions: new Map(),
    mine: new Map(),
    checkins: new Map(),
    mutual: new Map(),
    witnesses: new Map(),
  };
  if (!ids.length) return ctx;

  const marks = ids.map(() => '?').join(',');
  for (const r of db.prepare(`SELECT overheard_id, kind, COUNT(*) AS n FROM reactions WHERE overheard_id IN (${marks}) GROUP BY overheard_id, kind`).all(...ids)) {
    if (!ctx.reactions.has(r.overheard_id)) ctx.reactions.set(r.overheard_id, {});
    ctx.reactions.get(r.overheard_id)[r.kind] = r.n;
  }
  if (!viewer) return ctx;

  // "Ben de duydum" diyenler: o sırada orada olduğu doğrulanmış tanıklar.
  for (const r of db.prepare(`
    SELECT r.overheard_id, u.handle FROM reactions r JOIN users u ON u.id = r.user_id
    WHERE r.kind = 'same' AND r.overheard_id IN (${marks})
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = r.user_id)
                                              OR (b.blocker_id = r.user_id AND b.blocked_id = ?))
    ORDER BY r.created_at`).all(...ids, viewer.id, viewer.id)) {
    if (!ctx.witnesses.has(r.overheard_id)) ctx.witnesses.set(r.overheard_id, []);
    ctx.witnesses.get(r.overheard_id).push(r.handle);
  }
  for (const r of db.prepare(`SELECT overheard_id, kind FROM reactions WHERE user_id = ? AND overheard_id IN (${marks})`).all(viewer.id, ...ids)) {
    if (!ctx.mine.has(r.overheard_id)) ctx.mine.set(r.overheard_id, []);
    ctx.mine.get(r.overheard_id).push(r.kind);
  }
  // Yalnızca bu sözlerin mekânlarındaki check-in'ler ("aynı anda oradaydın" için).
  const placeIds = [...new Set(rows.map((r) => r.place_id))];
  for (const r of db.prepare(`SELECT place_id, at FROM checkins WHERE user_id = ? AND place_id IN (${placeIds.map(() => '?').join(',')})`).all(viewer.id, ...placeIds)) {
    if (!ctx.checkins.has(r.place_id)) ctx.checkins.set(r.place_id, []);
    ctx.checkins.get(r.place_id).push(r.at);
  }
  const authors = [...new Set(rows.map((r) => r.user_id).filter((id) => id !== viewer.id))];
  if (authors.length) {
    const authorMarks = authors.map(() => '?').join(',');
    for (const r of db.prepare(`
      SELECT user_id, COUNT(DISTINCT place_id) AS n FROM checkins
      WHERE user_id IN (${authorMarks})
        AND place_id IN (SELECT place_id FROM checkins WHERE user_id = ?)
      GROUP BY user_id`).all(...authors, viewer.id)) {
      ctx.mutual.set(r.user_id, r.n);
    }
  }
  return ctx;
}

function canReadRow(ctx, row) {
  if (row.visibility === 'public') return true;
  return Boolean(ctx.viewer) && (row.user_id === ctx.viewer.id || ctx.here.has(row.place_id));
}

function serializeOverheard(row, ctx) {
  const reactions = ctx.reactions.get(row.id) || {};
  const total = Object.values(reactions).reduce((a, b) => a + b, 0);
  const position = scatterInPlace(row.id, { lat: row.place_lat, lng: row.place_lng, radius_m: row.radius_m });
  const base = {
    id: row.id,
    placeId: row.place_id,
    placeName: row.place_name,
    cityId: row.city_id,
    ...position,
    createdAt: row.created_at,
    reactionTotal: total,
    visibility: row.visibility,
    expiresAt: row.expires_at ?? null,
  };
  if (!canReadRow(ctx, row)) {
    // Kilitli yerel söz: metin sunucudan hiç çıkmaz, yalnızca uzunluğu ipucu olarak verilir.
    return { ...base, locked: true, length: [...row.text].length };
  }
  const mine = Boolean(ctx.viewer) && row.user_id === ctx.viewer.id;
  const times = ctx.checkins.get(row.place_id) || [];
  const myReactions = ctx.mine.get(row.id) || [];
  const sameTime = !mine && times.some((t) => Math.abs(t - row.created_at) <= ctx.config.sameTimeWindowMs);
  const witnessed = myReactions.includes('same');
  return {
    ...base,
    locked: false,
    text: row.text,
    // Anonim sözlerde yazarın adı yalnızca kendisine gösterilir.
    author: row.anonymous && !mine ? null : row.handle,
    anonymous: Boolean(row.anonymous),
    mine,
    reactions,
    myReactions,
    sameTime,
    mutualPlaces: mine ? null : ctx.mutual.get(row.user_id) || 0,
    here: ctx.here.has(row.place_id),
    canMessage: !mine,
    witnesses: (ctx.witnesses.get(row.id) || []).slice(0, 20),
    // 👂 yalnızca söz duyulduğunda orada olanlar içindir.
    canWitness: sameTime,
    // Tanıklara yalnızca söz sahibi ya da diğer tanıklar yazabilir.
    canMessageWitnesses: mine || witnessed,
  };
}

// Şehir haritası: tüm mekânlar (söz sayıları SQL'de, engellenenler hariç sayılır) + şehrin en
// yeni sözleri. Yoğun bölgelerde ayrıntı için istemci görünür alanı /api/overheards?bbox= ile ister.
export const CITY_OVERHEARD_LIMIT = 300;
export const BBOX_OVERHEARD_LIMIT = 300;
const MAX_BBOX_SPAN_DEG = 0.6;

export function cityMap(db, config, viewer, cityId) {
  if (!CITY_BY_ID.has(cityId)) throw new HttpError(404, 'city_not_found');
  const params = { city: cityId, viewer: viewer?.id ?? -1, now: Date.now() };
  const rows = db.prepare(`${OVERHEARD_SELECT}
    WHERE p.city_id = :city AND o.hidden = 0 AND ${VISIBLE}
    ORDER BY o.created_at DESC LIMIT ${CITY_OVERHEARD_LIMIT}`).all(params);
  const ctx = buildContext(db, config, viewer, rows);
  const overheards = rows.map((r) => serializeOverheard(r, ctx));

  const stats = new Map(db.prepare(`
    SELECT o.place_id, COUNT(*) AS n, SUM(o.visibility = 'local') AS local_n, MAX(o.created_at) AS last_at
    FROM overheards o JOIN places p ON p.id = o.place_id
    WHERE p.city_id = :city AND o.hidden = 0 AND ${VISIBLE}
    GROUP BY o.place_id`).all(params).map((r) => [r.place_id, r]));
  const placeRows = db.prepare('SELECT * FROM places WHERE city_id = ? ORDER BY name').all(cityId);
  const people = presenceCounts(db, config, placeRows);
  const places = placeRows
    .map((p) => {
      const st = stats.get(p.id);
      return serializePlace(p, {
        peopleHere: people.get(p.id) || 0,
        visited: ctx.visited.has(p.id),
        here: ctx.here.has(p.id),
        count: st?.n || 0,
        localCount: st?.local_n || 0,
        publicCount: (st?.n || 0) - (st?.local_n || 0),
        lastAt: st?.last_at || null,
      });
    });

  return { city: CITY_BY_ID.get(cityId), places, overheards, truncated: rows.length === CITY_OVERHEARD_LIMIT };
}

// Haftanın en iyileri: şehirde son 7 günde en çok tepki alan herkese açık sözler.
// Yerel sözler yerinde kalır; bu liste yalnızca herkese açık sözlerden oluşur.
export function bestOfWeek(db, config, viewer, cityId, { days = 7, limit = 10 } = {}) {
  if (!CITY_BY_ID.has(cityId)) throw new HttpError(404, 'city_not_found');
  const rows = db.prepare(`
    SELECT * FROM (
      ${OVERHEARD_SELECT}
      WHERE p.city_id = :city AND o.visibility = 'public' AND o.hidden = 0 AND o.created_at > :since AND ${VISIBLE}
    ) x
    ORDER BY (SELECT COUNT(*) FROM reactions r WHERE r.overheard_id = x.id) DESC, x.created_at DESC
    LIMIT :limit`).all({ city: cityId, since: Date.now() - days * 86400000, viewer: viewer?.id ?? -1, limit, now: Date.now() });
  const ctx = buildContext(db, config, viewer, rows);
  return { city: CITY_BY_ID.get(cityId), days, overheards: rows.map((r) => serializeOverheard(r, ctx)) };
}

// Görünür alandaki sözler (mekân merkezine göre), en yeniden eskiye.
export function overheardsInBox(db, config, viewer, bbox) {
  const parts = String(bbox || '').split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new HttpError(400, 'bad_bbox');
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLat > maxLat || minLng > maxLng || !isValidCoord(minLat, minLng) || !isValidCoord(maxLat, maxLng)) throw new HttpError(400, 'bad_bbox');
  if (maxLat - minLat > MAX_BBOX_SPAN_DEG || maxLng - minLng > MAX_BBOX_SPAN_DEG) throw new HttpError(400, 'bbox_too_large');
  const rows = db.prepare(`${OVERHEARD_SELECT}
    WHERE p.lat BETWEEN :minLat AND :maxLat AND p.lng BETWEEN :minLng AND :maxLng
      AND o.hidden = 0 AND ${VISIBLE}
    ORDER BY o.created_at DESC LIMIT ${BBOX_OVERHEARD_LIMIT}`)
    .all({ minLat, maxLat, minLng, maxLng, viewer: viewer?.id ?? -1, now: Date.now() });
  const ctx = buildContext(db, config, viewer, rows);
  return { overheards: rows.map((r) => serializeOverheard(r, ctx)), truncated: rows.length === BBOX_OVERHEARD_LIMIT };
}

function loadOverheardRow(db, id, viewerId) {
  const row = db.prepare(`${OVERHEARD_SELECT} WHERE o.id = :id AND ${VISIBLE}`).get({ id, viewer: viewerId ?? -1, now: Date.now() });
  if (!row || (row.hidden && row.user_id !== viewerId)) throw new HttpError(404, 'overheard_not_found');
  return row;
}

export function getOverheard(db, config, viewer, id) {
  const row = loadOverheardRow(db, id, viewer?.id);
  return serializeOverheard(row, buildContext(db, config, viewer, [row]));
}

// Söz bırakıldığı sırada (± pencere) kullanıcının o mekânda check-in'i var mı? Söz sahibi hariç.
function wasThereAtTheTime(db, config, user, row) {
  if (row.user_id === user.id) return false;
  return Boolean(db.prepare('SELECT 1 FROM checkins WHERE user_id = ? AND place_id = ? AND at BETWEEN ? AND ? LIMIT 1')
    .get(user.id, row.place_id, row.created_at - config.sameTimeWindowMs, row.created_at + config.sameTimeWindowMs));
}

const isWitness = (db, overheardId, userId) => Boolean(
  db.prepare("SELECT 1 FROM reactions WHERE overheard_id = ? AND user_id = ? AND kind = 'same'").get(overheardId, userId));

// Okuma iznini doğrular; yoksa nedenini söyleyen bir hata fırlatır.
function requireReadable(db, config, viewer, row) {
  if (row.visibility === 'public' || row.user_id === viewer.id) return;
  if (!currentPlaceIds(db, config, viewer.id).has(row.place_id)) {
    throw new HttpError(403, 'not_here', { placeId: row.place_id, placeName: row.place_name });
  }
}

export function createOverheard(db, config, user, body) {
  const raw = cleanText(body.text);
  if ([...raw].length < LIMITS.textMin) throw new HttpError(400, 'text_too_short');
  if ([...raw].length > LIMITS.textMax) throw new HttpError(400, 'text_too_long');
  // Nefret söylemi reddedilir; telefon, e-posta, plaka, @kişi ve küfür maskelenir.
  const { text, masked } = moderatePublicText(raw);
  if ([...text].length > LIMITS.textMax) throw new HttpError(400, 'text_too_long');
  const coords = readCoords(body);
  const now = Date.now();
  const trust = verifyLocation(db, config, user, coords, now);
  if (!trust.ok) throw new HttpError(403, trust.reason);
  const visibility = VISIBILITIES.includes(body.visibility) ? body.visibility : 'local';
  recordPresence(db, user, coords, now);

  return transaction(db, () => {
    let place;
    const containing = placesContaining(db, config, coords);
    if (body.placeId) {
      place = containing.find((p) => p.id === body.placeId);
      if (!place) {
        const target = db.prepare('SELECT * FROM places WHERE id = ?').get(String(body.placeId));
        if (!target) throw new HttpError(404, 'place_not_found');
        throw new HttpError(403, 'not_at_place', { distance: Math.round(distanceM(coords.lat, coords.lng, target.lat, target.lng)) });
      }
    } else if (body.newPlaceName !== undefined) {
      const name = moderatePublicText(cleanText(body.newPlaceName)).text;
      if ([...name].length < LIMITS.placeNameMin || [...name].length > LIMITS.placeNameMax) throw new HttpError(400, 'bad_place_name');
      if (containing.length) throw new HttpError(409, 'place_exists', { place: serializePlace(containing[0]) });
      const city = cityAt(coords.lat, coords.lng);
      if (!city) throw new HttpError(403, 'outside_pilot');
      const id = `${city.id}-${newId(6)}`;
      db.prepare(`INSERT INTO places (id, city_id, name, kind, lat, lng, radius_m, created_by, created_at)
                  VALUES (?, ?, ?, 'spot', ?, ?, ?, ?, ?)`)
        .run(id, city.id, name, coords.lat, coords.lng, config.newPlaceRadiusM, user.id, now);
      place = db.prepare('SELECT * FROM places WHERE id = ?').get(id);
    } else {
      place = containing[0];
      if (!place) throw new HttpError(409, 'no_place', { city: cityAt(coords.lat, coords.lng)?.id || null });
    }

    const id = newId();
    db.prepare('INSERT INTO checkins (user_id, place_id, at) VALUES (?, ?, ?)').run(user.id, place.id, now);
    // İsteğe bağlı 24 saatlik söz: süresi dolunca haritadan kalkar (konuşmalar sürer).
    const expiresAt = body.ephemeral ? now + config.ephemeralMs : null;
    db.prepare('INSERT INTO overheards (id, user_id, place_id, text, created_at, anonymous, visibility, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, user.id, place.id, text, now, body.anonymous ? 1 : 0, visibility, expiresAt);
    return { ...getOverheard(db, config, user, id), masked };
  });
}

export function deleteOverheard(db, user, id) {
  const row = db.prepare('SELECT user_id FROM overheards WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'overheard_not_found');
  if (row.user_id !== user.id) throw new HttpError(403, 'not_owner');
  db.prepare('DELETE FROM overheards WHERE id = ?').run(id);
}

export function toggleReaction(db, config, user, id, kind) {
  if (!REACTIONS.includes(kind)) throw new HttpError(400, 'bad_reaction');
  const row = loadOverheardRow(db, id, user.id);
  requireReadable(db, config, user, row);
  const existing = db.prepare('SELECT 1 FROM reactions WHERE overheard_id = ? AND user_id = ? AND kind = ?').get(id, user.id, kind);
  if (!existing && kind === 'same' && !wasThereAtTheTime(db, config, user, row)) throw new HttpError(403, 'not_same_time');
  if (existing) db.prepare('DELETE FROM reactions WHERE overheard_id = ? AND user_id = ? AND kind = ?').run(id, user.id, kind);
  else db.prepare('INSERT INTO reactions (overheard_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)').run(id, user.id, kind, Date.now());
  return getOverheard(db, config, user, id);
}

export function reportOverheard(db, config, user, id, reason) {
  const row = loadOverheardRow(db, id, user.id);
  requireReadable(db, config, user, row);
  if (row.user_id === user.id) throw new HttpError(400, 'own_overheard');
  const why = cleanText(reason).slice(0, 200) || 'unspecified';
  transaction(db, () => {
    db.prepare('INSERT OR IGNORE INTO reports (overheard_id, user_id, reason, created_at) VALUES (?, ?, ?, ?)').run(id, user.id, why, Date.now());
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM reports WHERE overheard_id = ?').get(id);
    if (n >= config.reportHideThreshold) db.prepare('UPDATE overheards SET hidden = 1 WHERE id = ?').run(id);
  });
}

// --- Ortak mekânlar ------------------------------------------------------

export function myPlaces(db, config, user) {
  const here = currentPlaceIds(db, config, user.id);
  return db.prepare(`
    SELECT p.*, MIN(c.at) AS first_at, MAX(c.at) AS last_at, COUNT(c.id) AS visits,
           (SELECT COUNT(*) FROM overheards o WHERE o.place_id = p.id AND o.hidden = 0) AS overheard_count
    FROM checkins c JOIN places p ON p.id = c.place_id
    WHERE c.user_id = ?
    GROUP BY p.id
    ORDER BY last_at DESC`).all(user.id)
    .map((p) => serializePlace(p, { visited: true, here: here.has(p.id), firstAt: p.first_at, lastAt: p.last_at, visits: p.visits, count: p.overheard_count }));
}

export function mutualPlaces(db, aId, bId) {
  return db.prepare(`
    SELECT p.id, p.name, p.city_id FROM places p
    WHERE EXISTS (SELECT 1 FROM checkins WHERE user_id = ? AND place_id = p.id)
      AND EXISTS (SELECT 1 FROM checkins WHERE user_id = ? AND place_id = p.id)
    ORDER BY p.name`).all(aId, bId)
    .map((p) => ({ id: p.id, name: p.name, cityId: p.city_id }));
}

export function profileStats(db, user) {
  const one = (sql) => db.prepare(sql).get(user.id).n;
  return {
    places: one('SELECT COUNT(DISTINCT place_id) AS n FROM checkins WHERE user_id = ?'),
    cities: one('SELECT COUNT(DISTINCT p.city_id) AS n FROM checkins c JOIN places p ON p.id = c.place_id WHERE c.user_id = ?'),
    overheards: one('SELECT COUNT(*) AS n FROM overheards WHERE user_id = ?'),
    reactionsReceived: one('SELECT COUNT(*) AS n FROM reactions r JOIN overheards o ON o.id = r.overheard_id WHERE o.user_id = ?'),
  };
}

// Sözün sahibini, (anonimse) kimliğini açığa çıkarmadan engeller.
export function blockAuthorOf(db, user, overheardId) {
  const row = db.prepare('SELECT user_id FROM overheards WHERE id = ?').get(overheardId);
  if (!row) throw new HttpError(404, 'overheard_not_found');
  if (row.user_id === user.id) throw new HttpError(400, 'cannot_block_self');
  db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(user.id, row.user_id, Date.now());
}

export function blockUser(db, user, handle) {
  const target = db.prepare('SELECT id FROM users WHERE handle = ?').get(String(handle));
  if (!target) throw new HttpError(404, 'user_not_found');
  if (target.id === user.id) throw new HttpError(400, 'cannot_block_self');
  db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(user.id, target.id, Date.now());
}

// --- Mesajlaşma ----------------------------------------------------------

function isBlocked(db, a, b) {
  return Boolean(db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').get(a, b, b, a));
}

function cleanMessage(body) {
  const text = cleanText(body, { multiline: true });
  if (!text) throw new HttpError(400, 'message_empty');
  if ([...text].length > LIMITS.messageMax) throw new HttpError(400, 'message_too_long');
  return moderatePrivateText(text);
}

function insertMessage(db, conversationId, senderId, body, now) {
  const { lastInsertRowid } = db.prepare('INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(conversationId, senderId, body, now);
  return { id: Number(lastInsertRowid), conversationId, sender: senderId, body, createdAt: now };
}

// Bir söz hakkında yazar: varsayılan olarak sözün sahibine, `to` verilirse o sözün bir tanığına.
// Yalnızca o mekânda bulunmuş olanlar yazabilir; tanıklara yalnızca söz sahibi ve diğer tanıklar.
// İki kişi arasında aynı söz için tek konuşma vardır (kim başlatırsa başlatsın).
export function messageAboutOverheard(db, config, user, overheardId, rawBody, to) {
  const body = cleanMessage(rawBody);
  const row = loadOverheardRow(db, overheardId, user.id);
  requireReadable(db, config, user, row);
  let recipientId = row.user_id;
  let kind = 'author';
  if (to) {
    const target = db.prepare('SELECT id FROM users WHERE handle = ?').get(String(to));
    if (!target) throw new HttpError(404, 'user_not_found');
    if (target.id !== row.user_id) {
      if (!isWitness(db, overheardId, target.id)) throw new HttpError(404, 'not_witness');
      if (row.user_id !== user.id && !isWitness(db, overheardId, user.id)) throw new HttpError(403, 'witness_only');
      kind = 'witness';
    }
    recipientId = target.id;
  }
  if (recipientId === user.id) throw new HttpError(400, 'own_overheard');
  if (isBlocked(db, user.id, recipientId)) throw new HttpError(403, 'blocked');
  const now = Date.now();
  return transaction(db, () => {
    let conv = db.prepare(`
      SELECT * FROM conversations WHERE overheard_id = ?
        AND ((owner_id = ? AND starter_id = ?) OR (owner_id = ? AND starter_id = ?))`)
      .get(overheardId, recipientId, user.id, user.id, recipientId);
    if (!conv) {
      const id = newId();
      db.prepare(`INSERT INTO conversations (id, overheard_id, owner_id, starter_id, kind, created_at, last_at, starter_read_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, overheardId, recipientId, user.id, kind, now, now, now);
      conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    }
    const message = insertMessage(db, conv.id, user.id, body, now);
    const readColumn = conv.owner_id === user.id ? 'owner_read_at' : 'starter_read_at';
    db.prepare(`UPDATE conversations SET last_at = ?, ${readColumn} = ? WHERE id = ?`).run(now, now, conv.id);
    return { conversationId: conv.id, recipientId, message, senderName: senderName(db, conv, user.id, user.handle) };
  });
}

// Konuşmadaki kişi anonim sözün henüz kimliğini açmamış sahibi mi?
const hiddenAuthor = (conv, overheard, userId) => userId === overheard.user_id && Boolean(overheard.anonymous) && !conv.author_revealed;

function conversationOverheard(db, conv) {
  return db.prepare('SELECT o.id, o.user_id, o.anonymous, o.text, o.created_at, p.name AS place_name FROM overheards o JOIN places p ON p.id = o.place_id WHERE o.id = ?').get(conv.overheard_id);
}

// Gönderenin, alıcıya görünen adı (anonim ve gizliyse null).
function senderName(db, conv, senderId, handle) {
  return hiddenAuthor(conv, conversationOverheard(db, conv), senderId) ? null : handle;
}

const MESSAGE_PAGE = 100;

function loadConversation(db, user, id) {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!conv || (conv.owner_id !== user.id && conv.starter_id !== user.id)) throw new HttpError(404, 'conversation_not_found');
  return conv;
}

export function sendMessage(db, user, conversationId, rawBody) {
  const body = cleanMessage(rawBody);
  const conv = loadConversation(db, user, conversationId);
  const otherId = conv.owner_id === user.id ? conv.starter_id : conv.owner_id;
  if (isBlocked(db, user.id, otherId)) throw new HttpError(403, 'blocked');
  const now = Date.now();
  const readColumn = conv.owner_id === user.id ? 'owner_read_at' : 'starter_read_at';
  return transaction(db, () => {
    const message = insertMessage(db, conv.id, user.id, body, now);
    db.prepare(`UPDATE conversations SET last_at = ?, ${readColumn} = ? WHERE id = ?`).run(now, now, conv.id);
    return { conversationId: conv.id, recipientId: otherId, message, senderName: senderName(db, conv, user.id, user.handle) };
  });
}

export function listConversations(db, user) {
  return db.prepare(`
    SELECT c.*, o.text AS overheard_text, o.user_id AS author_id, o.anonymous, p.name AS place_name,
           ou.handle AS owner_handle, su.handle AS starter_handle,
           (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
           (SELECT sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender
    FROM conversations c
    JOIN overheards o ON o.id = c.overheard_id
    JOIN places p ON p.id = o.place_id
    JOIN users ou ON ou.id = c.owner_id
    JOIN users su ON su.id = c.starter_id
    WHERE c.owner_id = ? OR c.starter_id = ?
    ORDER BY c.last_at DESC LIMIT 100`).all(user.id, user.id)
    .map((c) => {
      const amOwner = c.owner_id === user.id;
      const otherId = amOwner ? c.starter_id : c.owner_id;
      const hidden = hiddenAuthor(c, { user_id: c.author_id, anonymous: c.anonymous }, otherId);
      return {
        id: c.id,
        overheardId: c.overheard_id,
        overheardText: c.overheard_text,
        placeName: c.place_name,
        with: hidden ? null : amOwner ? c.starter_handle : c.owner_handle,
        role: amOwner ? 'owner' : 'starter',
        kind: c.kind,
        lastAt: c.last_at,
        lastMessage: c.last_body,
        lastFromMe: c.last_sender === user.id,
        unread: c.last_sender !== user.id && c.last_at > (amOwner ? c.owner_read_at : c.starter_read_at),
      };
    });
}

export function getConversation(db, user, id, { before } = {}) {
  const conv = loadConversation(db, user, id);
  const amOwner = conv.owner_id === user.id;
  const otherId = amOwner ? conv.starter_id : conv.owner_id;
  db.prepare(`UPDATE conversations SET ${amOwner ? 'owner_read_at' : 'starter_read_at'} = ? WHERE id = ?`).run(Date.now(), id);
  const other = db.prepare('SELECT handle FROM users WHERE id = ?').get(otherId);
  const overheard = conversationOverheard(db, conv);
  // Sayfalama: en yeni 100 mesaj; `before` verilirse o mesajdan eskiler.
  const page = db.prepare(`
    SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?) ORDER BY id`)
    .all(id, Number(before) > 0 ? Number(before) : Number.MAX_SAFE_INTEGER, MESSAGE_PAGE + 1);
  const hasMore = page.length > MESSAGE_PAGE;
  const messages = page.slice(hasMore ? 1 : 0)
    .map((m) => ({ id: m.id, body: m.body, createdAt: m.created_at, fromMe: m.sender_id === user.id }));
  return {
    id: conv.id,
    role: amOwner ? 'owner' : 'starter',
    kind: conv.kind,
    with: hiddenAuthor(conv, overheard, otherId) ? null : other.handle,
    overheard: { id: overheard.id, text: overheard.text, placeName: overheard.place_name, createdAt: overheard.created_at },
    mutualPlaces: mutualPlaces(db, user.id, otherId),
    // Anonim sözün sahibi bu konuşmada kimliğini açabilir.
    canReveal: hiddenAuthor(conv, overheard, user.id),
    messages,
    hasMore,
  };
}

export function revealIdentity(db, user, id) {
  const conv = loadConversation(db, user, id);
  if (!hiddenAuthor(conv, conversationOverheard(db, conv), user.id)) throw new HttpError(400, 'nothing_to_reveal');
  db.prepare('UPDATE conversations SET author_revealed = 1 WHERE id = ?').run(id);
  return { recipientId: conv.owner_id === user.id ? conv.starter_id : conv.owner_id };
}

export function unreadCount(db, user) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM conversations c
    WHERE (c.owner_id = :me AND c.last_at > c.owner_read_at OR c.starter_id = :me AND c.last_at > c.starter_read_at)
      AND (SELECT sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) != :me`).get({ me: user.id }).n;
}

// --- Keşif ilerlemesi ve rozetler -----------------------------------------

const WEEK_MS = 7 * 86400000;
// 1970-01-05 (Pazartesi) 00:00 UTC: haftalar pazartesi başlar.
const WEEK_EPOCH = 4 * 86400000;

export const BADGES = [
  { id: 'first_step', metric: 'places', of: 1 },
  { id: 'explorer', metric: 'places', of: 5 },
  { id: 'cartographer', metric: 'places', of: 20 },
  { id: 'two_cities', metric: 'cities', of: 2 },
  { id: 'first_drop', metric: 'overheards', of: 1 },
  { id: 'storyteller', metric: 'overheards', of: 10 },
  { id: 'witness', metric: 'witnessed', of: 1 },
  { id: 'connector', metric: 'conversations', of: 1 },
  { id: 'streak', metric: 'streak', of: 3 },
];

// Üst üste kaç haftadır en az bir mekânda bulunuldu (bu hafta henüz yoksa geçen haftadan sayılır).
function weeklyStreak(db, userId, now = Date.now()) {
  const weeks = new Set(db.prepare('SELECT DISTINCT CAST((at - ?) / ? AS INTEGER) AS w FROM checkins WHERE user_id = ?')
    .all(WEEK_EPOCH, WEEK_MS, userId).map((r) => r.w));
  let week = Math.floor((now - WEEK_EPOCH) / WEEK_MS);
  if (!weeks.has(week)) week -= 1;
  let streak = 0;
  while (weeks.has(week)) {
    streak += 1;
    week -= 1;
  }
  return streak;
}

function metrics(db, user) {
  const one = (sql, ...args) => db.prepare(sql).get(user.id, ...args).n;
  return {
    ...profileStats(db, user),
    witnessed: one("SELECT COUNT(*) AS n FROM reactions WHERE user_id = ? AND kind = 'same'"),
    conversations: db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE owner_id = ? OR starter_id = ?').get(user.id, user.id).n,
    streak: weeklyStreak(db, user.id),
    weekPlaces: one(`SELECT COUNT(*) AS n FROM (SELECT place_id, MIN(at) AS first FROM checkins WHERE user_id = ? GROUP BY place_id) WHERE first >= ?`, Date.now() - WEEK_MS),
  };
}

export function earnedBadges(db, user) {
  const m = metrics(db, user);
  return new Set(BADGES.filter((b) => m[b.metric] >= b.of).map((b) => b.id));
}

export function progress(db, user) {
  const m = metrics(db, user);
  const cities = db.prepare(`
    SELECT p.city_id AS cityId, COUNT(*) AS total,
           SUM(EXISTS (SELECT 1 FROM checkins c WHERE c.user_id = ? AND c.place_id = p.id)) AS visited
    FROM places p GROUP BY p.city_id`).all(user.id)
    .map((c) => ({ cityId: c.cityId, total: c.total, visited: c.visited }));
  return {
    metrics: m,
    cities,
    badges: BADGES.map((b) => ({ id: b.id, earned: m[b.metric] >= b.of, n: Math.min(m[b.metric], b.of), of: b.of })),
  };
}

// Bir eylemden önce ve sonra rozetleri karşılaştırıp yeni kazanılanları döndürür.
export function withBadges(db, user, fn) {
  const before = earnedBadges(db, user);
  const result = fn();
  const newBadges = [...earnedBadges(db, user)].filter((id) => !before.has(id));
  return { result, newBadges };
}

// --- Moderasyon paneli ----------------------------------------------------

export function reportedOverheards(db) {
  return db.prepare(`
    SELECT o.id, o.text, o.created_at, o.hidden, o.anonymous, u.handle, u.banned_at, p.name AS place_name,
           COUNT(r.user_id) AS reports, GROUP_CONCAT(DISTINCT r.reason) AS reasons
    FROM overheards o
    JOIN users u ON u.id = o.user_id
    JOIN places p ON p.id = o.place_id
    LEFT JOIN reports r ON r.overheard_id = o.id
    GROUP BY o.id
    HAVING reports > 0 OR o.hidden = 1
    ORDER BY o.hidden DESC, reports DESC, o.created_at DESC
    LIMIT 100`).all()
    .map((r) => ({
      id: r.id,
      text: r.text,
      createdAt: r.created_at,
      hidden: Boolean(r.hidden),
      anonymous: Boolean(r.anonymous),
      author: r.handle,
      authorBanned: r.banned_at != null,
      placeName: r.place_name,
      reports: r.reports,
      reasons: r.reasons ? r.reasons.split(',') : [],
    }));
}

export function restoreOverheard(db, id) {
  const { changes } = db.prepare('UPDATE overheards SET hidden = 0 WHERE id = ?').run(id);
  if (!changes) throw new HttpError(404, 'overheard_not_found');
  db.prepare('DELETE FROM reports WHERE overheard_id = ?').run(id);
}

export function removeOverheard(db, id) {
  const { changes } = db.prepare('DELETE FROM overheards WHERE id = ?').run(id);
  if (!changes) throw new HttpError(404, 'overheard_not_found');
}

export function setBanned(db, handle, banned) {
  const { changes } = db.prepare('UPDATE users SET banned_at = ? WHERE handle = ?').run(banned ? Date.now() : null, String(handle));
  if (!changes) throw new HttpError(404, 'user_not_found');
}

// --- Kişisel veriler (KVKK/GDPR) -----------------------------------------

export function exportUserData(db, user) {
  const u = db.prepare('SELECT handle, is_guest, created_at, terms_accepted_at FROM users WHERE id = ?').get(user.id);
  const last = db.prepare('SELECT lat, lng, accuracy, at FROM location_reports WHERE user_id = ?').get(user.id);
  const conversations = db.prepare(`
    SELECT c.*, o.user_id AS author_id, o.anonymous FROM conversations c JOIN overheards o ON o.id = c.overheard_id
    WHERE c.owner_id = ? OR c.starter_id = ? ORDER BY c.created_at`).all(user.id, user.id)
    .map((c) => {
      const otherId = c.owner_id === user.id ? c.starter_id : c.owner_id;
      const other = db.prepare('SELECT handle FROM users WHERE id = ?').get(otherId);
      return {
        id: c.id,
        overheardId: c.overheard_id,
        with: hiddenAuthor(c, { user_id: c.author_id, anonymous: c.anonymous }, otherId) ? null : other?.handle ?? null,
        messages: db.prepare('SELECT sender_id, body, created_at FROM messages WHERE conversation_id = ? ORDER BY id').all(c.id)
          .map((m) => ({ fromMe: m.sender_id === user.id, body: m.body, createdAt: new Date(m.created_at).toISOString() })),
      };
    });
  const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
  return {
    exportedAt: iso(Date.now()),
    user: { handle: u.handle, isGuest: Boolean(u.is_guest), createdAt: iso(u.created_at), termsAcceptedAt: iso(u.terms_accepted_at) },
    lastLocation: last ? { lat: last.lat, lng: last.lng, accuracy: last.accuracy, at: iso(last.at) } : null,
    checkins: db.prepare('SELECT p.name, p.city_id, c.at FROM checkins c JOIN places p ON p.id = c.place_id WHERE c.user_id = ? ORDER BY c.at')
      .all(user.id).map((c) => ({ place: c.name, city: c.city_id, at: iso(c.at) })),
    overheards: db.prepare('SELECT o.id, o.text, o.visibility, o.anonymous, o.hidden, o.created_at, p.name FROM overheards o JOIN places p ON p.id = o.place_id WHERE o.user_id = ? ORDER BY o.created_at')
      .all(user.id).map((o) => ({ id: o.id, place: o.name, text: o.text, visibility: o.visibility, anonymous: Boolean(o.anonymous), hidden: Boolean(o.hidden), createdAt: iso(o.created_at) })),
    reactions: db.prepare('SELECT overheard_id, kind, created_at FROM reactions WHERE user_id = ? ORDER BY created_at')
      .all(user.id).map((r) => ({ overheardId: r.overheard_id, kind: r.kind, createdAt: iso(r.created_at) })),
    reports: db.prepare('SELECT overheard_id, reason, created_at FROM reports WHERE user_id = ?')
      .all(user.id).map((r) => ({ overheardId: r.overheard_id, reason: r.reason, createdAt: iso(r.created_at) })),
    blocked: db.prepare('SELECT u.handle FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ?').all(user.id).map((r) => r.handle),
    conversations,
  };
}

// Hesabı siler; oturumlar, check-in'ler, sözler, tepkiler, konuşmalar ve konum kayıtları
// yabancı anahtarlarla (ON DELETE CASCADE) birlikte gider. Açtığı mekânlar sahipsiz kalır.
export function deleteAccount(db, user) {
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
}

// Saklama süreleri: kesin konum 24 saat, mekân odası mesajları 12 saat, 24 saatlik sözler süresi
// dolunca, şüpheli konum kayıtları 90 gün.
export function purgeStaleData(db, config, now = Date.now()) {
  const locations = db.prepare('DELETE FROM location_reports WHERE at < ?').run(now - config.locationRetentionMs).changes;
  const rooms = db.prepare('DELETE FROM room_messages WHERE created_at < ?').run(now - config.roomRetentionMs).changes;
  // Süresi dolan 24 saatlik sözler silinir; üzerinden konuşma başlamışsa sohbet bağlamı için kalır.
  const expired = db.prepare(`DELETE FROM overheards WHERE expires_at IS NOT NULL AND expires_at < ?
    AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.overheard_id = overheards.id)`).run(now).changes;
  const flags = db.prepare('DELETE FROM location_flags WHERE at < ?').run(now - config.flagRetentionMs).changes;
  return { locations: Number(locations), rooms: Number(rooms), expired: Number(expired), flags: Number(flags) };
}

// --- Mekân odası -----------------------------------------------------------
// O an aynı mekânda bulunanların grup sohbeti. Yalnızca oradayken okunur ve yazılır;
// mesajlar 12 saat sonra silinir. Engellenen kişilerin mesajları görünmez.

function requireHere(db, config, user, placeId) {
  const place = db.prepare('SELECT id, name, city_id, lat, lng, radius_m FROM places WHERE id = ?').get(String(placeId));
  if (!place) throw new HttpError(404, 'place_not_found');
  if (!currentPlaceIds(db, config, user.id).has(place.id)) throw new HttpError(403, 'not_here', { placeName: place.name });
  return place;
}

// Mekânda şu an bulunan kullanıcıların kimlikleri (canlı bildirim için).
export function usersAtPlace(db, config, place, now = Date.now()) {
  return db.prepare('SELECT user_id, lat, lng, accuracy FROM location_reports WHERE at > ?').all(now - config.presenceTtlMs)
    .filter((r) => distanceM(r.lat, r.lng, place.lat, place.lng) <= place.radius_m + Math.min(r.accuracy || 0, config.maxAccuracyBonusM))
    .map((r) => r.user_id);
}

export function getRoom(db, config, user, placeId) {
  const place = requireHere(db, config, user, placeId);
  const messages = db.prepare(`
    SELECT * FROM (
      SELECT m.id, m.user_id, m.body, m.created_at, u.handle FROM room_messages m JOIN users u ON u.id = m.user_id
      WHERE m.place_id = ? AND m.created_at > ?
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = m.user_id)
                                                OR (b.blocker_id = m.user_id AND b.blocked_id = ?))
      ORDER BY m.id DESC LIMIT 100) ORDER BY id`)
    .all(place.id, Date.now() - config.roomRetentionMs, user.id, user.id)
    .map((m) => ({ id: m.id, author: m.handle, mine: m.user_id === user.id, body: m.body, createdAt: m.created_at }));
  return {
    place: { id: place.id, name: place.name, cityId: place.city_id },
    peopleHere: usersAtPlace(db, config, place).length,
    retentionHours: Math.round(config.roomRetentionMs / 3600000),
    messages,
  };
}

export function postRoomMessage(db, config, user, placeId, rawBody) {
  const place = requireHere(db, config, user, placeId);
  const clean = cleanText(rawBody, { multiline: true });
  if (!clean) throw new HttpError(400, 'message_empty');
  if ([...clean].length > LIMITS.roomMessageMax) throw new HttpError(400, 'message_too_long');
  // Yabancılarla ortak bir oda: kişisel veriler maskelenir, nefret söylemi reddedilir.
  const { text } = moderatePublicText(clean);
  const now = Date.now();
  const { lastInsertRowid } = db.prepare('INSERT INTO room_messages (place_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(place.id, user.id, text, now);
  const blocked = new Set(db.prepare('SELECT blocked_id AS id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?')
    .all(user.id, user.id).map((r) => r.id));
  const recipients = usersAtPlace(db, config, place, now).filter((id) => id !== user.id && !blocked.has(id));
  return {
    placeId: place.id,
    message: { id: Number(lastInsertRowid), author: user.handle, body: text, createdAt: now },
    recipients,
  };
}
