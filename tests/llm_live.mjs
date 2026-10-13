// GERÇEK yapay zekâ testi: dil modeline (Groq) ANES 2020 seçmenlerini canlandırtıp (silikon örneklem,
// Argyle vd. 2023) oy tahmini aldırır; bütünleşik model ve topluluk (ensemble) ile kıyaslar.
//   - bütünleşik: 2016'da öğrenilmiş + 2020 toplam paylarına kalibre (gerçek tahmin iş akışı)
//   - silikon   : dil modelinin kişi başı olasılıkları
//   - topluluk  : ağırlıklar panelin yarısında öğrenilir, diğer yarısında ölçülür
// Anahtar: GROQ_API_KEY ortam değişkeni veya /root/.secrets/groq.env (asla repoya yazılmaz, ekrana basılmaz).
// Çalıştır: python3 tests/data/fetch_anes.py && NODE_USE_ENV_PROXY=1 node tests/llm_live.mjs [kişi=120] [model=llama-3.3-70b-versatile]
// (NODE_USE_ENV_PROXY=1: Node'un fetch'i ortamdaki HTTPS_PROXY'yi kullansın.) LLM_SAHTE=1 → yalnızca akış denetimi, sonuç değildir.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { siliconProbs, stackWeights } from '../js/decision/ensemble.js';
import { fitChoiceModel, tuneDemoSigma, scoreProbs } from '../js/decision/estimate.js';
import { rowProbabilities } from '../js/decision/model.js';
import { rng } from '../js/audience/personas.js';

process.argv[2] = process.argv[2] || '120';
const N = Number(process.argv[2]), MODEL = process.argv[3] || 'llama-3.3-70b-versatile';
let KEY = process.env.GROQ_API_KEY;
if (!KEY && existsSync('/root/.secrets/groq.env')) KEY = (readFileSync('/root/.secrets/groq.env', 'utf8').match(/GROQ_API_KEY=(\S+)/) || [])[1];
if (!KEY && !process.env.LLM_SAHTE) { console.error('GROQ_API_KEY yok'); process.exit(2); }

// Akış denetimi için sahte model: her personaya eşit olasılık (gerçek sonuç DEĞİLDİR)
const fakeChat = async (system, user) => JSON.stringify({ yanitlar: (user.match(/^\d+\. /gm) || []).map((_, i) => ({ no: i + 1, olasiliklar: { dem: 0.25, rep: 0.25, ucuncu: 0.25, oy_yok: 0.25 } })) });

async function realChat(system, user, tries = 4) {
  for (let t = 0; t < tries; t++) {
    let res;
    try {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
    } catch (e) { throw new Error(`api.groq.com erişilemedi (ağ politikası?): ${e.cause?.code || e.message}`); }
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * 2 ** t)); continue; }
    if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).choices[0].message.content;
  }
  throw new Error('Groq: yeniden deneme sınırı');
}

// realdata.mjs'in ANES yükleyicisini kullan (ana akışı çalıştırmadan)
process.argv.splice(2, process.argv.length, '--yukle');
const { anes } = await import('./realdata.mjs');
const ids = ['dem', 'rep', 'ucuncu', 'oy_yok'];
const A = anes(2016, false), B = anes(2020, false);
const tr = A.rows, all = B.rows;
const r = rng(2020), idx = all.map((_, i) => i);
for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
const panel = idx.slice(0, N).map((i) => all[i]);

// Bütünleşik: 2016'da öğren, 2020 toplam paylarına kalibre et (paylar tüm 2020 örnekleminden — anket yerine)
const m = fitChoiceModel(A.spec, tr, { demoSigma: tuneDemoSigma(A.spec, tr, {}), iters: 300 });
const target = ids.map((id) => all.filter((t) => t.secim === id).length / all.length);
const mm = { ...m, asc: { ...m.asc } };
for (let it = 0; it < 30; it++) { const PP = rowProbabilities(B.spec, mm, all); ids.forEach((id, j) => { mm.asc[id] += Math.log(target[j] / (PP.reduce((a, x) => a + x.P[j], 0) / PP.length)); }); }
const modelP = rowProbabilities(B.spec, mm, panel).map((x) => x.P);

console.log(`${process.env.LLM_SAHTE ? 'SAHTE MODEL (akış denetimi)' : 'Groq ' + MODEL} ile ${N} ANES 2020 seçmeni canlandırılıyor…`);
const t0 = Date.now();
const silP = await siliconProbs(B.spec, panel, process.env.LLM_SAHTE ? fakeChat : realChat, { batch: 6 });
const ok = panel.map((_, i) => i).filter((i) => silP[i]);
const ys = panel.map((x) => ids.indexOf(x.secim));
const score = (Ps, I) => scoreProbs(I.map((i) => ({ P: Ps[i], y: ys[i], w: 1 })));
const half = Math.floor(ok.length / 2), fitI = ok.slice(0, half), evalI = ok.slice(half);
const sw = stackWeights([modelP, silP].map((P) => fitI.map((i) => P[i])), fitI.map((i) => ys[i]));
const [wm, ws] = sw.agirliklar;
const mix = panel.map((_, i) => (silP[i] ? modelP[i].map((v, j) => wm * v + ws * silP[i][j]) : null));
const res = {
  model: MODEL, panel: N, yanit_alinan: ok.length, sure_sn: Math.round((Date.now() - t0) / 1000),
  tum_panel: { butunlesik: score(modelP, ok), silikon: score(silP, ok) },
  degerlendirme_yarisi: { butunlesik: score(modelP, evalI), silikon: score(silP, evalI), topluluk: score(mix, evalI), agirliklar: { butunlesik: wm, silikon: ws } },
};
console.log(JSON.stringify(res, null, 2));
try { mkdirSync(new URL('../reports/', import.meta.url), { recursive: true }); writeFileSync(new URL('../reports/llm_live.json', import.meta.url), JSON.stringify(res, null, 2)); } catch {}
