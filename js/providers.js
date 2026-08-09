// Sağlayıcı katmanı: her servisi tek bir arayüze indirger.
//   chat({system, messages}) -> {text}
// Dört "tür" var: openai (OpenAI-uyumlu /chat/completions), gemini, anthropic, ollama.
// Yeni servis eklemek = PRESETS'e bir satır yazmak.

export const KINDS = ['openai', 'gemini', 'anthropic', 'ollama'];

export const PRESETS = {
  groq: {
    label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'qwen/qwen3-32b'],
    keyUrl: 'https://console.groq.com/keys',
  },
  gemini: {
    label: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  openai: {
    label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    label: 'Anthropic (Claude)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  openrouter: {
    label: 'OpenRouter (yüzlerce model)', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'anthropic/claude-sonnet-4.5', 'meta-llama/llama-3.3-70b-instruct'],
    keyUrl: 'https://openrouter.ai/keys',
  },
  mistral: {
    label: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-small-latest', 'open-mistral-nemo'],
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  deepseek: {
    label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'], keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  xai: {
    label: 'xAI (Grok)', kind: 'openai', baseUrl: 'https://api.x.ai/v1',
    models: ['grok-4', 'grok-3-mini'], keyUrl: 'https://console.x.ai',
  },
  together: {
    label: 'Together AI', kind: 'openai', baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'], keyUrl: 'https://api.together.ai/settings/api-keys',
  },
  cerebras: {
    label: 'Cerebras', kind: 'openai', baseUrl: 'https://api.cerebras.ai/v1',
    models: ['llama-3.3-70b', 'qwen-3-32b'], keyUrl: 'https://cloud.cerebras.ai',
  },
  fireworks: {
    label: 'Fireworks', kind: 'openai', baseUrl: 'https://api.fireworks.ai/inference/v1',
    models: ['accounts/fireworks/models/llama-v3p3-70b-instruct'], keyUrl: 'https://fireworks.ai/account/api-keys',
  },
  perplexity: {
    label: 'Perplexity (web erişimli)', kind: 'openai', baseUrl: 'https://api.perplexity.ai',
    models: ['sonar', 'sonar-pro'], keyUrl: 'https://www.perplexity.ai/settings/api',
  },
  nvidia: {
    label: 'NVIDIA NIM', kind: 'openai', baseUrl: 'https://integrate.api.nvidia.com/v1',
    models: ['meta/llama-3.3-70b-instruct'], keyUrl: 'https://build.nvidia.com',
  },
  ollama: {
    label: 'Ollama (yerel)', kind: 'ollama', baseUrl: 'http://localhost:11434',
    models: ['llama3.2', 'qwen2.5'], keyUrl: '', noKey: true,
  },
  lmstudio: {
    label: 'LM Studio (yerel)', kind: 'openai', baseUrl: 'http://localhost:1234/v1',
    models: [], keyUrl: '', noKey: true,
  },
  custom: {
    label: 'Özel / diğer (OpenAI-uyumlu)', kind: 'openai', baseUrl: '', models: [], keyUrl: '',
  },
};

export class ApiError extends Error {
  constructor(message, { status, provider, body } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status; this.provider = provider; this.body = body;
  }
}

const trimSlash = (u) => String(u || '').replace(/\/+$/, '');

function withProxy(url, proxy) {
  if (!proxy) return url;
  return proxy.includes('{url}') ? proxy.replace('{url}', encodeURIComponent(url))
       : proxy.endsWith('=') ? proxy + encodeURIComponent(url)
       : trimSlash(proxy) + '/' + url;
}

