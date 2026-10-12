// Kitle tahmin çekirdeği: saf modül, tarayıcı gerekmez.
import { samplePopulation, DIMENSIONS } from '../js/audience/personas.js';
import { predict, compare, optimize, normalizeMessage } from '../js/audience/engine.js';
import { THEORIES, lensWeights } from '../js/audience/theories.js';
import { calibrate } from '../js/audience/calibrate.js';
import { extractMessage } from '../js/audience/extract.js';
import { runSurvey, describePersona } from '../js/audience/survey.js';

const fails = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✖ ') + m); if (!c) fails.push(m); };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const P = (msg, o = {}) => predict(msg, { n: 1500, bootstrap: 0, ...o });

console.log('\n[1] Persona örnekleyici (MatrAIx katmanı)');
const a = samplePopulation({ n: 300, seed: 7 }), b = samplePopulation({ n: 300, seed: 7 });
ok(JSON.stringify(a) === JSON.stringify(b), 'aynı tohum → aynı nüfus');
ok(a.every((p) => Object.keys(DIMENSIONS).every((k) => p[k] in DIMENSIONS[k].base)), 'her persona tüm boyutlarda geçerli değer taşır');
const big = samplePopulation({ n: 6000, seed: 1 });
const share = (k, v) => big.filter((p) => p[k] === v).length / big.length;
ok(Math.abs(share('cinsiyet', 'kadin') - 0.5) < 0.03, 'cinsiyet marjinali ~%50');
const old = big.filter((p) => p.yas === '65+'), young = big.filter((p) => p.yas === '18-24');
const dl = (g) => g.filter((p) => p.dijital === 'dusuk').length / g.length;
ok(dl(old) > dl(young) + 0.3, 'koşullu yapı: 65+ dijital okuryazarlığı daha düşük');
ok(samplePopulation({ n: 100, target: { yas: '18-24' } }).every((p) => p.yas === '18-24'), 'hedef kitle sabitlenebilir');
ok(samplePopulation({ n: 100, target: { ideoloji: ['sol', 'merkez'] } }).every((p) => p.ideoloji !== 'sag'), 'hedef kitle filtrelenebilir');
const mg = samplePopulation({ n: 3000, marginals: { yerlesim: { kirsal: 100, kent: 0, metropol: 0 } } });
ok(mg.every((p) => p.yerlesim === 'kirsal'), 'kurum marjinalleri varsayılanı ezer');

console.log('\n[2] Mesaj normalleştirme');
ok(throws(() => normalizeMessage({ domain: 'yok' })), 'bilinmeyen alan reddedilir');
ok(throws(() => normalizeMessage({ frame: 'yok' })), 'bilinmeyen çerçeve reddedilir');
ok(throws(() => normalizeMessage({ channels: ['yok'] })), 'bilinmeyen kanal reddedilir');
ok(throws(() => normalizeMessage({ institution: 'yok' })), 'bilinmeyen kurum reddedilir');
ok(normalizeMessage({ institution: 'belediye' }).channels.includes('sosyal'), 'kanal verilmezse kurumun kanalları kullanılır');
ok(normalizeMessage({ institution: { tur: 'stk', ad: 'Deniz Derneği', guvenilirlik: 0.9 } }).inst.guvenilirlik === 0.9, 'özel kurum profili tamamlanır');

console.log('\n[3] Tahmin çıktısı');
const r = predict({ domain: 'saglik', institution: 'kamu_bakanlik', frame: 'kayip', channels: ['tv', 'sms'] }, { n: 1000, segmentBy: ['yas'] });
const s = r.sonuc;
ok(s.erisim_yuzde > 0 && s.erisim_yuzde <= 100, 'erişim yüzdesi geçerli');
ok(s.erisim_ga90[0] <= s.erisim_yuzde && s.erisim_yuzde <= s.erisim_ga90[1], 'bootstrap aralığı tahmini kapsar');
const h = s.hall_okuma_yuzde;
ok(Math.abs(h.egemen + h.muzakereci + h.karsit - 100) < 0.5, 'Hall okumaları toplamı %100');
ok(r.kuramlar.length === THEORIES.length, 'bütünleşik mercekte tüm kuramlar raporlanır');
ok(Object.keys(r.segmentler.yas).length === 6, 'yaş segmentleri döner');
ok(JSON.stringify(predict({ domain: 'spor' }, { n: 300 })) === JSON.stringify(predict({ domain: 'spor' }, { n: 300 })), 'tahmin deterministik');

