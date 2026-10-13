// Dil modeli hayat öyküsünden bilgi çıkarıyor mu? Sentetik TR seçmenlerinde aynı kişiler iki kez
// canlandırılır: (a) yalnız anket alanları, (b) anket alanları + hayat öyküsü. Bütünleşik model
// (kalan kişilerde öğrenilmiş) aynı kişilerde kıyas için ölçülür; ayrıca öykülü dil modeli fayda terimi
// olarak eklenince (hibrit) katsayı ve isabet raporlanır.
// Çalıştır: NODE_USE_ENV_PROXY=1 node tests/llm_oyku.mjs [kişi=48] [model=openai/gpt-oss-20b]
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { attachSilicon } from '../js/decision/ensemble.js';
import { fitChoiceModel, tuneDemoSigma, scoreProbs } from '../js/decision/estimate.js';
import { rowProbabilities } from '../js/decision/model.js';
import { describePersona } from '../js/audience/survey.js';
import { rng } from '../js/audience/personas.js';

const N = Number(process.argv[2] || 48), MODEL = process.argv[3] || 'openai/gpt-oss-20b';
let KEY = process.env.GROQ_API_KEY;
if (!KEY && existsSync('/root/.secrets/groq.env')) KEY = (readFileSync('/root/.secrets/groq.env', 'utf8').match(/GROQ_API_KEY=(\S+)/) || [])[1];
if (!KEY) { console.error('GROQ_API_KEY yok'); process.exit(2); }
async function chat(system, user) {
  for (let t = 0; t < 8; t++) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, temperature: 0.2, response_format: { type: 'json_object' }, ...(MODEL.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}), messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
    if (res.status === 429 || res.status >= 500) { const ra = Number(res.headers.get('retry-after')) || 5; if (ra > 120) throw new Error(`Groq günlük kota: ${ra} sn bekleme istendi`); await new Promise((r) => setTimeout(r, ra * 1000 + 500)); continue; }
    if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).choices[0].message.content;
  }
  throw new Error('Groq: yeniden deneme sınırı');
}

process.argv.splice(2, process.argv.length, '--yukle');
const { sentetikTR } = await import('./realdata.mjs');
const { spec, rows } = sentetikTR('onceki_yok');
const oyku = Object.fromEntries(readFileSync(new URL('./data/sentetik/TR_secmen_oyku.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((x) => [String(x.kisi), x.oyku]));
const r = rng(31), idx = rows.map((_, i) => i);
for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
const panel = idx.slice(0, N).map((i) => rows[i]), train = idx.slice(N).map((i) => rows[i]);
const ids = spec.secenekler.map((a) => a.id), ys = panel.map((x) => ids.indexOf(x.secim));
const CACHE_F = new URL('./data/cache/llm_cache.json', import.meta.url);
const cache = existsSync(CACHE_F) ? JSON.parse(readFileSync(CACHE_F, 'utf8')) : {};
const SYS = `Türkiye'deki seçmenleri canlandırıyorsun. Her kişi için son genel seçimde ne yaptığını olasılık olarak tahmin et. Seçenekler: iktidar (sağ-muhafazakâr iktidar ittifakı), ana_muhalefet (merkez sol), milliyetci (milliyetçi muhalefet), kurt_sol (Kürt siyasi hareketi), oy_yok (oy kullanmadı). Yalnız JSON: {"yanitlar":[{"no":1,"olasiliklar":{"iktidar":0,"ana_muhalefet":0,"milliyetci":0,"kurt_sol":0,"oy_yok":0}}]}`;
const brief = () => 'Son genel seçim. Her personanın seçeneklere olasılık dağılımını ver.';
const save = () => writeFileSync(CACHE_F, JSON.stringify(cache));
let kota = false;   // günlük kota dolarsa: önbellekteki yanıtlarla (iki koşulda da yanıtı olan kişiler) değerlendir
const run = async (tag, betim) => {
  for (let i = 0; i < panel.length; i += 12) {
    const part = panel.slice(i, i + 12), key = (x) => `${MODEL}|tr_${tag}|${x.kisi}`;
    if (kota) { for (const x of part) if (cache[key(x)]) await attachSilicon(spec, [x], chat, { batch: 6, cache, anahtar: key, sistem: SYS, brief, betim }); continue; }
    try { await attachSilicon(spec, part, chat, { batch: 6, cache, anahtar: key, sistem: SYS, brief, betim }); save(); }
    catch (e) { if (!/kota/.test(e.message)) throw e; kota = true; console.error(e.message, '— önbellekle devam'); i -= 12; }
  }
  return panel.map((x) => (x.p.__silikon ? ids.map((id) => x.p.__silikon[id]) : null));
};
const t0 = Date.now();
const P0 = await run('anket', (p) => describePersona(p));
const P1 = await run('oyku', (p) => `${describePersona(p)}. Hayat öyküsü: ${oyku[String(panel.find((x) => x.p === p)?.kisi)] || ''}`);
const ok = panel.map((_, i) => i).filter((i) => P0[i] && P1[i]);
const sc = (Ps) => scoreProbs(ok.map((i) => ({ P: Ps[i], y: ys[i], w: 1 })));
const sg = tuneDemoSigma(spec, train, { haric: ['silikon'] });
const m = fitChoiceModel(spec, train, { demoSigma: sg, iters: 300, haric: ['silikon'] });
const PM = rowProbabilities(spec, m, panel).map((x) => x.P);
const res = { model: MODEL, panel: N, yanit: ok.length, kota_doldu: kota, sure_sn: Math.round((Date.now() - t0) / 1000),
  dil_modeli_yalniz_anket: sc(P0), dil_modeli_anket_arti_oyku: sc(P1), butunlesik_model: sc(PM) };
console.log(JSON.stringify(res, null, 2));
