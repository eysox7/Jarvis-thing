import { randomBytes } from 'node:crypto';
import { HttpError, clientIp, readJson, sendJson, serializeCookie } from './http.js';
import { HANDLE_RE, createSession, destroySession, hashPassword, verifyPassword } from './auth.js';
import { CITIES } from './data/cities.js';
import * as domain from './domain.js';

export const SESSION_COOKIE = 'oh_session';

export function registerApi(router, { db, config, events, rateLimit }) {
  const limit = (key, max, windowMs) => {
    if (!rateLimit(key, Math.ceil(max * config.rateLimitScale), windowMs)) throw new HttpError(429, 'rate_limited');
  };

  const requireUser = (ctx) => {
    if (!ctx.user) throw new HttpError(401, 'login_required');
    return ctx.user;
  };

  // Yazma işlemleri: yasaklı kullanıcı okuyabilir ama yazamaz.
  const requireActive = (ctx) => {
    const user = requireUser(ctx);
    if (user.banned) throw new HttpError(403, 'banned');
    return user;
  };

  const isAdmin = (user) => Boolean(user) && config.admins.includes(user.handle.toLowerCase());

  const requireAdmin = (ctx) => {
    const user = requireUser(ctx);
    if (!isAdmin(user)) throw new HttpError(403, 'admin_only');
    return user;
  };

  const startSession = (ctx, userId) => {
    const token = createSession(db, userId, config.sessionDays);
    ctx.setCookie(serializeCookie(SESSION_COOKIE, token, { maxAge: config.sessionDays * 86400, secure: config.secureCookies }));
  };

  const publicUser = (user) => ({
    handle: user.handle,
    isGuest: Boolean(user.isGuest ?? user.is_guest),
    isAdmin: isAdmin(user),
    banned: Boolean(user.banned ?? user.banned_at),
  });

  // --- Yapılandırma ---
  router.get('/api/config', () => ({
    cities: CITIES,
    demoMode: config.demoMode,
    googleMapsKey: config.googleMapsKey || null,
    reactions: domain.REACTIONS,
    limits: domain.LIMITS,
    visibilities: domain.VISIBILITIES,
    presenceMinutes: Math.round(config.presenceTtlMs / 60000),
  }));

  // --- Hesap ---
  router.post('/api/auth/register', async (ctx) => {
    limit(`register:${clientIp(ctx.req, config.trustProxy)}`, 10, 3600000);
    const body = await readJson(ctx.req);
    const handle = String(body.handle || '').trim();
    const password = String(body.password || '');
    if (!HANDLE_RE.test(handle)) throw new HttpError(400, 'bad_handle');
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'bad_password');
    // Kullanım koşulları ve gizlilik politikası açıkça kabul edilmeden hesap açılmaz.
    if (body.acceptTerms !== true) throw new HttpError(400, 'terms_required');
    if (db.prepare('SELECT 1 FROM users WHERE handle = ?').get(handle)) throw new HttpError(409, 'handle_taken');
    const passHash = await hashPassword(password);
    const now = Date.now();
    const { lastInsertRowid } = db.prepare('INSERT INTO users (handle, pass_hash, created_at, terms_accepted_at) VALUES (?, ?, ?, ?)').run(handle, passHash, now, now);
    startSession(ctx, Number(lastInsertRowid));
    return { user: publicUser({ handle, isGuest: false }) };
  });

  router.post('/api/auth/login', async (ctx) => {
    limit(`login:${clientIp(ctx.req, config.trustProxy)}`, 20, 15 * 60000);
    const body = await readJson(ctx.req);
    const user = db.prepare('SELECT * FROM users WHERE handle = ? AND is_guest = 0').get(String(body.handle || '').trim());
    if (!user || !(await verifyPassword(String(body.password || ''), user.pass_hash))) throw new HttpError(401, 'bad_credentials');
    startSession(ctx, user.id);
    return { user: publicUser(user) };
  });

  // Demo modunda kayıt olmadan denemek için tek kullanımlık misafir hesabı.
  router.post('/api/auth/guest', async (ctx) => {
    if (!config.demoMode) throw new HttpError(404, 'not_found');
    limit(`guest:${clientIp(ctx.req, config.trustProxy)}`, 20, 3600000);
    const handle = `misafir_${randomBytes(4).toString('hex')}`;
    const passHash = await hashPassword(randomBytes(24).toString('hex'));
    // Misafir düğmesinin altındaki metin: devam etmek koşulları kabul etmektir.
    const now = Date.now();
    const { lastInsertRowid } = db.prepare('INSERT INTO users (handle, pass_hash, is_guest, created_at, terms_accepted_at) VALUES (?, ?, 1, ?, ?)').run(handle, passHash, now, now);
    startSession(ctx, Number(lastInsertRowid));
    return { user: publicUser({ handle, isGuest: true }) };
  });

  // Misafir hesabı kalıcı hesaba dönüşür: açılan mekânlar, sözler ve konuşmalar korunur.
  router.post('/api/auth/upgrade', async (ctx) => {
    const user = requireUser(ctx);
    if (!user.isGuest) throw new HttpError(400, 'not_guest');
    limit(`register:${clientIp(ctx.req, config.trustProxy)}`, 10, 3600000);
    const body = await readJson(ctx.req);
    const handle = String(body.handle || '').trim();
    const password = String(body.password || '');
    if (!HANDLE_RE.test(handle)) throw new HttpError(400, 'bad_handle');
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'bad_password');
    const taken = db.prepare('SELECT id FROM users WHERE handle = ?').get(handle);
    if (taken && taken.id !== user.id) throw new HttpError(409, 'handle_taken');
    const passHash = await hashPassword(password);
    db.prepare('UPDATE users SET handle = ?, pass_hash = ?, is_guest = 0 WHERE id = ?').run(handle, passHash, user.id);
    return { user: publicUser({ handle, isGuest: false, banned: user.banned }) };
  });

  router.post('/api/auth/logout', (ctx) => {
    if (ctx.token) destroySession(db, ctx.token);
    ctx.setCookie(serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: config.secureCookies }));
    return { ok: true };
  });

  router.get('/api/me', (ctx) => {
    if (!ctx.user) return { user: null };
    return {
      user: publicUser(ctx.user),
      stats: domain.profileStats(db, ctx.user),
      unread: domain.unreadCount(db, ctx.user),
      progress: domain.progress(db, ctx.user),
    };
  });

  // --- Harita ve mekânlar ---
  router.get('/api/cities/:id/map', (ctx) => domain.cityMap(db, config, ctx.user, ctx.params.id));

  // Görünür alan: ?bbox=minLng,minLat,maxLng,maxLat
  router.get('/api/overheards', (ctx) => domain.overheardsInBox(db, config, ctx.user, ctx.url.searchParams.get('bbox')));

  router.post('/api/checkins', async (ctx) => {
    const user = requireUser(ctx);
    limit(`checkin:${user.id}`, 120, 3600000);
    const coords = domain.readCoords(await readJson(ctx.req));
    const { result, newBadges } = domain.withBadges(db, user, () => domain.checkIn(db, config, user, coords));
    return { ...result, newBadges };
  });

  router.get('/api/me/places', (ctx) => ({ places: domain.myPlaces(db, config, requireUser(ctx)) }));

  // KVKK/GDPR: kişisel verilerin indirilebilir kopyası.
  router.get('/api/me/export', (ctx) => {
    const data = domain.exportUserData(db, requireUser(ctx));
    sendJson(ctx.res, 200, data, { 'content-disposition': 'attachment; filename="overheard-verilerim.json"' });
    return ctx.STREAMING;
  });

  // KVKK/GDPR: hesabı ve ona bağlı tüm verileri kalıcı olarak siler.
  router.post('/api/me/delete', async (ctx) => {
    const user = requireUser(ctx);
    limit(`delete:${user.id}`, 5, 3600000);
    const body = await readJson(ctx.req);
    if (!user.isGuest) {
      const row = db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(user.id);
      if (!(await verifyPassword(String(body.password || ''), row.pass_hash))) throw new HttpError(401, 'bad_credentials');
    }
    domain.deleteAccount(db, user);
    ctx.setCookie(serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: config.secureCookies }));
    return { ok: true };
  });

  // --- Sözler ---
  router.post('/api/overheards', async (ctx) => {
    const user = requireActive(ctx);
    const body = await readJson(ctx.req);
    limit(`post:${user.id}`, 10, 3600000);
    const { result, newBadges } = domain.withBadges(db, user, () => domain.createOverheard(db, config, user, body));
    return { overheard: result, newBadges };
  });

  router.get('/api/overheards/:id', (ctx) => ({ overheard: domain.getOverheard(db, config, ctx.user, ctx.params.id) }));

  router.delete('/api/overheards/:id', (ctx) => {
    domain.deleteOverheard(db, requireUser(ctx), ctx.params.id);
    return { ok: true };
  });

  router.post('/api/overheards/:id/reactions', async (ctx) => {
    const user = requireActive(ctx);
    limit(`react:${user.id}`, 300, 3600000);
    const body = await readJson(ctx.req);
    const { result, newBadges } = domain.withBadges(db, user, () => domain.toggleReaction(db, config, user, ctx.params.id, String(body.kind || '')));
    return { overheard: result, newBadges };
  });

  router.post('/api/overheards/:id/report', async (ctx) => {
    const user = requireActive(ctx);
    limit(`report:${user.id}`, 30, 3600000);
    const body = await readJson(ctx.req);
    domain.reportOverheard(db, config, user, ctx.params.id, body.reason);
    return { ok: true };
  });

  // --- Mesajlar ---
  const deliver = ({ result, newBadges }) => {
    events.publish(result.recipientId, 'dm', {
      conversationId: result.conversationId,
      from: result.senderName,
      body: result.message.body,
      createdAt: result.message.createdAt,
    });
    const { id, body, createdAt } = result.message;
    return { conversationId: result.conversationId, message: { id, body, createdAt, fromMe: true }, newBadges };
  };

  router.post('/api/overheards/:id/messages', async (ctx) => {
    const user = requireActive(ctx);
    limit(`message:${user.id}`, 60, 3600000);
    const body = await readJson(ctx.req);
    return deliver(domain.withBadges(db, user, () => domain.messageAboutOverheard(db, config, user, ctx.params.id, body.body, body.to)));
  });

  router.get('/api/conversations', (ctx) => ({ conversations: domain.listConversations(db, requireUser(ctx)) }));

  router.get('/api/conversations/:id', (ctx) => ({
    conversation: domain.getConversation(db, requireUser(ctx), ctx.params.id, { before: ctx.url.searchParams.get('before') }),
  }));

  router.post('/api/conversations/:id/messages', async (ctx) => {
    const user = requireActive(ctx);
    limit(`message:${user.id}`, 60, 3600000);
    const body = await readJson(ctx.req);
    return deliver(domain.withBadges(db, user, () => domain.sendMessage(db, user, ctx.params.id, body.body)));
  });

  router.post('/api/conversations/:id/reveal', (ctx) => {
    const user = requireUser(ctx);
    const { recipientId } = domain.revealIdentity(db, user, ctx.params.id);
    events.publish(recipientId, 'reveal', { conversationId: ctx.params.id, handle: user.handle });
    return { conversation: domain.getConversation(db, user, ctx.params.id) };
  });

  router.post('/api/overheards/:id/block-author', (ctx) => {
    domain.blockAuthorOf(db, requireUser(ctx), ctx.params.id);
    return { ok: true };
  });

  // --- Mekân odası ---
  router.get('/api/places/:id/room', (ctx) => ({ room: domain.getRoom(db, config, requireUser(ctx), ctx.params.id) }));

  router.post('/api/places/:id/room', async (ctx) => {
    const user = requireActive(ctx);
    limit(`room:${user.id}`, 30, 10 * 60000);
    const body = await readJson(ctx.req);
    const { placeId, message, recipients } = domain.postRoomMessage(db, config, user, ctx.params.id, body.body);
    for (const id of recipients) events.publish(id, 'room', { placeId, message });
    return { message: { ...message, mine: true } };
  });

  router.post('/api/users/:handle/block', (ctx) => {
    domain.blockUser(db, requireUser(ctx), ctx.params.handle);
    return { ok: true };
  });

  // --- Moderasyon paneli (OVERHEARD_ADMINS) ---
  router.get('/api/admin/reports', (ctx) => {
    requireAdmin(ctx);
    return { overheards: domain.reportedOverheards(db) };
  });

  router.get('/api/admin/location-flags', (ctx) => {
    requireAdmin(ctx);
    return { users: domain.locationFlags(db) };
  });

  router.post('/api/admin/overheards/:id/restore', (ctx) => {
    requireAdmin(ctx);
    domain.restoreOverheard(db, ctx.params.id);
    return { ok: true };
  });

  router.delete('/api/admin/overheards/:id', (ctx) => {
    requireAdmin(ctx);
    domain.removeOverheard(db, ctx.params.id);
    return { ok: true };
  });

  router.post('/api/admin/users/:handle/ban', async (ctx) => {
    const admin = requireAdmin(ctx);
    const body = await readJson(ctx.req);
    if (ctx.params.handle.toLowerCase() === admin.handle.toLowerCase()) throw new HttpError(400, 'cannot_ban_self');
    domain.setBanned(db, ctx.params.handle, body.banned !== false);
    return { ok: true };
  });

  router.get('/api/events', (ctx) => {
    const user = requireUser(ctx);
    events.subscribe(user.id, ctx.req, ctx.res);
    return ctx.STREAMING;
  });
}
