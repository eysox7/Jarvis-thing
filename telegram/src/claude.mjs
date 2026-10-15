// Claude Messages API katmanı (resmî @anthropic-ai/sdk).
//
// Token tasarrufu burada:
//  - Geçmiş yalnızca metin olarak gider; düşünme blokları ve eski ekler tekrar gönderilmez.
//  - Önbellek (prompt caching): aynı önek art arda gelen mesajlarda ~%95 ucuza okunur.
//  - Efor varsayılan "low": sohbette düşünme tokenlarını kısar; /efor ile değişir.
//  - Damıtma (distill): eski mesajlar kompakt hafıza + özete indirilir.
//  - Sohbet istekleri akışlı (stream) gider: yüksek eforda uzun düşünme zaman aşımına uğramaz.

import Anthropic from '@anthropic-ai/sdk';

// $ / 1M token: [giriş, çıkış, önbellekten okuma]. Önbelleğe yazma = giriş × 1.25.
// Yalnızca tahmin içindir; kesin fatura için Console.
const PRICES = {
  'claude-fable-5-1': [10, 50, 0.25],
  'claude-fable-5': [10, 50, 1],
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-opus-5': [5, 25, 0.5],
  'claude-opus-4-8': [5, 25, 0.5],
  'claude-sonnet-5-5': [2, 10, 0.2],
  'claude-sonnet-5': [2, 10, 0.2],
  'claude-sonnet-4-6': [3, 15, 0.3],
  'claude-haiku-5-5': [0.1, 0.5, 0.01],
  'claude-haiku-4-5': [1, 5, 0.1],
};
const WEB_SEARCH_USD = 0.01;

// Sunucu tarafı yedek model (güvenlik filtresi reddederse aynı istek başka modelde koşar).
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
// Dinamik filtreli web araması (daha az sonuç tokenı) bu modellerde var.
const WEB_DYNAMIC = /^claude-(opus-(5-5|5|4-8|4-7|4-6)|sonnet-(5-5|5|4-6))$/;
const NO_EFFORT = /^claude-(haiku-4|sonnet-4-5|opus-4-1|opus-4-0|sonnet-4-0|3)/;

export function emptyUsage() {
  return { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0, costUsd: 0 };
}

export function addUsage(total, u) {
  for (const k of Object.keys(emptyUsage())) total[k] = (total[k] || 0) + (u[k] || 0);
  return total;
}

function usageOf(res, fallbackModel) {
  const u = res.usage || {};
  const out = {
    requests: 1,
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0,
    webSearches: u.server_tool_use?.web_search_requests || 0,
  };
  const p = PRICES[res.model] || PRICES[fallbackModel];
  out.costUsd = p
    ? (out.input * p[0] + out.output * p[1] + out.cacheRead * p[2] + out.cacheWrite * p[0] * 1.25) / 1e6 +
      out.webSearches * WEB_SEARCH_USD
    : 0;
  return out;
}

const textOf = (content) => content.filter((b) => b.type === 'text').map((b) => b.text).join('');

export function renderTranscript(turns) {
  return turns.map((t) => `${t.role === 'user' ? 'Kullanıcı' : 'Asistan'}: ${t.text}`).join('\n\n');
}

export function parseDistill(text, maxItems = 40) {
  const mem = text.match(/<hafiza>([\s\S]*?)<\/hafiza>/i);
  const sum = text.match(/<ozet>([\s\S]*?)<\/ozet>/i);
  if (!mem || !sum) throw new Error('Damıtma çıktısı beklenen biçimde değil.');
  const seen = new Set();
  const memory = mem[1]
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim())
    .filter((l) => l && l !== '...' && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()))
    .slice(0, maxItems);
  const summary = sum[1].trim() === '...' ? '' : sum[1].trim();
  return { memory, summary };
}

export class Claude {
  constructor(cfg, skill) {
    this.cfg = cfg;
    this.skill = skill;
    this.disabled = new Set(); // API'nin reddettiği isteğe bağlı özellikler (web, fallbacks, strict)
    this.client = new Anthropic({
      apiKey: cfg.anthropicKey,
      baseURL: cfg.anthropicBaseURL,
      maxRetries: 2,
      timeout: 300_000,
    });
  }

  // Ortak istek gövdesi. tools: istemci araçları (hatırlatma); web: sunucu tarafı web araması.
  request(model, { system, messages, effort, maxTokens, web, cache, tools = [] }) {
    const req = { model, max_tokens: maxTokens, system, messages };
    const betas = [];
    if (effort && !NO_EFFORT.test(model)) req.output_config = { effort };
    if (cache) req.cache_control = { type: 'ephemeral' };
    const all = this.disabled.has('strict') ? tools.map(({ strict, ...t }) => t) : [...tools];
    if (web && !this.disabled.has('web')) {
      all.push({
        type: WEB_DYNAMIC.test(model) ? 'web_search_20260209' : 'web_search_20250305',
        name: 'web_search',
        max_uses: this.cfg.webSearchMaxUses,
      });
    }
    if (all.length) req.tools = all;
    if (this.cfg.fallbacks && !this.disabled.has('fallbacks') && FALLBACK_MODELS.has(model)) {
      betas.push('server-side-fallback-2026-07-01');
      req.fallbacks = 'default';
    }
    if (betas.length) req.betas = betas;
    return req;
  }

