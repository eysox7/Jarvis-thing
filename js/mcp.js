// MCP (Model Context Protocol) istemcisi — tarayıcıdan uzak MCP sunucularına bağlanır.
//
// Neden "uzak"? Tarayıcı sandbox'ı yerel stdio süreçlerini başlatamaz; yalnızca ağ
// üzerinden HTTP(S) konuşabilir. Bu yüzden MCP'nin "Streamable HTTP" taşımasını kullanırız:
// tek bir uç noktaya JSON-RPC POST'ları atılır, yanıt ya düz JSON ya da SSE akışı olur.
// (stdio tabanlı yerel sunucular için kullanıcı bir HTTP köprüsü çalıştırmalı; ör.
//  `mcp-proxy` veya sunucunun kendi `--transport http` kipi.)
//
// Dışa açtığımız araç adı: mcp__<sunucu>__<araç> — böylece yerleşik araçlarla çakışmaz
// ve ajan hangi sunucudan geldiğini görür.

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'N.E.X.U.S.', version: '1.1.0' };

// Sunucu başına kalıcı olmayan oturum durumu (yeniden yüklemede sıfırlanır).
const sessions = new Map(); // serverId -> { sessionId, protocolVersion }

let rpcId = 0;

const trimSlash = (u) => String(u || '').replace(/\/+$/, '');

function withProxy(url, proxy) {
  if (!proxy) return url;
  return proxy.includes('{url}') ? proxy.replace('{url}', encodeURIComponent(url))
       : proxy.endsWith('=') ? proxy + encodeURIComponent(url)
       : trimSlash(proxy) + '/' + url;
}

/** mcp__sunucu__araç adını parçalarına ayırır. */
export function parseToolName(name) {
  const m = /^mcp__(.+?)__(.+)$/.exec(String(name || ''));
  return m ? { server: m[1], tool: m[2] } : null;
}

/** Sunucu adından güvenli bir ön ek üretir (araç adı için). */
export function serverSlug(name) {
  return String(name || 'mcp').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'mcp';
}

/** SSE gövdesinden ilk JSON-RPC yanıt nesnesini çıkarır. */
async function readSse(res, wantId) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let dataLines = [];
  const flush = () => {
    if (!dataLines.length) return null;
    const payload = dataLines.join('\n');
    dataLines = [];
    try { return JSON.parse(payload); } catch { return null; }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') {
        const obj = flush();
        if (obj && (obj.id === wantId || obj.error || obj.result !== undefined)) {
          try { reader.cancel(); } catch { /* yoksay */ }
          return obj;
        }
        continue;
      }
      if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      // event:, id:, retry:, yorum (:) satırlarını atla
    }
  }
  return flush();
}

/**
 * Tek bir JSON-RPC isteği gönderir ve yanıtı çözer. Bildirimlerde (id yok) yanıt beklenmez.
 * @returns {Promise<any>} result alanı
 */
async function rpc(server, method, params, { proxy, notification = false } = {}) {
  const id = notification ? undefined : ++rpcId;
  const body = { jsonrpc: '2.0', method, ...(params ? { params } : {}) };
  if (!notification) body.id = id;

  const sess = sessions.get(server.id) || {};
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(server.headers || {}),
  };
  if (sess.sessionId) headers['mcp-session-id'] = sess.sessionId;
  if (method !== 'initialize') headers['mcp-protocol-version'] = sess.protocolVersion || PROTOCOL_VERSION;

  let res;
  try {
    res = await fetch(withProxy(server.url, proxy), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`MCP sunucusuna ulaşılamadı (${server.name || server.url}). CORS engeli veya yanlış adres olabilir. ${e.message}`);
  }

  // Oturum kimliğini yakala (initialize yanıtında gelir).
  const sid = res.headers.get('mcp-session-id') || res.headers.get('Mcp-Session-Id');
  if (sid) sessions.set(server.id, { ...sessions.get(server.id), sessionId: sid });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch { /* yoksay */ }
    throw new Error(`MCP HTTP ${res.status} (${method})${detail ? ': ' + detail : ''}`);
  }

  if (notification) { try { await res.body?.cancel(); } catch { /* yoksay */ } return null; }

  const ct = res.headers.get('content-type') || '';
  let msg;
  if (ct.includes('text/event-stream')) msg = await readSse(res, id);
  else {
    const text = await res.text();
    try { msg = JSON.parse(text); } catch { throw new Error(`MCP yanıtı çözümlenemedi (${method}): ${text.slice(0, 200)}`); }
  }

  if (!msg) throw new Error(`MCP boş yanıt (${method})`);
  if (msg.error) throw new Error(`MCP hata (${method}): ${msg.error.message || JSON.stringify(msg.error)}`);
  return msg.result;
}

/**
 * Sunucuya el sıkışır ve araç listesini çeker.
 * @returns {Promise<{tools:object[], serverInfo:object, protocolVersion:string}>}
 */
export async function connect(server, proxy = '') {
  sessions.delete(server.id); // temiz başla
  const init = await rpc(server, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  }, { proxy });

  const negotiated = init?.protocolVersion || PROTOCOL_VERSION;
  sessions.set(server.id, { ...sessions.get(server.id), protocolVersion: negotiated });

  // Protokol gereği: initialize sonrası "initialized" bildirimi.
  try { await rpc(server, 'notifications/initialized', undefined, { proxy, notification: true }); } catch { /* bazı sunucular önemsemez */ }

  const listed = await rpc(server, 'tools/list', {}, { proxy });
  const tools = Array.isArray(listed?.tools) ? listed.tools : [];
  return { tools, serverInfo: init?.serverInfo || {}, protocolVersion: negotiated };
}

/**
 * Bir MCP aracını çalıştırır.
 * @returns {Promise<{content:any, isError:boolean}>}
 */
export async function callTool(server, toolName, args, proxy = '') {
  // Oturum yoksa (yeniden yükleme sonrası) sessizce yeniden bağlan.
  if (!sessions.get(server.id)?.sessionId && !sessions.get(server.id)?.protocolVersion) {
    await connect(server, proxy);
  }
  let result;
  try {
    result = await rpc(server, 'tools/call', { name: toolName, arguments: args || {} }, { proxy });
  } catch (e) {
    // Oturum düşmüş olabilir (404/400); bir kez yeniden bağlanıp dene.
    if (/HTTP (400|404)/.test(e.message)) {
      await connect(server, proxy);
      result = await rpc(server, 'tools/call', { name: toolName, arguments: args || {} }, { proxy });
    } else {
      throw e;
    }
  }
  return normalizeToolResult(result);
}

/** MCP araç çıktısını sade, modele verilebilir bir biçime indirger. */
function normalizeToolResult(result) {
  if (!result || typeof result !== 'object') return { content: result, isError: false };
  const parts = Array.isArray(result.content) ? result.content : [];
  const texts = [];
  const other = [];
  for (const p of parts) {
    if (p?.type === 'text') texts.push(p.text);
    else if (p?.type === 'resource' && p.resource?.text) texts.push(p.resource.text);
    else other.push(p);
  }
  const out = {};
  if (texts.length) out.text = texts.join('\n');
  if (result.structuredContent !== undefined) out.data = result.structuredContent;
  if (other.length) out.parts = other;
  if (!Object.keys(out).length) out.content = result.content;
  return { content: out, isError: !!result.isError };
}

/** Oturum önbelleğini temizler (sunucu silinince/güncellenince). */
export function forget(serverId) { sessions.delete(serverId); }
