// Kitle tahmini doğrulama / benchmark koşumu.
//   npm run validate        → reports/validation.md + reports/validation.json
// Birim testlerinden farkı: geç/kal değil, ÖLÇÜM üretir. Gerçek kampanya verisi olmadığı için
// doğrulama üç dürüst yoldan yapılır:
//   A. Yön paketi    — alan yazınındaki yerleşik bulguların (etki yönü + etkileşimler) modelde
//                      yeniden üretilip üretilmediği; etki büyüklüğüyle birlikte.
//   B. Kalibrasyon   — bilinen "gerçek" parametrelerle üretilmiş sentetik kurum verisinde,
//                      eğitim mesajlarıyla kalibre edip GÖRÜLMEMİŞ mesajlarda hatanın düşüp düşmediği.
//   C. Kapsama       — gerçek dünya kuram ağırlıkları ön kabulden sapıyorsa, model belirsizliği
//                      bandı gerçeği ne sıklıkla kapsıyor (hedef ≈ %90).
//   D. Kararlılık    — tohum değişince sonuçlar ne kadar oynuyor.
//   E. Performans    — telefonda kullanılabilirlik için süreler.
// Sentetik doğrulama modelin kendi iç tutarlılığını sınar; dış geçerliliği değil (README).

import { mkdirSync, writeFileSync } from 'node:fs';
import { predict, optimize, modelUncertainty } from '../js/audience/engine.js';
import { calibrate } from '../js/audience/calibrate.js';
import { THEORIES } from '../js/audience/theories.js';
import { rng } from '../js/audience/personas.js';
import { SCENARIOS } from '../js/audience/scenarios.js';

const QUICK = process.argv.includes('--quick');
const N = QUICK ? 600 : 1500;
const t0 = Date.now();
const r3 = (x) => Math.round(x * 1000) / 1000;
const P = (msg, o = {}) => predict(msg, { n: N, bootstrap: 0, ...o }).sonuc;
const log = (s) => process.stdout.write(s + '\n');