console.log('\n[4] Kuram yönleri (her kuram beklenen yöne itiyor mu?)');
const hi = P({ domain: 'bilim', quality: 0.95 }, { target: { bilissel_ihtiyac: 'yuksek' } }).sonuc.ortalama_tutum;
const lo = P({ domain: 'bilim', quality: 0.1 }, { target: { bilissel_ihtiyac: 'yuksek' } }).sonuc.ortalama_tutum;
ok(hi > lo, `ELM: argüman kalitesi merkezi yolda tutumu artırır (${hi} > ${lo})`);
const left = P({ domain: 'siyaset', institution: 'parti_iktidar', slant: 'sag' }, { target: { ideoloji: 'sol' } }).sonuc.ortalama_tutum;
const right = P({ domain: 'siyaset', institution: 'parti_iktidar', slant: 'sag' }, { target: { ideoloji: 'sag' } }).sonuc.ortalama_tutum;
ok(right > left, `Düşmanca medya: sağ kurumun mesajı sağda daha olumlu (${right} > ${left})`);
const yS = P({ channels: ['sosyal'] }, { target: { yas: '18-24' } }).sonuc.erisim_yuzde;
const oS = P({ channels: ['sosyal'] }, { target: { yas: '65+' } }).sonuc.erisim_yuzde;
ok(yS > oS + 15, `Dijital uçurum: sosyal medya gençlere çok daha fazla ulaşır (${yS} vs ${oS})`);
const flakTv = P({ domain: 'siyaset', institution: 'bagimsiz_medya', channels: ['tv'], hegemonic: 'muhalif' }).sonuc.erisim_yuzde;
const domTv = P({ domain: 'siyaset', institution: 'anaakim_medya', channels: ['tv'], hegemonic: 'egemen' }).sonuc.erisim_yuzde;
ok(domTv > flakTv, `Propaganda modeli: ana akım kanal egemen mesajı büyütür (${domTv} > ${flakTv})`);
const mOpp = P({ institution: 'kamu_bakanlik', hegemonic: 'egemen' }, { target: { azinlik_kimlik: 'evet' } }).sonuc.hall_okuma_yuzde.karsit;
const nOpp = P({ institution: 'kamu_bakanlik', hegemonic: 'egemen' }, { target: { azinlik_kimlik: 'hayir' } }).sonuc.hall_okuma_yuzde.karsit;
ok(mOpp > nOpp, `Hall: marjinal gruplar egemen mesajı daha çok karşıt okur (${mOpp} > ${nOpp})`);
const cMarg = P({ hegemonic: 'muhalif' }, { target: { azinlik_kimlik: 'evet' } }).sonuc.ortalama_tutum;
const cMain = P({ hegemonic: 'muhalif' }, { target: { azinlik_kimlik: 'hayir', kurumsal_guven: 'yuksek' } }).sonuc.ortalama_tutum;
ok(cMarg > cMain, `Hegemonya: karşı-hegemonik mesaj çevrede yankı bulur (${cMarg} > ${cMain})`);
const kc = P({ commercial: 1, domain: 'ticaret' }).sonuc, kn = P({ commercial: 0, domain: 'ticaret' }).sonuc;
ok(kc.muzakere_yuzde < kn.muzakere_yuzde, 'Kültür endüstrisi + kamusal alan: ticari içerik müzakereyi düşürür');
const novInnov = P({ novelty: 0.9 }, { target: { yas: '18-24', dijital: 'yuksek' } }).sonuc.benimseme_yuzde;
const novLag = P({ novelty: 0.9 }, { target: { yas: '65+', dijital: 'dusuk' } }).sonuc.benimseme_yuzde;
ok(novInnov > novLag, `Yayılma: yenilikçiler yeniliği daha çok benimser (${novInnov} > ${novLag})`);
const rep1 = P({ repetition: 1, channels: ['haber_sitesi'] }).sonuc.erisim_yuzde, rep8 = P({ repetition: 8, channels: ['haber_sitesi'] }).sonuc.erisim_yuzde;
ok(rep8 > rep1, 'Gündem belirleme: tekrar erişimi artırır');
const repW = P({ representation: 1 }, { target: { cinsiyet: 'kadin' } }).sonuc.ortalama_tutum, stW = P({ representation: -1 }, { target: { cinsiyet: 'kadin' } }).sonuc.ortalama_tutum;
ok(repW > stW, 'Feminist eleştiri: kapsayıcı temsil kadınlarda tutumu artırır');
const spLow = P({ domain: 'siyaset', institution: 'parti_iktidar', controversy: 0 }).sonuc.paylasim_yuzde;
const spHigh = P({ domain: 'siyaset', institution: 'parti_iktidar', controversy: 1 }).sonuc.paylasim_yuzde;
ok(spLow !== spHigh, 'Suskunluk sarmalı: tartışmalılık ifade/paylaşımı değiştirir');

