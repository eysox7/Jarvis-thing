// Kulaktan kulağa (eşten eşe): bağlantı yokken (metroda) yazılan söz, yazarın cihazında imzalanır ve
// QR ya da AirDrop/Quick Share ile yanındaki telefona geçer. Kim önce bağlantı bulursa sözü sunucuya
// o ulaştırır. İmza yazarın cihaz anahtarıyla (ECDSA P-256) atılır; anahtarın açık yarısı yazar
// bağlıyken sunucuya kaydedilmiştir. Böylece taşıyan kişi sözü değiştiremez ve başkası adına söz
// uyduramaz; "o sırada oradaydım" kanıtı da yazarındır (createOfflineOverheard).
import { webcrypto } from 'node:crypto';
import { HttpError } from './http.js';
import { newId } from './auth.js';

const MAX_KEYS_PER_USER = 5;
const B64URL = /^[\w-]+$/;
const ALG = { name: 'ECDSA', namedCurve: 'P-256' };

// Cihazın açık anahtarını kaydeder (yalnızca açık yarı; özel anahtar cihazdan çıkmaz).
export async function registerDeviceKey(db, user, jwk) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || 'd' in jwk || !B64URL.test(jwk.x || '') || !B64URL.test(jwk.y || '')) {
    throw new HttpError(400, 'bad_key');
  }
  const publicJwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  try {
    await webcrypto.subtle.importKey('jwk', publicJwk, ALG, false, ['verify']);
  } catch {
    throw new HttpError(400, 'bad_key');
  }
  const id = newId(9);
  db.prepare('INSERT INTO device_keys (id, user_id, public_jwk, created_at) VALUES (?, ?, ?, ?)').run(id, user.id, JSON.stringify(publicJwk), Date.now());
  // En yeni birkaç cihaz yeter; eskiler düşer.
  db.prepare(`DELETE FROM device_keys WHERE user_id = ? AND id NOT IN (
                SELECT id FROM device_keys WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ${MAX_KEYS_PER_USER})`).run(user.id, user.id);
  return id;
}

// "<veri>.<anahtar>.<imza>" (base64url) biçimindeki taşınan sözü doğrular; yazarı ve sözü döndürür.
export async function openRelay(db, payload) {
  const parts = String(payload ?? '').split('.');
  if (parts.length !== 3 || !parts.every((p) => B64URL.test(p)) || parts[0].length > 4000) throw new HttpError(400, 'bad_relay');
  const [data, keyId, signature] = parts;
  const key = db.prepare('SELECT k.public_jwk, u.* FROM device_keys k JOIN users u ON u.id = k.user_id WHERE k.id = ?').get(keyId);
  if (!key) throw new HttpError(400, 'unknown_key');
  const publicKey = await webcrypto.subtle.importKey('jwk', JSON.parse(key.public_jwk), ALG, false, ['verify']);
  const bytes = Buffer.from(data, 'base64url');
  const ok = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, Buffer.from(signature, 'base64url'), bytes);
  if (!ok) throw new HttpError(400, 'bad_signature');
  let item;
  try {
    item = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new HttpError(400, 'bad_relay');
  }
  if (!item || typeof item !== 'object') throw new HttpError(400, 'bad_relay');
  const author = { id: key.id, handle: key.handle, isGuest: Boolean(key.is_guest), banned: key.banned_at != null };
  // Kısa alan adları QR'a sığsın diye; burada çevrimdışı söz biçimine açılır. "n" (mekân adı) ve
  // "u" (yazar) yalnızca taşıyanın ekranı içindir, sunucu kendi kaydına bakar.
  return {
    author,
    body: {
      clientId: item.c,
      text: item.t,
      placeId: item.p,
      heardAt: item.h,
      visibility: item.v === 'p' ? 'public' : 'local',
      anonymous: Boolean(item.a),
      ephemeral: Boolean(item.e),
      fix: item.f ?? null,
    },
  };
}