/* ===================== A. Yön paketi ===================== */
// Her bulgu: [kuram, iddia, a, b] → a > b beklenir. Etki = a - b.
const T = (target) => ({ target });
const att = (m, o) => P(m, o).ortalama_tutum;
const dirSuite = [
  ['ELM', 'argüman kalitesi yüksek bilişsel ihtiyaçta daha çok işler (etkileşim)',
    () => (att({ domain: 'bilim', quality: 0.9 }, T({ bilissel_ihtiyac: 'yuksek' })) - att({ domain: 'bilim', quality: 0.2 }, T({ bilissel_ihtiyac: 'yuksek' }))),
    () => (att({ domain: 'bilim', quality: 0.9 }, T({ bilissel_ihtiyac: 'dusuk' })) - att({ domain: 'bilim', quality: 0.2 }, T({ bilissel_ihtiyac: 'dusuk' })))],
  ['ELM', 'çevresel ipuçları düşük bilişsel ihtiyaçta daha çok işler (etkileşim)',
    () => (att({ domain: 'ticaret', cues: 0.9 }, T({ bilissel_ihtiyac: 'dusuk' })) - att({ domain: 'ticaret', cues: 0.1 }, T({ bilissel_ihtiyac: 'dusuk' }))),
    () => (att({ domain: 'ticaret', cues: 0.9 }, T({ bilissel_ihtiyac: 'yuksek' })) - att({ domain: 'ticaret', cues: 0.1 }, T({ bilissel_ihtiyac: 'yuksek' })))],
  ['Kaynak güvenilirliği', 'güvenilir kaynak daha ikna edici',
    () => att({ domain: 'saglik', institution: { tur: 'hastane', guvenilirlik: 0.9 } }), () => att({ domain: 'saglik', institution: { tur: 'hastane', guvenilirlik: 0.2 } })],
  ['Düşmanca medya', 'aynı görüşteki kitle karşı görüştekinden olumlu',
    () => att({ domain: 'siyaset', institution: 'parti_muhalefet' }, T({ ideoloji: 'sol' })), () => att({ domain: 'siyaset', institution: 'parti_muhalefet' }, T({ ideoloji: 'sag' }))],
  ['Seçici maruziyet', 'aynı görüşteki kitle daha çok maruz kalır',
    () => P({ domain: 'siyaset', institution: 'parti_iktidar' }, T({ ideoloji: 'sag' })).erisim_yuzde, () => P({ domain: 'siyaset', institution: 'parti_iktidar' }, T({ ideoloji: 'sol' })).erisim_yuzde],
  ['Dijital uçurum', 'sosyal medya gençlere yaşlılardan çok ulaşır',
    () => P({ channels: ['sosyal'] }, T({ yas: '18-24' })).erisim_yuzde, () => P({ channels: ['sosyal'] }, T({ yas: '65+' })).erisim_yuzde],
  ['Dijital uçurum', 'TV yaşlılara gençlerden çok ulaşır',
    () => P({ channels: ['tv'] }, T({ yas: '65+' })).erisim_yuzde, () => P({ channels: ['tv'] }, T({ yas: '18-24' })).erisim_yuzde],
  ['Ekme', 'korku çerçevesi yoğun TV izleyicisinde sosyal medyacıdan daha etkili (etkileşim)',
    () => (att({ domain: 'kriz', frame: 'korku', channels: ['tv'] }, T({ medya: 'tv' })) - att({ domain: 'kriz', frame: 'notr', channels: ['tv'] }, T({ medya: 'tv' }))),
    () => (att({ domain: 'kriz', frame: 'korku', channels: ['tv'] }, T({ medya: 'sosyal' })) - att({ domain: 'kriz', frame: 'notr', channels: ['tv'] }, T({ medya: 'sosyal' })))],
  ['Bilgi açığı', 'eğitimliler daha çok anlar',
    () => P({ domain: 'bilim' }, T({ egitim: 'universite' })).anlama_yuzde, () => P({ domain: 'bilim' }, T({ egitim: 'ilkokul' })).anlama_yuzde],
  ['Bilgi açığı', 'dijital kanal açığı büyütür (etkileşim)',
    () => P({ domain: 'bilim', channels: ['sosyal'] }, T({ egitim: 'universite' })).anlama_yuzde - P({ domain: 'bilim', channels: ['sosyal'] }, T({ egitim: 'ilkokul' })).anlama_yuzde,
    () => P({ domain: 'bilim', channels: ['tv'] }, T({ egitim: 'universite' })).anlama_yuzde - P({ domain: 'bilim', channels: ['tv'] }, T({ egitim: 'ilkokul' })).anlama_yuzde],
  ['İki aşamalı akış', 'kanaat önderleri daha çok maruz kalır',
    () => P({ channels: ['haber_sitesi'] }, T({ kanaat_onderi: 'evet' })).erisim_yuzde, () => P({ channels: ['haber_sitesi'] }, T({ kanaat_onderi: 'hayir' })).erisim_yuzde],
  ['İki aşamalı akış', 'kanaat önderleri daha çok paylaşır',
    () => P({}, T({ kanaat_onderi: 'evet' })).paylasim_yuzde, () => P({}, T({ kanaat_onderi: 'hayir' })).paylasim_yuzde],
  ['Yayılma', 'yenilikçiler yeniliği daha çok benimser',
    () => P({ novelty: 0.9 }, T({ yas: '18-24', dijital: 'yuksek' })).benimseme_yuzde, () => P({ novelty: 0.9 }, T({ yas: '65+', dijital: 'dusuk' })).benimseme_yuzde],
  ['Gündem belirleme', 'tekrar erişimi artırır',
    () => P({ repetition: 8, channels: ['haber_sitesi'] }).erisim_yuzde, () => P({ repetition: 1, channels: ['haber_sitesi'] }).erisim_yuzde],
  ['Tepkisellik', 'aşırı tekrar düşük güvenli gençlerde tutumu düşürür',
    () => att({ repetition: 2, frame: 'kayip' }, T({ yas: '18-24', kurumsal_guven: 'dusuk' })), () => att({ repetition: 25, frame: 'kayip' }, T({ yas: '18-24', kurumsal_guven: 'dusuk' }))],
  ['Çerçeveleme', 'ahlaki çerçeve dindarlarda daha etkili (etkileşim)',
    () => att({ domain: 'din', frame: 'ahlaki' }, T({ dindarlik: 'yuksek' })) - att({ domain: 'din', frame: 'notr' }, T({ dindarlik: 'yuksek' })),
    () => att({ domain: 'din', frame: 'ahlaki' }, T({ dindarlik: 'dusuk' })) - att({ domain: 'din', frame: 'notr' }, T({ dindarlik: 'dusuk' }))],
  ['Kullanımlar & doyumlar', 'spor mesajı erkeklerde daha çok paylaşılır',
    () => P({ domain: 'spor' }, T({ cinsiyet: 'erkek' })).paylasim_yuzde, () => P({ domain: 'spor' }, T({ cinsiyet: 'kadin' })).paylasim_yuzde],
  ['Hall', 'marjinal gruplar egemen mesajı daha çok karşıt okur',
    () => P({ institution: 'kamu_bakanlik', hegemonic: 'egemen' }, T({ azinlik_kimlik: 'evet' })).hall_okuma_yuzde.karsit, () => P({ institution: 'kamu_bakanlik', hegemonic: 'egemen' }, T({ azinlik_kimlik: 'hayir' })).hall_okuma_yuzde.karsit],
  ['Hall', 'karşı-hegemonik mesajın tercih edilen anlamını marjinal gruplar daha çok benimser',
    () => P({ institution: 'bagimsiz_medya', hegemonic: 'muhalif' }, T({ azinlik_kimlik: 'evet' })).hall_okuma_yuzde.egemen, () => P({ institution: 'bagimsiz_medya', hegemonic: 'muhalif' }, T({ azinlik_kimlik: 'hayir', kurumsal_guven: 'yuksek' })).hall_okuma_yuzde.egemen],
  ['Propaganda modeli', 'ana akım kanal egemen mesajı karşı-hegemonikten çok büyütür',
    () => P({ institution: 'anaakim_medya', channels: ['tv'], hegemonic: 'egemen' }).erisim_yuzde, () => P({ institution: 'bagimsiz_medya', channels: ['tv'], hegemonic: 'muhalif' }).erisim_yuzde],
  ['Kültür endüstrisi', 'ticari içerik müzakereyi düşürür',
    () => P({ commercial: 0 }).muzakere_yuzde, () => P({ commercial: 1 }).muzakere_yuzde],
  ['Kültür endüstrisi', 'ticari içerik anlamayı düşürür',
    () => P({ commercial: 0 }).anlama_yuzde, () => P({ commercial: 1 }).anlama_yuzde],
  ['Hegemonya', 'egemen mesaj kurumlara güvenenlerde daha çok rıza üretir',
    () => att({ hegemonic: 'egemen' }, T({ kurumsal_guven: 'yuksek' })), () => att({ hegemonic: 'egemen' }, T({ kurumsal_guven: 'dusuk' }))],
  ['Kamusal alan', 'kaliteli, ticari olmayan içerik müzakereyi artırır',
    () => P({ quality: 0.9, commercial: 0 }).muzakere_yuzde, () => P({ quality: 0.3, commercial: 0.8 }).muzakere_yuzde],
  ['Feminist eleştiri', 'kapsayıcı temsil kadınlarda tutumu artırır',
    () => att({ representation: 1 }, T({ cinsiyet: 'kadin' })), () => att({ representation: -1 }, T({ cinsiyet: 'kadin' }))],
  ['Feminist eleştiri', 'kalıp yargı marjinal gruplarda karşıt okumayı artırır',
    () => P({ representation: -1 }, T({ azinlik_kimlik: 'evet' })).hall_okuma_yuzde.karsit, () => P({ representation: 1 }, T({ azinlik_kimlik: 'evet' })).hall_okuma_yuzde.karsit],
];