console.log('\n[5] Mercekler ve araçlar');
const wa = lensWeights('ana_akim'), we = lensWeights('elestirel');
ok(THEORIES.filter((t) => t.gelenek === 'elestirel').every((t) => wa[t.id] === 0), 'ana akım mercek eleştirel kuramları kapatır');
ok(THEORIES.filter((t) => t.gelenek === 'ana_akim' && !t.core).every((t) => we[t.id] === 0), 'eleştirel mercek ana akımı kapatır (omurga hariç)');
ok(P({}, { lens: 'ana_akim' }).sonuc.hall_okuma_yuzde === null, 'Hall kapalıyken okuma uydurulmaz');
const cmp = compare([{ ad: 'A', frame: 'kazanc', domain: 'saglik' }, { ad: 'B', frame: 'kayip', domain: 'saglik' }], { n: 600 });
ok(['A', 'B'].includes(cmp.kazanan) && cmp.siralama.length === 2, 'compare kazananı seçer');
const opt = optimize({ domain: 'ticaret', institution: 'kobi' }, { n: 200, frames: ['kazanc', 'korku'], channelSets: [['sosyal'], ['tv']] });
ok(opt.en_iyi.length === 4 && opt.en_iyi[0].skor >= opt.en_iyi[3].skor, 'optimize ızgarayı sıralar');

console.log('\n[6] Kurum verisiyle kalibrasyon');
const truth = { intercepts: { exp: -1.2, shift: 0.6 } };
const cmsgs = [
  { domain: 'saglik', institution: 'belediye', frame: 'kayip', channels: ['sosyal'] },
  { domain: 'saglik', institution: 'belediye', frame: 'kazanc', channels: ['tv'] },
  { domain: 'kamu_hizmeti', institution: 'belediye', frame: 'sorumluluk', channels: ['sms'] },
];
const cobs = cmsgs.map((m) => {
  const o = predict(m, { n: 300, bootstrap: 0, calibration: truth }).sonuc;
  return { message: m, observed: { erisim_yuzde: o.erisim_yuzde, ortalama_tutum: o.ortalama_tutum } };
});
const cal = calibrate(cobs, { rounds: 2 });
ok(cal.fit.sonra_rmse < cal.fit.once_rmse / 3, `kalibrasyon hatayı düşürür (RMSE ${cal.fit.once_rmse} → ${cal.fit.sonra_rmse})`);
ok(cal.intercepts.exp < -0.5, `erişim sabiti doğru yöne gider (${cal.intercepts.exp})`);
const after = predict(cmsgs[0], { n: 300, bootstrap: 0, calibration: cal }).sonuc.erisim_yuzde;
ok(Math.abs(after - cobs[0].observed.erisim_yuzde) < 6, `kalibre tahmin gözleme yakın (${after} vs ${cobs[0].observed.erisim_yuzde})`);
const one = calibrate(cobs.slice(0, 1));
ok(!one.fit.agirliklar_ayarlandi && one.fit.not, 'az veride kuram ağırlıklarına dokunulmaz ve uyarılır');
ok(throws(() => calibrate([{ message: {}, observed: { uydurma: 3 } }])), 'bilinmeyen metrik reddedilir');
ok(throws(() => calibrate([])), 'boş gözlem reddedilir');

