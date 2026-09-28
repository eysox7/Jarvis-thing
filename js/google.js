// Google entegrasyonu — Gmail · Takvim · Classroom · Drive'a tarayıcıdan erişim.
//
// Kimlik doğrulama: Google Identity Services (GIS) "token client" akışı. Kullanıcı bir
// Google Cloud OAuth istemci kimliği (Web tipi) girer, tek dokunuşla giriş yapar, tarayıcı
// bir erişim jetonu (access token) alır. Jeton ~1 saat geçerlidir; süresi dolunca sessizce
// yenilenmeye çalışılır. İstemci gizli anahtarı (client secret) YOKTUR — saf tarayıcı akışı.
//
// ÖNEMLİ — okul hesapları: Google Workspace for Education hesabına erişim, okulun BT
// yöneticisinin politikasına tabidir. Yönetici üçüncü taraf uygulama/OAuth erişimini
// kısıtlamışsa giriş "access_denied / admin_policy_enforced" ile reddedilir; bu bir yetki
// sınırıdır, kodla aşılamaz. Ayrıca OAuth istemcisinin "Authorized JavaScript origins"
// listesine uygulamanın adresi eklenmelidir.
//
// CORS: Google REST API'leri tarayıcıdan Bearer jetonuyla doğrudan çağrıya (CORS) izin verir.

import * as S from './store.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'nexus.gtoken';

// İstenen yetki alanları. Okuma ağırlıklı + Takvim yazma + Gmail gönderme.
// (Bazı Classroom alanları okul yöneticisinin ayrıca onayını gerektirebilir.)
export const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];

let token = '';
let expiry = 0;          // ms epoch
let grantedScopes = '';
let tokenClient = null;
let gisLoading = null;
let pending = null;      // { resolve, reject }

// Kalıcılık: jetonu (kısa ömürlü) yeniden yükleme boyunca taşı ki her açılışta
// yeniden giriş gerekmesin. Hassastır — API anahtarlarıyla aynı yerel depoda durur.
(function restore() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return;
    const j = JSON.parse(raw);
    if (j && j.token && j.expiry > Date.now()) { token = j.token; expiry = j.expiry; grantedScopes = j.scopes || ''; }
  } catch { /* yoksay */ }
})();

function persist() {
  try {
    if (token && expiry > Date.now()) localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiry, scopes: grantedScopes }));
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* yoksay */ }
}

/** GIS betiğini bir kez yükler. */
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoading) return gisLoading;
  gisLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google giriş betiği yüklenemedi (çevrimdışı olabilirsin).'));
    document.head.append(s);
  });
  return gisLoading;
}

function ensureClient() {
  const clientId = S.settings().googleClientId?.trim();
  if (!clientId) throw new Error('Google istemci kimliği ayarlı değil. Beyin sekmesi > Google bölümünden gir.');
  if (tokenClient && tokenClient._clientId === clientId) return tokenClient;
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: DEFAULT_SCOPES.join(' '),
    callback: (resp) => {
      if (resp.error) { pending?.reject(new Error(googleAuthError(resp))); pending = null; return; }
      token = resp.access_token;
      expiry = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
      grantedScopes = resp.scope || DEFAULT_SCOPES.join(' ');
      persist();
      pending?.resolve(token); pending = null;
    },
  });
  tokenClient._clientId = clientId;
  return tokenClient;
}

function googleAuthError(resp) {
  const t = resp.error;
  if (t === 'access_denied') return 'Giriş reddedildi. Okul hesabıysa yöneticin üçüncü taraf erişimini kapatmış olabilir (admin_policy_enforced).';
  if (t === 'popup_closed_by_user' || t === 'popup_failed_to_open') return 'Giriş penceresi kapandı/açılamadı. Açılır pencere iznini kontrol et.';
  return 'Google giriş hatası: ' + t;
}

/** Etkileşimli giriş (kullanıcı hareketiyle çağır). */
export async function signIn() {
  await loadGis();
  const client = ensureClient();
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    try { client.requestAccessToken({ prompt: expiry ? '' : 'consent' }); }
    catch (e) { pending = null; reject(e); }
  });
}

/** Sessiz yenileme (kullanıcı etkileşimi olmadan; başarısız olabilir). */
async function silentRefresh() {
  await loadGis();
  const client = ensureClient();
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    try { client.requestAccessToken({ prompt: '' }); }
    catch (e) { pending = null; reject(e); }
  });
}

export function signOut() {
  const t = token;
  token = ''; expiry = 0; grantedScopes = '';
  persist();
  try { if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t, () => {}); } catch { /* yoksay */ }
}

export function status() {
  return {
    connected: !!token && expiry > Date.now(),
    clientIdSet: !!S.settings().googleClientId?.trim(),
    expiresInMin: token && expiry > Date.now() ? Math.round((expiry - Date.now()) / 60000) : 0,
    scopes: grantedScopes ? grantedScopes.split(/\s+/) : [],
  };
}

/** Geçerli bir erişim jetonu döndürür; gerekiyorsa sessizce yeniler, olmazsa hata verir. */
async function getToken() {
  if (token && expiry > Date.now()) return token;
  try { return await silentRefresh(); }
  catch {
    throw new Error('Google oturumu gerekli. Beyin sekmesi > Google bölümünden "Giriş yap"a dokun.');
  }
}

/** Bearer jetonuyla Google API çağrısı; 401'de bir kez yeniler. JSON döndürür. */
export async function gfetch(url, opts = {}) {
  const proxy = S.settings().proxy;
  const u = proxy && !/^https?:\/\/(localhost|127\.)/.test(url) ? applyProxy(url, proxy) : url;
  let t = await getToken();
  let res = await fetch(u, { ...opts, headers: { authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
  if (res.status === 401) {
    token = ''; expiry = 0;
    try { t = await silentRefresh(); } catch { throw new Error('Google oturumu süresi doldu, yeniden giriş gerekli.'); }
    res = await fetch(u, { ...opts, headers: { authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error_description || text || ('HTTP ' + res.status);
    throw new Error(`Google API ${res.status}: ${msg}`);
  }
  return data;
}

function applyProxy(url, proxy) {
  return proxy.includes('{url}') ? proxy.replace('{url}', encodeURIComponent(url))
       : proxy.endsWith('=') ? proxy + encodeURIComponent(url)
       : proxy.replace(/\/+$/, '') + '/' + url;
}

/** UTF-8 güvenli base64url (Gmail gönderimi için). */
export function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// --- Test kancası: OAuth açılır penceresini atlayıp jeton enjekte etmek için. ---
export function _setToken(t, ttlSec = 3600, scopes = DEFAULT_SCOPES.join(' ')) {
  token = t; expiry = Date.now() + ttlSec * 1000; grantedScopes = scopes; persist();
}
