// Overheard'ün kuralları burada yaşar. En önemlisi "ortak mekân" kuralı:
// bir sözü yalnızca o sözün duyulduğu mekânda bulunmuş olan kişi okuyabilir.
// Söz sahibi de oraya gitmiş olduğundan (paylaşmak için orada olmak şart),
// okuyabilmek = yazanla en az bir ortak mekânın olması demektir.
import { transaction } from './db.js';
import { newId } from './auth.js';
import { HttpError } from './http.js';
import { boundingBox, distanceM, isValidCoord, scatterInPlace } from './geo.js';
import { CITIES, CITY_BY_ID } from './data/cities.js';
import { moderatePublicText, moderatePrivateText } from './moderation.js';

export const REACTIONS = ['lol', 'wow', 'same', 'heart'];
export const LIMITS = { textMin: 3, textMax: 280, placeNameMin: 2, placeNameMax: 60, messageMax: 1000 };

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

// --- Check-in -------------------------------------------------------------

export function checkIn(db, config, user, coords) {
  const now = Date.now();
  const found = placesContaining(db, config, coords);
  const lastAt = db.prepare('SELECT MAX(at) AS at FROM checkins WHERE user_id = ? AND place_id = ?');
  const insert = db.prepare('INSERT INTO checkins (user_id, place_id, at) VALUES (?, ?, ?)');
  const places = transaction(db, () => found.map((p) => {
    const { at } = lastAt.get(user.id, p.id);
    if (at == null || now - at >= config.checkinCooldownMs) insert.run(user.id, p.id, now);
    return serializePlace(p, { visited: true, newlyUnlocked: at == null, distance: Math.round(p.distance) });
  }));
  return { places, city: cityAt(coords.lat, coords.lng)?.id || null };
}

// --- Sözler ---------------------------------------------------------------

const OVERHEARD_SELECT = `
  SELECT o.id, o.user_id, o.place_id, o.text, o.created_at, o.hidden, o.anonymous,
         u.handle, p.name AS place_name, p.city_id, p.lat AS place_lat, p.lng AS place_lng, p.radius_m
  FROM overheards o
  JOIN users u ON u.id = o.user_id
  JOIN places p ON p.id = o.place_id`;

const NOT_BLOCKED = `
  NOT EXISTS (SELECT 1 FROM blocks b
              WHERE (b.blocker_id = :viewer AND b.blocked_id = o.user_id)
                 OR (b.blocker_id = o.user_id AND b.blocked_id = :viewer))`;

// Bir grup söz için görüntüleyene özel bağlamı (reaksiyonlar, ortak mekânlar...) tek seferde hazırlar.
function buildContext(db, config, viewer, rows) {
  const ids = rows.map((r) => r.id);
  const ctx = {
    viewer,
    config,
    visited: visitedPlaceIds(db, viewer?.id),
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
  for (const r of db.prepare('SELECT place_id, at FROM checkins WHERE user_id = ?').all(viewer.id)) {
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
  return Boolean(ctx.viewer) && (row.user_id === ctx.viewer.id || ctx.visited.has(row.place_id));
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
  };
  if (!canReadRow(ctx, row)) {
    // Kilitli söz: metin sunucudan hiç çıkmaz, yalnızca uzunluğu ipucu olarak verilir.
    return { ...base, locked: true, length: [...row.text].length };
  }
  const mine = row.user_id === ctx.viewer.id;
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
    canMessage: !mine,
    witnesses: (ctx.witnesses.get(row.id) || []).slice(0, 20),
    // 👂 yalnızca söz duyulduğunda orada olanlar içindir.
    canWitness: sameTime,
    // Tanıklara yalnızca söz sahibi ya da diğer tanıklar yazabilir.
    canMessageWitnesses: mine || witnessed,
  };
}

