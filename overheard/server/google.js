// Google ile giriş: uygulama (Android'de Credential Manager, web'de Google Identity Services) Google'dan
// bir kimlik belgesi (ID token, RS256 imzalı JWT) alır ve sunucuya yollar. Sunucu imzayı Google'ın
// yayımladığı açık anahtarlarla doğrular; belgenin bu uygulama için (aud), Google tarafından (iss)
// verildiğini ve süresinin dolmadığını denetler. Yalnızca Google hesap kimliği (sub) saklanır; e-posta
// ve ad saklanmaz.
import { createPublicKey, verify } from 'node:crypto';
import { HttpError } from './http.js';

export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const SKEW_S = 300;

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

export function createGoogleVerifier({ clientIds = [], certsUrl = GOOGLE_CERTS_URL, fetchImpl = fetch, now = Date.now } = {}) {
  let cache = { keys: new Map(), expires: 0 };

  // Google anahtarları döndürür; önbellek süresi yanıtın Cache-Control başlığından gelir.
  async function keys(force = false) {
    if (!force && cache.expires > now()) return cache.keys;
    let res;
    try {
      res = await fetchImpl(certsUrl, { signal: AbortSignal.timeout(5000) });
    } catch {
      throw new HttpError(503, 'google_unavailable');
    }
    if (!res.ok) throw new HttpError(503, 'google_unavailable');
    const { keys: list = [] } = await res.json();
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] ?? 3600);
    cache = {
      keys: new Map(list.filter((k) => k.kty === 'RSA' && k.kid).map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })])),
      expires: now() + maxAge * 1000,
    };
    return cache.keys;
  }

  // Geçerliyse { sub, name } döner; değilse 401 google_token_invalid.
  async function verifyIdToken(token) {
    const invalid = () => new HttpError(401, 'google_token_invalid');
    const parts = String(token ?? '').split('.');
    if (parts.length !== 3 || parts.some((p) => !/^[\w-]+$/.test(p))) throw invalid();
    let header;
    let payload;
    try {
      header = decode(parts[0]);
      payload = decode(parts[1]);
    } catch {
      throw invalid();
    }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw invalid();
    // Bilinmeyen anahtar: Google anahtarlarını yenilemiş olabilir, bir kez tazelenir.
    const key = (await keys()).get(header.kid) ?? (await keys(true)).get(header.kid);
    if (!key) throw invalid();
    if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) throw invalid();
    const t = now() / 1000;
    if (!ISSUERS.has(payload.iss) || !clientIds.includes(payload.aud)) throw invalid();
    if (!(payload.exp > t - SKEW_S) || payload.iat > t + SKEW_S) throw invalid();
    if (typeof payload.sub !== 'string' || !payload.sub) throw invalid();
    if (payload.email && payload.email_verified === false) throw invalid();
    return { sub: payload.sub, name: payload.given_name || payload.name || payload.email?.split('@')[0] || null };
  }

  return { enabled: clientIds.length > 0, clientId: clientIds[0] ?? null, verifyIdToken };
}

const FOLD = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

// Google adından kullanıcı adı önerisi: "Ayşe Yılmaz" → "ayse_yilmaz" (3–16 harf, HANDLE_RE'ye uyar).
export function suggestHandle(name) {
  const base = [...String(name ?? '').toLocaleLowerCase('tr')]
    .map((ch) => FOLD[ch] ?? ch)
    .join('')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 16);
  return base.length >= 3 ? base : 'kulak';
}
