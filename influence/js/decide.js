// Klonun karar motoru: çekirdek (istatistik), nöral (yerel LLM) veya hibrit.
import { BY_ID, DILEMMAS } from './dilemmas.js';
import { predictCore, reasonCore, personaLines, features } from './clone.js';
import { S } from './store.js';
import * as llm from './llm.js';
import { search } from './ingest.js';

const optText = (d, c) => (c === 'A' ? d.a.t : d.b.t);

/** Klonun eğitim kararlarından, bu soruya en benzer olanları (iz vektörüne göre) seçer. */
function similarPast(clone, d, k = 8) {
  const x = features(d);
  const norm = (v) => Math.sqrt(v.reduce((s, a) => s + a * a, 0)) || 1;
  return Object.entries(clone.train || {})
    .filter(([id]) => BY_ID[id] && id !== d.id)
    .map(([id, c]) => { const y = features(BY_ID[id]); return { d: BY_ID[id], c, s: Math.abs(x.reduce((s, a, i) => s + a * y[i], 0)) / (norm(x) * norm(y)) }; })
    .sort((a, b) => b.s - a.s).slice(0, k);
}

export function buildPrompt(clone, d) {
  const name = clone.name;
  const traits = personaLines(clone);
  const past = similarPast(clone, d).map((p) => `- "${p.d.q}" → ${optText(p.d, p.c)}`).join('\n');
  const docs = clone.own ? search(S.docs, `${d.q} ${d.a.t} ${d.b.t}`, 3) : [];
  const sys = [
    `Sen ${name} adlı kişinin dijital klonusun. Onun gibi düşün, onun gibi karar ver ve birinci tekil şahısla, onun ağzından konuş.`,
    clone.bio ? `${name} kendini şöyle anlatıyor: "${clone.bio}"` : '',
    traits.length ? `Kişilik DNA'n: ${traits.join(', ')}.` : '',
    clone.style ? `Yazım tarzın: ${clone.style}.` : '',
    past ? `Daha önce verdiğin gerçek kararlar:\n${past}` : '',
    docs.length ? `Kendi yazdıklarından örnekler:\n${docs.map((c) => `"${c.slice(0, 300)}"`).join('\n')}` : '',
    'Sadece şu biçimde cevap ver, başka hiçbir şey yazma:\nSEÇİM: A veya B\nGEREKÇE: tek kısa cümle',
  ].filter(Boolean).join('\n\n');
  return [
    { role: 'system', content: sys },
    { role: 'user', content: `İkilem: ${d.q}\nA) ${d.a.t}\nB) ${d.b.t}` },
  ];
}

/**
 * Klon bu ikilemde ne seçer?
 * opts.engine: 'core' | 'neural' | 'hybrid' (vars. ayarlardaki)
 * opts.useMemory: eğitimde gördüğü soruyu doğrudan hatırlasın mı (sınavda false)
 */
export async function decide(clone, d, { engine = S.settings.engine, useMemory = true } = {}) {
  const core = predictCore(clone, d, { useMemory });
  if (core.by === 'memory') return { ...core, reason: `Bunu zaten biliyorum: "${optText(d, core.choice)}".` };
  const coreOut = { ...core, reason: reasonCore(clone, d, core.choice) };
  if (engine === 'core' || !llm.ready()) return coreOut;
  if (engine === 'hybrid' && core.conf >= 0.75) return { ...coreOut, by: 'hybrid-core' };
  try {
    const out = llm.parseDecision(await llm.complete(buildPrompt(clone, d)));
    if (!out.choice) return { ...coreOut, by: 'core-fallback' };
    return { choice: out.choice, conf: out.choice === core.choice ? Math.max(core.conf, 0.6) : 0.55, reason: out.reason || coreOut.reason, by: engine === 'hybrid' ? 'hybrid-neural' : 'neural' };
  } catch (e) {
    console.warn('LLM hatası, çekirdeğe düşüldü:', e.message);
    return { ...coreOut, by: 'core-fallback' };
  }
}

/** Senkron testi: klon, hiç görmediği sınav sorularında sahibinin seçimini tahmin eder. */
export async function syncTest(clone, engine, onStep = () => {}) {
  const rows = [];
  const ids = Object.keys(clone.test || {});
  for (const [i, id] of ids.entries()) {
    const d = BY_ID[id];
    const r = await decide(clone, d, { engine, useMemory: false });
    rows.push({ id, truth: clone.test[id], ...r, hit: r.choice === clone.test[id] });
    onStep(i + 1, ids.length, rows[rows.length - 1]);
  }
  const acc = rows.length ? rows.filter((r) => r.hit).length / rows.length : null;
  return { acc, n: rows.length, rows, engine, at: new Date().toISOString() };
}

export const randomDilemma = () => DILEMMAS[Math.floor(Math.random() * DILEMMAS.length)];
