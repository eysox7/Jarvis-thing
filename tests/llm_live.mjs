// GERÇEK yapay zekâ testi: dil modeline (Groq) ANES 2020 seçmenlerini canlandırtıp (silikon örneklem,
// Argyle vd. 2023) oy tahmini aldırır; bütünleşik model ve topluluk (ensemble) ile kıyaslar.
//   - bütünleşik: 2016'da öğrenilmiş + 2020 toplam paylarına kalibre (gerçek tahmin iş akışı)
//   - silikon   : dil modelinin kişi başı olasılıkları
//   - topluluk  : ağırlıklar panelin yarısında öğrenilir, diğer yarısında ölçülür
// Anahtar: GROQ_API_KEY ortam değişkeni veya /root/.secrets/groq.env (asla repoya yazılmaz, ekrana basılmaz).
// Çalıştır: python3 tests/data/fetch_anes.py && NODE_USE_ENV_PROXY=1 node tests/llm_live.mjs [kişi=120] [model=openai/gpt-oss-120b]
// (NODE_USE_ENV_PROXY=1: Node'un fetch'i ortamdaki HTTPS_PROXY'yi kullansın.) LLM_SAHTE=1 → yalnızca akış denetimi, sonuç değildir.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { attachSilicon } from '../js/decision/ensemble.js';
import { fitChoiceModel, tuneDemoSigma, scoreProbs } from '../js/decision/estimate.js';
import { rowProbabilities } from '../js/decision/model.js';
import { rng } from '../js/audience/personas.js';

process.argv[2] = process.argv[2] || '120';
const N = Number(process.argv[2]), MODEL = process.argv[3] || 'openai/gpt-oss-120b';
let KEY = process.env.GROQ_API_KEY;
if (!KEY && existsSync('/root/.secrets/groq.env')) KEY = (readFileSync('/root/.secrets/groq.env', 'utf8').match(/GROQ_API_KEY=(\S+)/) || [])[1];
if (!KEY && !process.env.LLM_SAHTE) { console.error('GROQ_API_KEY yok'); process.exit(2); }

// Akış denetimi için sahte model: her personaya eşit olasılık (gerçek sonuç DEĞİLDİR)
const fakeChat = async (system, user) => JSON.stringify({ yanitlar: (user.match(/^\d+\. /gm) || []).map((_, i) => ({ no: i + 1, olasiliklar: { dem: 0.25, rep: 0.25, ucuncu: 0.25, oy_yok: 0.25 } })) });

async function realChat(system, user, tries = 10) {
  for (let t = 0; t < tries; t++) {
    let res;
    try {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, temperature: 0.2, response_format: { type: 'json_object' }, ...(MODEL.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}), messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
    } catch (e) { throw new Error(`api.groq.com erişilemedi (ağ politikası?): ${e.cause?.code || e.message}`); }
    // Ücretsiz katman dakikada token sınırlı: Groq'un bildirdiği bekleme süresine uy
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after')) || Math.min(60, 3 * 2 ** t);
      process.stdout.write(`  (hız sınırı, ${ra} sn bekleniyor)\n`);
      await new Promise((r) => setTimeout(r, ra * 1000 + 500)); continue;
    }
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
const shuffle = (arr, seed) => { const r = rng(seed), idx = arr.map((_, i) => i); for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } return idx.map((i) => arr[i]); };
const panel = shuffle(all, 2020).slice(0, N);
const NCAL = Number(process.env.KALIBRASYON_N || 150);
const calib = shuffle(tr, 2016).slice(0, NCAL);   // 2016'dan dil modeliyle de betimlenen eğitim alt kümesi