function headersFor(profile) {
  const h = { 'content-type': 'application/json', ...(profile.extraHeaders || {}) };
  const key = profile.apiKey || '';
  const kind = profile.kind || PRESETS[profile.provider]?.kind || 'openai';
  if (kind === 'anthropic') {
    if (key) h['x-api-key'] = key;
    h['anthropic-version'] = '2023-06-01';
    // Tarayıcıdan doğrudan çağrı için gerekli.
    h['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (kind === 'openai') {
    if (key) h['authorization'] = 'Bearer ' + key;
    if (profile.provider === 'openrouter') {
      h['HTTP-Referer'] = location.origin;
      h['X-Title'] = 'N.E.X.U.S.';
    }
  }
  return h;
}

export function kindOf(profile) {
  return profile.kind || PRESETS[profile.provider]?.kind || 'openai';
}

export function baseOf(profile) {
  return trimSlash(profile.baseUrl || PRESETS[profile.provider]?.baseUrl || '');
}

async function readError(res) {
  let body = '';
  try { body = await res.text(); } catch { /* yoksay */ }
  let msg = body;
  try {
    const j = JSON.parse(body);
    msg = j.error?.message || j.error?.type || j.message || j.detail || body;
  } catch { /* düz metin */ }
  return { msg: String(msg || '').slice(0, 400), body };
}

/* -------------------- istek gövdeleri -------------------- */

function buildOpenAI(profile, { system, messages, temperature, maxTokens, stream }) {
  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  for (const m of messages) msgs.push({ role: m.role, content: m.content });
  const body = { model: profile.model, messages: msgs, stream: !!stream };
  if (temperature !== undefined) body.temperature = temperature;
  if (maxTokens) body.max_tokens = maxTokens;
  if (stream) body.stream_options = undefined; // bazı sağlayıcılar tanımıyor, göndermiyoruz
  return { url: `${baseOf(profile)}/chat/completions`, body };
}

function buildGemini(profile, { system, messages, temperature, maxTokens, stream }) {
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const body = {
    contents,
    generationConfig: {
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const method = stream ? 'streamGenerateContent?alt=sse&' : 'generateContent?';
  const url = `${baseOf(profile)}/models/${encodeURIComponent(profile.model)}:${method}key=${encodeURIComponent(profile.apiKey || '')}`;
  return { url, body };
}

function buildAnthropic(profile, { system, messages, temperature, maxTokens, stream }) {
  const body = {
    model: profile.model,
    max_tokens: maxTokens || 4096,
    messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    stream: !!stream,
  };
  if (system) body.system = system;
  if (temperature !== undefined) body.temperature = temperature;
  return { url: `${baseOf(profile)}/messages`, body };
}

function buildOllama(profile, { system, messages, temperature, stream }) {
  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  msgs.push(...messages.map((m) => ({ role: m.role, content: m.content })));
  return {
    url: `${baseOf(profile)}/api/chat`,
    body: { model: profile.model, messages: msgs, stream: !!stream, options: { temperature } },
  };
}

const BUILDERS = { openai: buildOpenAI, gemini: buildGemini, anthropic: buildAnthropic, ollama: buildOllama };

/* -------------------- yanıt çözümleme -------------------- */

function textFromFull(kind, data) {
  if (kind === 'openai') return data.choices?.[0]?.message?.content ?? '';
  if (kind === 'gemini') {
    const parts = data.candidates?.[0]?.content?.parts || [];
    return parts.map((p) => p.text || '').join('');
  }
  if (kind === 'anthropic') return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (kind === 'ollama') return data.message?.content ?? '';
  return '';
}

function deltaFromChunk(kind, obj) {
  if (kind === 'openai') return obj.choices?.[0]?.delta?.content ?? '';
  if (kind === 'gemini') return (obj.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (kind === 'anthropic') return obj.type === 'content_block_delta' ? (obj.delta?.text ?? '') : '';
  if (kind === 'ollama') return obj.message?.content ?? '';
  return '';
}

/** SSE / NDJSON akışını satır satır JSON nesnelerine çevirir. */
async function* streamObjects(res, kind) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let payload = line;
      if (line.startsWith('data:')) payload = line.slice(5).trim();
      else if (line.startsWith('event:') || line.startsWith(':')) continue;
      else if (kind !== 'ollama' && !line.startsWith('{')) continue;
      if (payload === '[DONE]') return;
      try { yield JSON.parse(payload); } catch { /* parçalı satır, atla */ }
    }
  }
}

/* -------------------- ana giriş noktaları -------------------- */

/**
 * Tek bir profille sohbet çağrısı.
 * @returns {Promise<{text:string, profile:object}>}
 */
export async function chat(profile, opts = {}) {
  const kind = kindOf(profile);
  const { onDelta, signal, proxy } = opts;
  const wantStream = !!opts.stream && typeof onDelta === 'function';
  const built = BUILDERS[kind](profile, { ...opts, stream: wantStream });

  const url = withProxy(built.url, proxy);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: headersFor(profile),
      body: JSON.stringify(built.body),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(
      `Ağa ulaşılamadı (${profile.name || profile.provider}). CORS engeli, yanlış adres veya internet sorunu olabilir.`,
      { provider: profile.provider },
    );
  }

  if (!res.ok) {
    const { msg, body } = await readError(res);
    const hint = res.status === 401 || res.status === 403 ? ' → API anahtarını kontrol et.'
      : res.status === 404 ? ' → model adı veya adres yanlış olabilir.'
      : res.status === 429 ? ' → kota/hız limiti doldu.'
      : '';
    throw new ApiError(`${profile.name || profile.provider}: HTTP ${res.status} ${msg}${hint}`,
      { status: res.status, provider: profile.provider, body });
  }

  if (wantStream && res.body) {
    let text = '';
    for await (const obj of streamObjects(res, kind)) {
      if (obj.error) throw new ApiError(obj.error.message || 'akış hatası', { provider: profile.provider });
      const d = deltaFromChunk(kind, obj);
      if (d) { text += d; onDelta(d, text); }
    }
    return { text, profile };
  }

  const data = await res.json();
  if (data.error) throw new ApiError(data.error.message || 'sağlayıcı hatası', { provider: profile.provider });
  return { text: textFromFull(kind, data), profile };
}