export function cityMap(db, config, viewer, cityId) {
  if (!CITY_BY_ID.has(cityId)) throw new HttpError(404, 'city_not_found');
  const rows = db.prepare(`${OVERHEARD_SELECT}
    WHERE p.city_id = :city AND o.hidden = 0 AND ${NOT_BLOCKED}
    ORDER BY o.created_at DESC LIMIT 500`).all({ city: cityId, viewer: viewer?.id ?? -1 });
  const ctx = buildContext(db, config, viewer, rows);
  const overheards = rows.map((r) => serializeOverheard(r, ctx));

  const stats = new Map();
  for (const o of overheards) {
    const s = stats.get(o.placeId) || { count: 0, lastAt: 0 };
    s.count += 1;
    s.lastAt = Math.max(s.lastAt, o.createdAt);
    stats.set(o.placeId, s);
  }
  const places = db.prepare('SELECT * FROM places WHERE city_id = ? ORDER BY name').all(cityId)
    .map((p) => serializePlace(p, { visited: ctx.visited.has(p.id), count: stats.get(p.id)?.count || 0, lastAt: stats.get(p.id)?.lastAt || null }));

  return { city: CITY_BY_ID.get(cityId), places, overheards };
}

function loadOverheardRow(db, id, viewerId) {
  const row = db.prepare(`${OVERHEARD_SELECT} WHERE o.id = :id AND ${NOT_BLOCKED}`).get({ id, viewer: viewerId ?? -1 });
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
function requireReadable(db, viewer, row) {
  if (row.user_id === viewer.id) return;
  const visited = db.prepare('SELECT 1 FROM checkins WHERE user_id = ? AND place_id = ? LIMIT 1').get(viewer.id, row.place_id);
  if (!visited) throw new HttpError(403, 'not_mutual', { placeId: row.place_id, placeName: row.place_name });
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
    db.prepare('INSERT INTO overheards (id, user_id, place_id, text, created_at, anonymous) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, user.id, place.id, text, now, body.anonymous ? 1 : 0);
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
  requireReadable(db, user, row);
  const existing = db.prepare('SELECT 1 FROM reactions WHERE overheard_id = ? AND user_id = ? AND kind = ?').get(id, user.id, kind);
  if (!existing && kind === 'same' && !wasThereAtTheTime(db, config, user, row)) throw new HttpError(403, 'not_same_time');
  if (existing) db.prepare('DELETE FROM reactions WHERE overheard_id = ? AND user_id = ? AND kind = ?').run(id, user.id, kind);
  else db.prepare('INSERT INTO reactions (overheard_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)').run(id, user.id, kind, Date.now());
  return getOverheard(db, config, user, id);
}

export function reportOverheard(db, config, user, id, reason) {
  const row = loadOverheardRow(db, id, user.id);
  requireReadable(db, user, row);
  if (row.user_id === user.id) throw new HttpError(400, 'own_overheard');
  const why = cleanText(reason).slice(0, 200) || 'unspecified';
  transaction(db, () => {
    db.prepare('INSERT OR IGNORE INTO reports (overheard_id, user_id, reason, created_at) VALUES (?, ?, ?, ?)').run(id, user.id, why, Date.now());
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM reports WHERE overheard_id = ?').get(id);
    if (n >= config.reportHideThreshold) db.prepare('UPDATE overheards SET hidden = 1 WHERE id = ?').run(id);
  });
}

// --- Ortak mekânlar ------------------------------------------------------

export function myPlaces(db, user) {
  return db.prepare(`
    SELECT p.*, MIN(c.at) AS first_at, MAX(c.at) AS last_at, COUNT(c.id) AS visits,
           (SELECT COUNT(*) FROM overheards o WHERE o.place_id = p.id AND o.hidden = 0) AS overheard_count
    FROM checkins c JOIN places p ON p.id = c.place_id
    WHERE c.user_id = ?
    GROUP BY p.id
    ORDER BY last_at DESC`).all(user.id)
    .map((p) => serializePlace(p, { visited: true, firstAt: p.first_at, lastAt: p.last_at, visits: p.visits, count: p.overheard_count }));
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
export function messageAboutOverheard(db, user, overheardId, rawBody, to) {
  const body = cleanMessage(rawBody);
  const row = loadOverheardRow(db, overheardId, user.id);
  requireReadable(db, user, row);
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

export function getConversation(db, user, id) {
  const conv = loadConversation(db, user, id);
  const amOwner = conv.owner_id === user.id;
  const otherId = amOwner ? conv.starter_id : conv.owner_id;
  db.prepare(`UPDATE conversations SET ${amOwner ? 'owner_read_at' : 'starter_read_at'} = ? WHERE id = ?`).run(Date.now(), id);
  const other = db.prepare('SELECT handle FROM users WHERE id = ?').get(otherId);
  const overheard = conversationOverheard(db, conv);
  const messages = db.prepare(`
    SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 200) ORDER BY id`).all(id)
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
