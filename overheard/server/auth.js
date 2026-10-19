import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, salt, expected] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !expected) return false;
  const hash = await scryptAsync(password, Buffer.from(salt, 'base64url'), KEY_LEN);
  const want = Buffer.from(expected, 'base64url');
  return want.length === hash.length && timingSafeEqual(hash, want);
}

const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

export function newId(bytes = 9) {
  return randomBytes(bytes).toString('base64url');
}

// Veritabanında yalnızca belirtecin özeti tutulur; sızıntıda oturumlar ele geçirilemez.
export function createSession(db, userId, days) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash(token), userId, now, now + days * 86400000);
  return token;
}

export function sessionUser(db, token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.handle, u.is_guest, u.created_at, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?`).get(tokenHash(token));
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(db, token);
    return null;
  }
  return { id: row.id, handle: row.handle, isGuest: Boolean(row.is_guest), createdAt: row.created_at };
}

export function destroySession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

export const HANDLE_RE = /^[a-zA-Z0-9_.]{3,20}$/;