  // 400 gelirse ve istekte isteğe bağlı özellik varsa (web araması, yedek model, strict araç
  // şeması) bir kez onlarsız dener; başarılı olursa onları bu çalışma boyunca kapatır.
  // İstemci araçları kalır: geçmişte tool_use blokları varken araç listesi silinemez.
  async create(req, { stream = false } = {}) {
    const send = (body) => (stream
      ? this.client.beta.messages.stream(body).finalMessage()
      : this.client.beta.messages.create(body));
    try {
      return await send(req);
    } catch (e) {
      const isWeb = (t) => /^web_search/.test(t.type || '');
      const optional = [
        req.tools?.some(isWeb) && 'web',
        req.fallbacks && 'fallbacks',
        req.tools?.some((t) => t.strict) && 'strict',
      ].filter(Boolean);
      if (!(e instanceof Anthropic.BadRequestError) || !optional.length) throw e;
      const bare = { ...req };
      const tools = (req.tools || []).filter((t) => !isWeb(t)).map(({ strict, ...t }) => t);
      if (tools.length) bare.tools = tools;
      else delete bare.tools;
      delete bare.fallbacks;
      delete bare.betas;
      const res = await send(bare);
      // Aynı turun sonraki istekleri de (araç sonucu, pause_turn) özelliksiz gitsin.
      for (const k of ['tools', 'fallbacks', 'betas']) delete req[k];
      Object.assign(req, bare);
      for (const f of optional) this.disabled.add(f);
      console.warn(`[claude] API şu özellikleri reddetti, kapatıldı: ${optional.join(', ')} — ${e.message}`);
      return res;
    }
  }

  // Bir sohbet turu. runTool(name, input) istemci araçlarını çalıştırır.
  // Tur içinde yanıt içeriği (düşünme blokları dahil) aynen geri gönderilir;
  // tur bitince yalnızca son metin geçmişe girer.
  async chat({ system, messages, effort, web, tools = [], runTool }) {
    const model = this.cfg.model;
    const req = this.request(model, {
      system, messages, effort, web, tools, maxTokens: this.cfg.maxTokens, cache: this.cfg.promptCache,
    });
    const usage = emptyUsage();
    const sources = new Map();
    let text = '';
    let res;
    let promptTokens = 0;
    for (let i = 0; i < 8; i++) {
      res = await this.create(req, { stream: true });
      addUsage(usage, usageOf(res, model));
      if (i === 0) {
        const u = res.usage || {};
        promptTokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      }
      if (res.stop_reason === 'refusal') return { refused: true, text: '', usage, promptTokens, sources: [] };
      for (const b of res.content) {
        if (b.type !== 'text') continue;
        text += b.text;
        for (const c of b.citations || []) if (c.url && !sources.has(c.url)) sources.set(c.url, c.title || c.url);
      }
      req.messages = [...req.messages, { role: 'assistant', content: res.content }];
      if (res.stop_reason === 'tool_use' && runTool) {
        // Araç öncesi metin ön sözdür; kullanıcıya yalnızca sonuç gider.
        text = '';
        const calls = res.content.filter((b) => b.type === 'tool_use');
        const results = await Promise.all(calls.map(async (c) => {
          try {
            return { type: 'tool_result', tool_use_id: c.id, content: String(await runTool(c.name, c.input || {})) };
          } catch (e) {
            return { type: 'tool_result', tool_use_id: c.id, content: e.message, is_error: true };
          }
        }));
        req.messages = [...req.messages, { role: 'user', content: results }];
        continue;
      }
      // pause_turn: sunucu tarafı araç döngüsü durakladı; aynı turu kaldığı yerden sürdür.
      if (res.stop_reason !== 'pause_turn') break;
    }
    return {
      refused: false,
      text: text.trim(),
      truncated: res.stop_reason === 'max_tokens',
      usage,
      promptTokens,
      sources: [...sources].map(([url, title]) => ({ url, title })),
      model: res.model,
    };
  }

  // Eski mesajları hafıza + özete damıtır. Kurallar: skill'in references/damitma.md dosyası.
  async distill({ memory, summary, turns, closing = false }) {
    const model = this.cfg.memoryModel;
    const parts = [
      `<mevcut_hafiza>\n${memory.map((m) => `- ${m}`).join('\n')}\n</mevcut_hafiza>`,
      `<mevcut_ozet>\n${summary}\n</mevcut_ozet>`,
      `<konusma>\n${renderTranscript(turns)}\n</konusma>`,
    ];
    if (closing) {
      parts.push('<not>Kullanıcı bu konuyu kapattı. Özete yalnızca açık kalan işleri yaz; yoksa boş bırak.</not>');
    }
    const req = this.request(model, {
      system: this.skill.distill,
      messages: [{ role: 'user', content: parts.join('\n\n') }],
      effort: 'low',
      maxTokens: 8000,
    });
    const res = await this.create(req);
    const usage = usageOf(res, model);
    if (res.stop_reason === 'refusal') throw Object.assign(new Error('Damıtma reddedildi.'), { usage });
    try {
      return { ...parseDistill(textOf(res.content), this.cfg.memoryMaxItems), usage };
    } catch (e) {
      e.usage = usage;
      throw e;
    }
  }

  // Ücretsiz kontrol: anahtar ve model geçerli mi?
  checkModel() {
    return this.client.models.retrieve(this.cfg.model);
  }
}