log('A. Yön paketi…');
const dir = dirSuite.map(([kuram, iddia, fa, fb]) => {
  const a = fa(), b = fb();
  return { kuram, iddia, a: r3(a), b: r3(b), etki: r3(a - b), gecti: a > b };
});
const dirPass = dir.filter((d) => d.gecti).length;

/* ===================== B. Kalibrasyon geri kazanımı ===================== */
log('B. Kalibrasyon çapraz doğrulama…');
const R = rng(2024);
const gauss = () => Math.sqrt(-2 * Math.log(R() || 1e-9)) * Math.cos(2 * Math.PI * R());
const DOMS = ['saglik', 'kamu_hizmeti', 'cevre', 'egitim', 'kriz', 'ticaret', 'finans', 'kultur', 'bilim'];
const FRS = ['kayip', 'kazanc', 'sorumluluk', 'umut', 'insan_hikayesi', 'ekonomik', 'notr', 'korku', 'ahlaki'];
const CHS = [['sosyal'], ['tv'], ['sms'], ['haber_sitesi'], ['yuz_yuze'], ['tv', 'sosyal'], ['radyo_podcast'], ['sosyal', 'sms'], ['yazili']];
const msgAt = (i) => ({ domain: DOMS[i % DOMS.length], frame: FRS[(i * 4) % FRS.length], channels: CHS[(i * 2) % CHS.length], institution: 'belediye' });
const metrics = ['erisim_yuzde', 'ortalama_tutum', 'olumlu_yuzde'];
const scale = { erisim_yuzde: 100, ortalama_tutum: 1, olumlu_yuzde: 100 };
const rmse = (pred, obs) => Math.sqrt(pred.reduce((s, p, i) => s + metrics.reduce((t, k) => t + ((p[k] - obs[i][k]) / scale[k]) ** 2, 0), 0) / (pred.length * metrics.length));
const TRUTHS = QUICK ? 3 : 6;
const calib = [];
for (let k = 0; k < TRUTHS; k++) {
  const truth = {
    intercepts: { exp: r3(gauss() * 0.8), shift: r3(gauss() * 0.4), share: 0, adopt: 0 },
    weights: Object.fromEntries(THEORIES.filter((t) => !t.core).map((t) => [t.id, r3(Math.exp(0.35 * gauss()))])),
  };
  const msgs = Array.from({ length: 9 }, (_, i) => msgAt(i + k * 3));
  const observe = (m) => { const s = predict(m, { n: 400, seed: 999 + k, bootstrap: 0, calibration: truth }).sonuc; return Object.fromEntries(metrics.map((x) => [x, s[x]])); };
  const obs = msgs.map(observe);
  const train = msgs.slice(0, 6), test = msgs.slice(6);
  const cal = calibrate(train.map((m, i) => ({ message: m, observed: obs[i] })), { n: 300, rounds: QUICK ? 1 : 2 });
  const predTest = (c) => test.map((m) => { const s = predict(m, { n: 400, bootstrap: 0, calibration: c }).sonuc; return Object.fromEntries(metrics.map((x) => [x, s[x]])); });
  const before = rmse(predTest(undefined), obs.slice(6)), after = rmse(predTest(cal), obs.slice(6));
  calib.push({ gercek: k + 1, egitim_rmse: cal.fit.sonra_rmse, test_once: r3(before), test_sonra: r3(after), iyilesme_yuzde: Math.round((1 - after / before) * 100), exp_gercek: truth.intercepts.exp, exp_bulunan: cal.intercepts.exp });
}
const meanImp = Math.round(calib.reduce((s, c) => s + c.iyilesme_yuzde, 0) / calib.length);