console.log('\n[7] Metinden mesaj çıkarımı');
const e1 = extractMessage('Grip aşısı olmazsanız sevdiklerinizi riske atarsınız. Araştırmaya göre %40 daha az hastalanıyorsunuz.');
ok(e1.message.domain === 'saglik' && e1.message.frame === 'kayip', 'sağlık + kayıp çerçevesi bulundu');
ok(e1.message.quality > 0.6 && e1.kanit.arguman.length >= 2, 'kanıt ifadeleri argüman kalitesini artırır');
const e2 = extractMessage('Büyük indirim! Tüm ürünlerde fırsat, hemen sipariş ver 🔥');
ok(e2.message.domain === 'ticaret' && e2.message.commercial >= 0.8, 'ticari mesaj tanındı');
const e3 = extractMessage('Emekçilerin haklarımız için direnişi sürüyor, sömürüye karşı grev!');
ok(e3.message.hegemonic < 0 && e3.message.slant < 0, 'karşı-hegemonik ve sol eğilim tanındı');
ok(!('eşit' in (e3.kanit.temsil || {})), '"eşitsizlik" kapsayıcı temsil sayılmaz');
const viaText = normalizeMessage({ metin: 'Deprem sonrası tahliye uyarısı: acil toplanma alanlarına gidin', frame: 'umut' });
ok(viaText.domain === 'kriz' && viaText.frame === 'umut', 'metin eksikleri doldurur, açık alan önceliklidir');
ok(predict({ metin: 'Yeni metro hattımız ilk kez açılıyor' }, { n: 200, bootstrap: 0 }).cikarim?.yenilik?.length > 0, 'tahmin çıkarım kanıtını raporlar');

console.log('\n[8] Persona-ajan anketi (MatrAIx Survey)');
ok(describePersona({ yas: '25-34', cinsiyet: 'kadin', yerlesim: 'metropol', egitim: 'universite', gelir: 'orta', ideoloji: 'sol', dindarlik: 'dusuk', dijital: 'yuksek', medya: 'sosyal', kurumsal_guven: 'dusuk', bilissel_ihtiyac: 'yuksek', kanaat_onderi: 'hayir', azinlik_kimlik: 'hayir' }).includes('sosyal medyadan'), 'persona doğal dile çevrilir');
let calls = 0; const prompts = [];
// Sahte persona ajanı: solda olanlar karşıt, diğerleri egemen okur
const fakeChat = async (system, user) => {
  calls++; prompts.push(user);
  const lines = user.split('PERSONALAR:')[1].trim().split('\n');
  return JSON.stringify({ yanitlar: lines.map((l, i) => {
    const left = l.includes('solda');
    return { no: i + 1, tutum: left ? -2 : 1, okuma: left ? 'karsit' : 'egemen', paylasir: !left, gerekce: 'test' };
  }) });
};
const sv = await runSurvey({ domain: 'siyaset', institution: 'parti_iktidar', hegemonic: 'egemen' }, { k: 9, batch: 4, chat: fakeChat });
ok(sv.katilimci === 9 && calls === 3, `9 persona 3 partide soruldu (${calls} çağrı)`);
ok(prompts[0].includes('Siyasi parti (iktidar)'), 'kurum bilgisi personaya iletildi');
ok(['solda', 'merkezde', 'sağda'].every((w) => prompts.join('').includes(w)), 'tabakalı panel ideolojik çeşitliliği korur');
ok(sv.ajan_ozet.okuma_yuzde.karsit > 0 && sv.uyum.tutum_korelasyonu !== null, 'ajan özeti ve uyum metrikleri hesaplandı');
ok(sv.uyum.tutum_korelasyonu > 0, `kuram motoru ile ajanlar aynı yönde (r=${sv.uyum.tutum_korelasyonu})`);
let threw = false; try { await runSurvey({}, { chat: async () => 'json değil' }); } catch { threw = true; }
ok(threw, 'bozuk model yanıtı açık hata verir');

console.log('');
if (fails.length) { console.log(`✖ ${fails.length} başarısız`); process.exit(1); }
console.log('✔ kitle testleri geçti');
