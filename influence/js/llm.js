// Nöral klon: telefonda (WebGPU) çalışan küçük dil modeli. İki arka uç:
//   webllm → model telefona indirilir, tamamen cihazda çalışır (varsayılan)
//   server → aynı ağdaki Ollama / LM Studio (OpenAI uyumlu uç nokta)
import { S } from './store.js';

const WEBLLM_URL = 'https://esm.run/@mlc-ai/web-llm@0.2.84';

export const MODELS = [
  { id: 'gemma3-1b-it-q4f16_1-MLC', label: 'Hafif · Gemma 3 1B', size: '~0,7 GB', note: 'eski/orta telefonlar' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Dengeli · Qwen2.5 1.5B', size: '~1,6 GB', note: 'önerilen' },
  { id: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Güçlü · Qwen3 1.7B', size: '~2 GB', note: '8 GB+ RAM' },
];

let engine = null, engineModel = null, loading = null;
export const state = { status: 'idle', progress: 0, text: '' };

export const webgpu = () => 'gpu' in navigator;
const fake = () => (typeof window.__INFLUENCE_FAKE_LLM__ === 'function' ? window.__INFLUENCE_FAKE_LLM__ : null);

export function ready() {
  if (fake()) return true;
  if (S.settings.backend === 'server') return !!S.settings.serverUrl;
  return !!engine && engineModel === S.settings.model;
}

export async function load(onProgress = () => {}) {
  if (fake() || S.settings.backend === 'server') return true;
  if (ready()) return true;
  if (!webgpu()) throw new Error('Bu tarayıcıda WebGPU yok. Chrome (Android) veya Safari 26+ (iOS) gerekir.');
  if (loading) return loading;
  const model = S.settings.model;
  state.status = 'loading';
  loading = (async () => {
    try {
      if (engine) { try { await engine.unload(); } catch { /* önemsiz */ } }
      const { CreateWebWorkerMLCEngine } = await import(WEBLLM_URL);
      const worker = new Worker(new URL('./llm-worker.js', import.meta.url), { type: 'module' });
      engine = await CreateWebWorkerMLCEngine(worker, model, {
        initProgressCallback: (r) => { state.progress = r.progress; state.text = r.text; onProgress(r.progress, r.text); },
      });
      engineModel = model;
      state.status = 'ready';
      return true;
    } catch (e) {
      state.status = 'error'; state.text = e.message;
      engine = null; engineModel = null;
      throw e;
    } finally { loading = null; }
  })();
  return loading;
}

export async function complete(messages, { temperature = 0.2, max_tokens = 120 } = {}) {
  const f = fake();
  if (f) return await f(messages);
  if (S.settings.backend === 'server') {
    const res = await fetch(S.settings.serverUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: S.settings.serverModel, messages, temperature, max_tokens, stream: false }),
    });
    if (!res.ok) throw new Error('Yerel sunucu: HTTP ' + res.status);
    const j = await res.json();
    return j.choices?.[0]?.message?.content || '';
  }
  if (!ready()) throw new Error('Model yüklü değil');
  const r = await engine.chat.completions.create({
    messages, temperature, max_tokens,
    ...(engineModel.startsWith('Qwen3') ? { extra_body: { enable_thinking: false } } : {}),
  });
  return r.choices?.[0]?.message?.content || '';
}

/** "SEÇİM: A / GEREKÇE: ..." biçimini çözer; model biçimi bozsa da A/B'yi bulmaya çalışır. */
export function parseDecision(text) {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const m = t.match(/SE[ÇC][İIi]M\s*[:：\-]?\s*\**\s*\(?([AB])\b/i) || t.match(/^\s*\**\(?([AB])[).:\s]/) || t.match(/\b([AB])\)/);
  const r = t.match(/GEREK[ÇC]E\s*[:：\-]?\s*([\s\S]+)/i);
  let reason = (r ? r[1] : t.replace(/SE[ÇC][İIi]M[^\n]*\n?/i, '')).trim().split('\n')[0].replace(/^["*\s]+|["*\s]+$/g, '');
  if (reason.length > 220) reason = reason.slice(0, 217) + '…';
  return { choice: m ? m[1].toUpperCase() : null, reason };
}