/* ===================== C. Belirsizlik bandı kapsama oranı ===================== */
log('C. Belirsizlik kapsama…');
const COV = QUICK ? 8 : 30;
const cover = { erisim_yuzde: 0, ortalama_tutum: 0, olumlu_yuzde: 0 };
const covRows = [];
for (let k = 0; k < COV; k++) {
  const m = msgAt(k * 5 + 1);
  // Gerçek dünya: ön kabulle aynı dağılımdan (log-normal σ=0.4) çekilmiş kuram ağırlıkları
  const truthW = Object.fromEntries(THEORIES.filter((t) => !t.core).map((t) => [t.id, Math.exp(0.4 * gauss())]));
  const truth = predict(m, { n: 600, bootstrap: 0, seed: 42, weightScale: truthW }).sonuc;
  const band = modelUncertainty(m, { n: 600, seed: 42, uncertaintyRuns: QUICK ? 20 : 40 }).bant_ga90;
  const row = { mesaj: `${m.domain}/${m.frame}/${m.channels.join('+')}` };
  for (const x of Object.keys(cover)) {
    const inside = truth[x] >= band[x][0] && truth[x] <= band[x][1];
    if (inside) cover[x]++;
    row[x] = inside;
  }
  covRows.push(row);
}
const coverage = Object.fromEntries(Object.entries(cover).map(([k, v]) => [k, Math.round((v / COV) * 100)]));

