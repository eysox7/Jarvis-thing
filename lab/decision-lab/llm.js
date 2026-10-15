// LLM persona motoru: bir personayı kimliğiyle canlandırıp senaryoya tepkisini sorar.
// MatrAIx'in "persona-json-survey" ajanıyla aynı fikir: persona boyutları sistem istemine
// yazılır, model o kişi gibi tek bir JSON cevabı verir.
// Bağlantılar N.E.X.U.S.'un kayıtlı API profilleridir (aynı tarayıcı, aynı localStorage).

import * as store from '../../js/store.js';
import { chatWithFallback } from '../../js/providers.js';
import { describeConfig } from './scenarios.js';

export const LIKERT_P = { 1: 0.05, 2: 0.25, 3: 0.5, 4: 0.75, 5: 0.95 };

export function connections() {
  try { return store.profileChain().filter((p) => p.model); } catch { return []; }
}

function personaBlock(p) {
  const dims = Object.entries(p.dims || {}).map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`).join('\n');
  return `Name: ${p.name}\nAttributes (from a population survey panel):\n${dims || '- (none)'}`;
}

const SYSTEM = (p) => `You are role-playing one specific member of the public in a research simulation.
Stay fully in character as the person described below: their circumstances, values, budget and habits.
Answer as this person honestly would — including indifference, distrust, or opposition when it fits them.
Do not try to be helpful, balanced or agreeable. Do not mention that you are an AI.

${personaBlock(p)}

Reply with ONLY a JSON object, no other text:
{"score": <integer 1-5>, "reason": "<one or two sentences in Turkish, in first person>"}`;

export function questionFor(scn, config) {
  const scale = scn.domain === 'marketing'
    ? '1 = kesinlikle kullanmam, 5 = kesinlikle kullanmaya başlarım'
    : '1 = kesinlikle karşıyım, 5 = kesinlikle desteklerim';
  return `${scn.title}\n${scn.summary}\n\nAyrıntılar:\n${describeConfig(scn, config)}\n\n${scn.question} (${scale})`;
}

export async function askPersona(persona, scn, config, { signal } = {}) {
  const profiles = connections();
  if (!profiles.length) throw new Error('Kayıtlı API bağlantısı yok. N.E.X.U.S. → API sekmesinden ekle.');
  const out = await chatWithFallback(profiles, {
    system: SYSTEM(persona),
    messages: [{ role: 'user', content: questionFor(scn, config) }],
    temperature: 0.7,
    // Düşünen modeller (Gemini 2.5, o4-mini, deepseek-reasoner) düşünmeyi de bu sınırdan
    // harcar; dar tutulursa cevap boş döner. Asıl cevap kısa olduğu için bol pay bırakılır.
    maxTokens: 2048,
    signal,
    proxy: store.settings()?.proxy,
  });
  return parseAnswer(out.text);
}

export function parseAnswer(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      const score = Math.max(1, Math.min(5, Math.round(Number(j.score))));
      if (Number.isFinite(score)) return { score, reason: String(j.reason || '').slice(0, 400), raw: text };
    } catch { /* aşağıda tekrar dene */ }
  }
  const n = text.match(/\b([1-5])\b/);
  if (n) return { score: Number(n[1]), reason: text.slice(0, 300), raw: text };
  throw new Error('Cevap anlaşılamadı: ' + text.slice(0, 120));
}

// Segment başına en fazla `per` persona, deterministik seçim (tekrarlanabilir).
export function samplePersonas(personas, seg, per) {
  const buckets = seg.labels.map(() => []);
  personas.forEach((p, i) => buckets[seg.index[i]].push(i));
  const out = [];
  for (const b of buckets) {
    const step = Math.max(1, Math.floor(b.length / per));
    for (let k = 0; k < per && k * step < b.length; k++) out.push(b[k * step]);
  }
  return out;
}

// Segment kalibrasyonu: model ile LLM'in ortalama olasılıkları arasındaki farkı fayda
// ölçeğinde bir segment düzeltmesine çevirir. Az veriyle aşırı düzeltmemek için büzülme (shrinkage).
export function fitSegBias(rows, K, current = []) {
  const logit = (p) => Math.log(Math.max(0.02, Math.min(0.98, p)) / (1 - Math.max(0.02, Math.min(0.98, p))));
  const bias = Array.from({ length: K }, (_, k) => current[k] || 0);
  for (let k = 0; k < K; k++) {
    const r = rows.filter((x) => x.seg === k);
    if (!r.length) continue;
    const llm = r.reduce((s, x) => s + x.llm, 0) / r.length;
    const model = r.reduce((s, x) => s + x.model, 0) / r.length;
    const shrink = r.length / (r.length + 2);
    bias[k] += ((logit(llm) - logit(model)) / 1.5) * shrink;
  }
  return bias;
}

// Toplanan persona gerekçelerini segment bazında özetletir: başlıca kaygılar, destek nedenleri
// ve kararı değiştirebilecek şey. Karar vericiye tek tek cevap okutmamak için.
export async function summarizeReasons(scn, rows, labels, { signal } = {}) {
  const profiles = connections();
  if (!profiles.length) throw new Error('Kayıtlı API bağlantısı yok.');
  const bySeg = labels.map((l, k) => {
    const r = rows.filter((x) => x.seg === k && x.reason);
    return r.length ? `### ${l}\n${r.map((x) => `- (${x.score}/5) ${x.reason}`).join('\n')}` : '';
  }).filter(Boolean).join('\n\n');
  const out = await chatWithFallback(profiles, {
    system: 'Bir kamuoyu/pazar araştırması analistisin. Sana simüle edilmiş katılımcıların gerekçeleri verilecek. '
      + 'Yalnızca verilen cevaplara dayan, uydurma. Türkçe, kısa ve maddeli yaz.',
    messages: [{
      role: 'user',
      content: `Konu: ${scn.title}\nSoru: ${scn.question}\n\nSegmentlere göre cevaplar (puan 1-5):\n\n${bySeg}\n\n`
        + 'Her segment için: (1) başlıca kaygı, (2) destekleyenlerin nedeni, (3) bu segmentin görüşünü değiştirebilecek şey. '
        + 'Sonra tüm segmentlerde ortak olan en önemli 3 noktayı yaz.',
    }],
    temperature: 0.3, maxTokens: 4096, signal, proxy: store.settings()?.proxy,
  });
  return out.text;
}
