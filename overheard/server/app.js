import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { HttpError, parseCookies, sendJson } from './http.js';
import { Router } from './router.js';
import { sessionUser } from './auth.js';
import { createEventHub } from './events.js';
import { createRateLimiter } from './ratelimit.js';
import { SESSION_COOKIE, registerApi } from './api.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const STREAMING = Symbol('streaming');

function securityHeaders(config) {
  const tiles = 'https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org';
  // Google Maps JS API'nin belgelenmiş izin listesi; yalnızca anahtar tanımlıysa açılır.
  const g = config.googleMapsKey
    ? {
      script: " 'unsafe-eval' https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com https://*.googleusercontent.com blob:",
      img: ' https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.googleusercontent.com',
      style: ' https://fonts.googleapis.com',
      connect: ' https://*.googleapis.com https://*.google.com https://*.gstatic.com data: blob:',
      font: ' https://fonts.gstatic.com',
      frame: ' https://*.google.com',
    }
    : { script: '', img: '', style: '', connect: '', font: '', frame: '' };
  return {
    'content-security-policy': [
      "default-src 'self'",
      `img-src 'self' data: blob: ${tiles}${g.img}`,
      // Leaflet ve Google Maps işaretçileri konumlandırmak için satır içi stil kullanır.
      `style-src 'self' 'unsafe-inline'${g.style}`,
      `script-src 'self'${g.script}`,
      `connect-src 'self'${g.connect}`,
      `font-src 'self'${g.font}`,
      `frame-src${g.frame || " 'none'"}`,
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'geolocation=(self), camera=(), microphone=()',
    // HTTPS arkasında tarayıcı bir yıl boyunca yalnızca HTTPS kullansın.
    ...(config.secureCookies ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}

const VERSION = '0.2.0';

export function createApp({ db, config, ai = null }) {
  const router = new Router();
  const events = createEventHub();
  const rateLimit = createRateLimiter();
  const api = registerApi(router, { db, config, events, rateLimit, ai });
  const headers = securityHeaders(config);

  async function serveStatic(req, res, pathname) {
    let rel;
    try {
      rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
    } catch {
      return sendJson(res, 400, { error: 'bad_path' });
    }
    if (rel.split(sep).includes('..')) return sendJson(res, 400, { error: 'bad_path' });
    let file = join(config.publicDir, rel || 'index.html');
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = join(file, 'index.html');
      info = await stat(file).catch(() => null);
    }
    // Uzantısız bilinmeyen yollar uygulamanın kendisine düşer (tek sayfa uygulama).
    if (!info && !extname(rel)) {
      file = join(config.publicDir, 'index.html');
      info = await stat(file).catch(() => null);
    }
    if (!info) return sendJson(res, 404, { error: 'not_found' });

    const type = MIME[extname(file)] || 'application/octet-stream';
    const isShell = file.endsWith('.html') || file.endsWith('sw.js') || file.endsWith('.webmanifest');
    res.writeHead(200, {
      ...headers,
      'content-type': type,
      'content-length': info.size,
      'cache-control': isShell ? 'no-cache' : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    // Yük dengeleyici / konteyner sağlık denetimi.
    if (pathname === '/healthz') {
      try {
        db.prepare('SELECT 1').get();
        return sendJson(res, 200, { ok: true, version: VERSION, demo: config.demoMode });
      } catch {
        return sendJson(res, 503, { ok: false });
      }
    }

    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method_not_allowed' });
      return serveStatic(req, res, pathname);
    }

    const cookiesToSet = [];
    try {
      // Durum değiştiren isteklerde Origin başka bir siteyse reddet.
      if (req.method !== 'GET' && req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (origin.host !== req.headers.host) throw new HttpError(403, 'bad_origin');
      }
      const match = router.match(req.method, pathname);
      if (!match) throw new HttpError(404, 'not_found');
      if (match.allowed) throw new HttpError(405, 'method_not_allowed');

      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE] || null;
      const ctx = {
        req,
        res,
        url,
        params: match.params,
        token,
        user: sessionUser(db, token),
        setCookie: (c) => cookiesToSet.push(c),
        STREAMING,
      };
      const result = await match.handler(ctx);
      if (result === STREAMING) return;
      sendJson(res, 200, result ?? { ok: true }, cookiesToSet.length ? { 'set-cookie': cookiesToSet } : {});
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.code, ...err.extra }, cookiesToSet.length ? { 'set-cookie': cookiesToSet } : {});
      } else {
        console.error(err);
        sendJson(res, 500, { error: 'server_error' });
      }
    }
  }

  return { handler, events, tickVenues: api.tickVenues, close: () => events.close() };
}