// Dil modeli yanıt önbelleği (aynı kişi için yeniden çağırma yok; repoya girmez)
const CACHE_F = new URL('./data/cache/llm_cache.json', import.meta.url);
const cache = existsSync(CACHE_F) ? JSON.parse(readFileSync(CACHE_F, 'utf8')) : {};
const tag = (process.env.LLM_SAHTE ? 'sahte|' : MODEL + '|') + (process.env.ISTEM || 'v1') + '|';
const chat = process.env.LLM_SAHTE ? fakeChat : realChat;
// İstem v2: İngilizce, ABD seçim bağlamı, ANES'e özgü seçmen betimi (dil modelinin eğitim verisine en yakın biçim)
const V2 = process.env.ISTEM === 'v2';
const SYS2 = `You simulate American voters. For EACH respondent profile, estimate how that specific person actually behaved in the given US presidential election, as a survey researcher who knows the ANES data would.
Take party-relevant cues seriously (ideology, race, religiosity, education, authoritarian child-rearing values, economic perceptions, trust, media diet, political attention). Non-voting is common among low-attention, young, low-income citizens.
Return ONLY JSON: {"yanitlar":[{"no":1,"olasiliklar":{"dem":0.0,"rep":0.0,"ucuncu":0.0,"oy_yok":0.0}}]} (probabilities sum to 1).`;
const brief2 = (year) => () => `Election: ${year} US presidential election. Options: dem = ${year === 2016 ? 'Hillary Clinton (Democrat, incumbent party)' : 'Joe Biden (Democrat)'}; rep = ${year === 2016 ? 'Donald Trump (Republican)' : 'Donald Trump (Republican, incumbent)'}; ucuncu = third-party candidate; oy_yok = did not vote.`;
const lvl = { dusuk: 'low', orta: 'medium', yuksek: 'high' };
const betim2 = (p) => [
  p.yas && `age ${p.yas}`, p.cinsiyet && (p.cinsiyet === 'kadin' ? 'woman' : 'man'),
  p.azinlik_kimlik && (p.azinlik_kimlik === 'evet' ? 'non-white (racial/ethnic minority)' : 'white'),
  p.egitim && { ilkokul: 'less than high school', lise: 'high school / some college', universite: "bachelor's degree", lisansustu: 'graduate degree' }[p.egitim],
  p.gelir && `${lvl[p.gelir]} income (tercile)`, p.ideoloji && { sol: 'liberal', merkez: 'moderate / no ideology', sag: 'conservative' }[p.ideoloji],
  p.dindarlik && `religiosity ${lvl[p.dindarlik]}`, p.kurumsal_guven && `trust in federal government ${lvl[p.kurumsal_guven]}`,
  p.ekonomi_algisi !== undefined && `thinks the national economy got ${p.ekonomi_algisi > 0.2 ? 'better' : p.ekonomi_algisi < -0.2 ? 'worse' : 'about the same'} over the last year`,
  p.otoriterlik !== undefined && `authoritarian child-rearing values ${p.otoriterlik >= 0.7 ? 'high (obedience, respect, good manners)' : p.otoriterlik <= 0.3 ? 'low (independence, curiosity, self-reliance)' : 'medium'}`,
  p.bilissel_ihtiyac && `pays attention to politics ${p.bilissel_ihtiyac === 'yuksek' ? 'always / most of the time' : 'only sometimes or never'}`,
  p.medya_kaynagi && { sag_medya: 'watches Fox News programs', sol_medya: 'watches MSNBC (Maddow)', notr_medya: 'watches neither Fox nor MSNBC' }[p.medya_kaynagi],
].filter(Boolean).join(', ');
const opt = (year) => (V2 ? { sistem: SYS2, brief: brief2(year), betim: betim2 } : {});
const t0 = Date.now();
console.log(`${process.env.LLM_SAHTE ? 'SAHTE MODEL (akış denetimi)' : 'Groq ' + MODEL} ile ${N} (2020) + ${NCAL} (2016) seçmen canlandırılıyor…`);
const nP = await attachSilicon(B.spec, panel, chat, { batch: 6, cache, anahtar: (row) => tag + row.kisi, ...opt(2020) });
const nC = await attachSilicon(A.spec, calib, chat, { batch: 6, cache, anahtar: (row) => tag + row.kisi, ...opt(2016) });
writeFileSync(CACHE_F, JSON.stringify(cache));

// 2020 toplam paylarına (anket yerine tüm 2020 örneklemi) sabit kalibrasyonu
const target = ids.map((id) => all.filter((t) => t.secim === id).length / all.length);
const calibrate = (model) => { const mm = { ...model, asc: { ...model.asc } }; for (let it = 0; it < 30; it++) { const PP = rowProbabilities(B.spec, mm, all); ids.forEach((id, j) => { mm.asc[id] += Math.log(target[j] / (PP.reduce((a, x) => a + x.P[j], 0) / PP.length)); }); } return mm; };
const sg = tuneDemoSigma(A.spec, tr, { haric: ['silikon'] });
// (a) bütünleşik, dil modelsiz   (b) HİBRİT: dil modeli fayda terimi, katsayısı 2016 alt kümesinden öğrenilir
const mA = calibrate(fitChoiceModel(A.spec, tr, { demoSigma: sg, iters: 300, haric: ['silikon'] }));
const mB = calibrate(fitChoiceModel(A.spec, tr, { demoSigma: sg, iters: 300 }));
const okI = panel.map((_, i) => i).filter((i) => panel[i].p.__silikon);
const ys = panel.map((x) => ids.indexOf(x.secim));
const PA = rowProbabilities(B.spec, mA, panel).map((x) => x.P), PB = rowProbabilities(B.spec, mB, panel).map((x) => x.P);
const PS = panel.map((x) => (x.p.__silikon ? ids.map((id) => x.p.__silikon[id]) : null));
const score = (Ps, I) => scoreProbs(I.map((i) => ({ P: Ps[i], y: ys[i], w: 1 })));
const res = {
  model: MODEL, istem: process.env.ISTEM || 'v1', panel_2020: N, yanit_2020: nP, kalibrasyon_2016: nC, sure_sn: Math.round((Date.now() - t0) / 1000),
  silikon_katsayisi: Math.round((mB.theta.silikon ?? 0) * 1000) / 1000,
  yalniz_dil_modeli: score(PS, okI),
  butunlesik: score(PA, okI),
  hibrit_butunlesik_artı_dil_modeli: score(PB, okI),
};
console.log(JSON.stringify(res, null, 2));
try { mkdirSync(new URL('../reports/', import.meta.url), { recursive: true }); writeFileSync(new URL('../reports/llm_live.json', import.meta.url), JSON.stringify(res, null, 2)); } catch {}