/**
 * Zincir: ilk profil hata verirse sıradakine geçer.
 * @param {object[]} profiles
 */
export async function chatWithFallback(profiles, opts = {}) {
  const errors = [];
  for (const p of profiles) {
    if (!p.model) { errors.push(`${p.name}: model seçilmemiş`); continue; }
    try {
      opts.onProfileStart?.(p, errors.length > 0);
      const out = await chat(p, opts);
      if (!out.text?.trim()) throw new ApiError(`${p.name}: boş yanıt döndü`, { provider: p.provider });
      return out;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      errors.push(e.message);
      opts.onProfileFail?.(p, e);
    }
  }
  throw new ApiError(
    errors.length ? 'Hiçbir bağlantı yanıt vermedi:\n• ' + errors.join('\n• ')
                  : 'Tanımlı bir API bağlantısı yok. "API" sekmesinden bir bağlantı ekle.',
  );
}

/** Sağlayıcıdan model listesini çeker. */
export async function listModels(profile, proxy = '') {
  const kind = kindOf(profile);
  const base = baseOf(profile);
  let url, headers = headersFor(profile);
  if (kind === 'gemini') url = `${base}/models?key=${encodeURIComponent(profile.apiKey || '')}`;
  else if (kind === 'ollama') url = `${base}/api/tags`;
  else url = `${base}/models`;

  const res = await fetch(withProxy(url, proxy), { headers });
  if (!res.ok) {
    const { msg } = await readError(res);
    throw new ApiError(`Model listesi alınamadı: HTTP ${res.status} ${msg}`, { status: res.status });
  }
  const data = await res.json();
  let ids = [];
  if (kind === 'gemini') {
    ids = (data.models || [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => String(m.name).replace(/^models\//, ''));
  } else if (kind === 'ollama') {
    ids = (data.models || []).map((m) => m.name);
  } else {
    ids = (data.data || data.models || []).map((m) => m.id || m.name).filter(Boolean);
  }
  return [...new Set(ids)].sort();
}

/** Hızlı bağlantı testi. */
export async function testProfile(profile, proxy = '') {
  const t0 = performance.now();
  const { text } = await chat(profile, {
    system: 'Kısa cevap ver.',
    messages: [{ role: 'user', content: 'Bağlantı testi. Sadece "hazır" yaz.' }],
    maxTokens: 32, temperature: 0, proxy,
  });
  return { ms: Math.round(performance.now() - t0), text: text.trim().slice(0, 80) };
}