/* ===================== D. Tohum kararlılığı ===================== */
log('D. Tohum kararlılığı…');
const SEEDS = QUICK ? 5 : 10;
const stab = {};
for (const [id, sc] of Object.entries(SCENARIOS).slice(0, QUICK ? 3 : 10)) {
  const vals = Array.from({ length: SEEDS }, (_, s) => predict({ metin: sc.metin, institution: sc.kurum, channels: sc.kanallar }, { n: 2000, seed: 100 + s, bootstrap: 0 }).sonuc);
  const sd = (k) => { const a = vals.map((v) => v[k]); const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
  stab[id] = { erisim_sd: r3(sd('erisim_yuzde')), tutum_sd: r3(sd('ortalama_tutum')), olumlu_sd: r3(sd('olumlu_yuzde')) };
}
const maxTutumSd = Math.max(...Object.values(stab).map((s) => s.tutum_sd));

/* ===================== E. Performans ===================== */
log('E. Performans…');
const time = (fn, k = 3) => { const s = Date.now(); for (let i = 0; i < k; i++) fn(); return Math.round((Date.now() - s) / k); };
const perf = {
  predict_2000_ms: time(() => predict({ domain: 'saglik' }, { n: 2000, bootstrap: 120 })),
  predict_belirsizlikli_ms: time(() => predict({ domain: 'saglik' }, { n: 2000, bootstrap: 120, modelUncertainty: true }), 1),
  optimize_ms: time(() => optimize({ domain: 'ticaret', institution: 'kobi' }, { n: 700 }), 1),
  calibrate_4gozlem_ms: time(() => calibrate(calib.length ? [0, 1, 2, 3].map((i) => ({ message: msgAt(i), observed: { erisim_yuzde: 50, ortalama_tutum: 0.1 } })) : [], { n: 300 }), 1),
};

/* ===================== F. Mercek ayrışması ===================== */
log('F. Mercek ayrışması…');
const lensDiv = Object.entries(SCENARIOS).map(([id, sc]) => {
  const m = { metin: sc.metin, institution: sc.kurum, channels: sc.kanallar };
  const a = P(m, { lens: 'ana_akim' }).ortalama_tutum, e = P(m, { lens: 'elestirel' }).ortalama_tutum, b = P(m).ortalama_tutum;
  return { senaryo: sc.ad, ana_akim: a, elestirel: e, butunlesik: b, fark: r3(a - e), yon_catisiyor: Math.sign(a) !== Math.sign(e) };
});

/* ===================== rapor ===================== */
const summary = {
  tarih: new Date().toISOString(), mod: QUICK ? 'hizli' : 'tam', sure_sn: Math.round((Date.now() - t0) / 1000),
  yon_paketi: { gecen: dirPass, toplam: dir.length, oran_yuzde: Math.round((dirPass / dir.length) * 100) },
  kalibrasyon: { ortalama_test_iyilesme_yuzde: meanImp, gercek_sayisi: calib.length },
  kapsama_yuzde: coverage, kapsama_hedef: 90,
  kararlilik: { en_buyuk_tutum_sd: maxTutumSd },
  performans: perf,
  mercek: { yon_catisan_senaryo: lensDiv.filter((x) => x.yon_catisiyor).length, toplam: lensDiv.length },
};
const report = { summary, dir, calib, covRows, stab, lensDiv };

const md = [
  `# Kitle tahmini — doğrulama raporu`,
  ``,
  `${summary.tarih} · mod: ${summary.mod} · süre: ${summary.sure_sn} sn`,
  ``,
  `## Özet`,
  ``,
  `| Ölçüt | Sonuç | Hedef |`,
  `|---|---|---|`,
  `| A. Yön paketi (yerleşik bulgular) | **${dirPass}/${dir.length}** (%${summary.yon_paketi.oran_yuzde}) | %100 |`,
  `| B. Kalibrasyon — görülmemiş mesajda hata azalması | **%${meanImp}** ortalama (${calib.length} sentetik kurum) | > %50 |`,
  `| C. Belirsizlik bandı kapsama (erişim / tutum / olumlu) | **%${coverage.erisim_yuzde} / %${coverage.ortalama_tutum} / %${coverage.olumlu_yuzde}** | ≈ %90 |`,
  `| D. Tohum kararlılığı — en büyük tutum s.s. (n=2000) | **${maxTutumSd}** | < 0.02 |`,
  `| E. Tahmin süresi (n=2000, bootstrap) | **${perf.predict_2000_ms} ms** | < 500 ms |`,
  `| E. Tahmin + model belirsizliği | **${perf.predict_belirsizlikli_ms} ms** | < 2000 ms |`,
  `| F. Ana akım ve eleştirel mercekte tutum yönü çatışan senaryo | **${summary.mercek.yon_catisan_senaryo}/${lensDiv.length}** | (bilgi) |`,
  ``,
  `## A. Yön paketi`,
  ``,
  `| | Kuram | İddia | a | b | etki |`,
  `|---|---|---|---|---|---|`,
  ...dir.map((d) => `| ${d.gecti ? '✔' : '✖'} | ${d.kuram} | ${d.iddia} | ${d.a} | ${d.b} | ${d.etki} |`),
  ``,
  `## B. Kalibrasyon çapraz doğrulama`,
  ``,
  `Her sentetik kurumda "gerçek" sabit terimler ve kuram ağırlıkları rastgele çekildi; 6 mesajla kalibre edilip 3 görülmemiş mesajda ölçüldü (RMSE, 0–1 ölçeği).`,
  ``,
  `| Kurum | eğitim RMSE | test önce | test sonra | iyileşme | erişim sabiti gerçek → bulunan |`,
  `|---|---|---|---|---|---|`,
  ...calib.map((c) => `| ${c.gercek} | ${c.egitim_rmse} | ${c.test_once} | ${c.test_sonra} | %${c.iyilesme_yuzde} | ${c.exp_gercek} → ${c.exp_bulunan} |`),
  ``,
  `## C. Belirsizlik kapsama`,
  ``,
  `| Mesaj | erişim | tutum | olumlu |`,
  `|---|---|---|---|`,
  ...covRows.map((c) => `| ${c.mesaj} | ${c.erisim_yuzde ? '✔' : '✖'} | ${c.ortalama_tutum ? '✔' : '✖'} | ${c.olumlu_yuzde ? '✔' : '✖'} |`),
  ``,
  `## D. Tohum kararlılığı (${SEEDS} tohum, n=2000)`,
  ``,
  `| Senaryo | erişim s.s. | tutum s.s. | olumlu s.s. |`,
  `|---|---|---|---|`,
  ...Object.entries(stab).map(([k, s]) => `| ${k} | ${s.erisim_sd} | ${s.tutum_sd} | ${s.olumlu_sd} |`),
  ``,
  `## E. Performans (bu makine)`,
  ``,
  ...Object.entries(perf).map(([k, v]) => `- ${k}: ${v} ms`),
  ``,
  `## F. Mercek ayrışması`,
  ``,
  `| Senaryo | ana akım | eleştirel | bütünleşik | yön çatışıyor |`,
  `|---|---|---|---|---|`,
  ...lensDiv.map((x) => `| ${x.senaryo} | ${x.ana_akim} | ${x.elestirel} | ${x.butunlesik} | ${x.yon_catisiyor ? 'evet' : ''} |`),
  ``,
  `> Sentetik doğrulama modelin iç tutarlılığını ve kalibrasyon mekanizmasını sınar; gerçek kampanya`,
  `> verisiyle dış geçerlilik testi yerine geçmez.`,
].join('\n');

mkdirSync(new URL('../reports/', import.meta.url), { recursive: true });
writeFileSync(new URL('../reports/validation.json', import.meta.url), JSON.stringify(report, null, 1));
writeFileSync(new URL('../reports/validation.md', import.meta.url), md);
log('\n' + md.split('## A.')[0]);
log(`rapor: reports/validation.md · reports/validation.json`);
