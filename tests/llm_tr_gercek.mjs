// Dil modeli GERÇEK Türk seçmenlerini canlandırabiliyor mu? CSES Türkiye 2018'in B yarısından rastgele N kişi
// anket betiminden (yaş, cinsiyet, eğitim, gelir, dindarlık, ideoloji, yerleşim, dil, ekonomi algısı…) canlandırılır.
// Kıyas: yalnız kuram (veri yok), A yarısında öğrenilmiş bütünleşik model, kalibre sentetik aileler + A.
// Çalıştır: NODE_USE_ENV_PROXY=1 node tests/llm_tr_gercek.mjs [N=96] [model=openai/gpt-oss-20b]
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { attachSilicon } from '../js/decision/ensemble.js';
import { fitChoiceModel, tuneDemoSigma, scoreProbs } from '../js/decision/estimate.js';
import { rowProbabilities, KURAM_OLCEGI } from '../js/decision/model.js';
import { describePersona } from '../js/audience/survey.js';
import { rng } from '../js/audience/personas.js';

const N = Number(process.argv[2] || 96), MODEL = process.argv[3] || 'openai/gpt-oss-20b';
let KEY = process.env.GROQ_API_KEY;
if (!KEY && existsSync('/root/.secrets/groq.env')) KEY = (readFileSync('/root/.secrets/groq.env', 'utf8').match(/GROQ_API_KEY=(\S+)/) || [])[1];
if (!KEY) { console.error('GROQ_API_KEY yok'); process.exit(2); }
async function chat(system, user) {
  for (let t = 0; t < 8; t++) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, temperature: 0.2, response_format: { type: 'json_object' }, ...(MODEL.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}), messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
    if (res.status === 429 || res.status >= 500) { const ra = Number(res.headers.get('retry-after')) || 5; if (ra > 120) throw new Error(`Groq günlük kota: ${ra} sn`); await new Promise((r) => setTimeout(r, ra * 1000)); continue; }
    if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).choices[0].message.content;
  }
  throw new Error('Groq: yeniden deneme sınırı');
}
process.argv.splice(2, process.argv.length, '--yukle');
const { trGercek, sentetikTR } = await import('./realdata.mjs');
const ORTAK = ['yas', 'cinsiyet', 'egitim', 'gelir', 'dindarlik', 'ideoloji', 'yerlesim', 'etnik_koken', 'azinlik_kimlik', 'ekonomi_algisi', 'kurumsal_guven', 'siyasi_ilgi'];
const keep = (rows) => rows.map((r) => ({ ...r, p: Object.fromEntries(Object.entries(r.p).filter(([k]) => ORTAK.includes(k))) }));
const yarim = (k) => Number(String(k).split('-')[1]) % 2 === 0 ? 'A' : 'B';
const G = trGercek(2018, false), spec = { ...G.spec, baglam: { ...G.spec.baglam } }; delete spec.baglam.bolge_paylari;
const all = keep(G.rows), A = all.filter((r) => yarim(r.kisi) === 'A'), Bh = all.filter((r) => yarim(r.kisi) === 'B');
const r = rng(41), idx = Bh.map((_, i) => i);
for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
const panel = idx.slice(0, N).map((i) => Bh[i]);
const ids = spec.secenekler.map((a) => a.id), ys = panel.map((x) => ids.indexOf(x.secim));
const CACHE_F = new URL('./data/cache/llm_cache.json', import.meta.url);
const cache = existsSync(CACHE_F) ? JSON.parse(readFileSync(CACHE_F, 'utf8')) : {};
const SYS = `Türkiye'deki gerçek seçmenleri canlandırıyorsun. 24 Haziran 2018 milletvekili genel seçiminde her kişinin ne yaptığını olasılık olarak tahmin et. Seçenekler: iktidar (Cumhur İttifakı: AK Parti ve MHP), ana_muhalefet (CHP), milliyetci (İYİ Parti), kurt_sol (HDP), oy_yok (oy kullanmadı). Yalnız şu biçimde JSON döndür: {"yanitlar":[{"no":1,"olasiliklar":{"iktidar":0.5,"ana_muhalefet":0.2,"milliyetci":0.1,"kurt_sol":0.1,"oy_yok":0.1}}]} — her persona için bir öğe, olasılıkların toplamı 1.`;
const brief = () => 'Haziran 2018 genel seçimi. Her personanın seçeneklere olasılık dağılımını ver.';
const key = (x) => `${MODEL}|cses18|${x.kisi}`;
const t0 = Date.now();
for (let i = 0; i < panel.length; i += 12) { await attachSilicon(spec, panel.slice(i, i + 12), chat, { batch: 6, cache, anahtar: key, sistem: SYS, brief, betim: (p) => describePersona(p) }); writeFileSync(CACHE_F, JSON.stringify(cache)); }
const okI = panel.map((_, i) => i).filter((i) => panel[i].p.__silikon);
const sc = (Ps) => scoreProbs(okI.map((i) => ({ P: Ps[i], y: ys[i], w: 1 })));
const T = ids.map((id) => Bh.filter((t) => t.secim === id).length / Bh.length);
const calib = (model) => { const mm = { ...model, asc: { ...(model.asc || {}) } }; for (let it = 0; it < 40; it++) { const P = rowProbabilities(spec, mm, Bh); ids.forEach((id, j) => { const m = P.reduce((a, x) => a + x.P[j], 0) / P.length; mm.asc[id] = (mm.asc[id] || 0) + Math.log(T[j] / m); }); } return mm; };
const probs = (model) => rowProbabilities(spec, model, panel).map((x) => x.P);
const fit = (tr) => fitChoiceModel(spec, tr, { demoSigma: tuneDemoSigma(spec, tr, { haric: ['silikon'] }), iters: 300, haric: ['silikon'] });
const PL = panel.map((x) => (x.p.__silikon ? ids.map((id) => x.p.__silikon[id]) : null));
const res = { model: MODEL, panel: N, yanit: okI.length, sure_sn: Math.round((Date.now() - t0) / 1000),
  dil_modeli: sc(PL), yalniz_kuram: sc(probs(calib({ asc: {}, kuram_olcegi: KURAM_OLCEGI }))),
  butunlesik_A: sc(probs(calib(fit(A)))), butunlesik_A_artı_sentetik: sc(probs(calib(fit([...keep(sentetikTR('d2018', 'hane_kal').rows).map((x) => ({ ...x, w: 0.3 })), ...A])))),
  butunlesik_A_artı_il_kalibre_sentetik: sc(probs(calib(fit([...keep(sentetikTR('d2018', 'hane_kal_il').rows).map((x) => ({ ...x, w: 0.3 })), ...A])))) };
console.log(JSON.stringify(res, null, 2));
