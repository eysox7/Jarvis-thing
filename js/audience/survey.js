// MatrAIx "Survey" ortamının karşılığı: sentetik nüfustan seçilen personaları dil modeline
// rol yaptırarak sanal anket. Kuram motorunun aynı personalar için verdiği tahminle
// karşılaştırılır (üçgenleme): iki bağımsız yöntem uyuşuyorsa tahmine güven artar,
// uyuşmuyorsa nerede ayrıştıkları raporlanır.
// `chat(system, user)` dışarıdan verilir → sağlayıcıdan bağımsız ve test edilebilir.

import { predict, normalizeMessage } from './engine.js';
import { DIMENSIONS } from './personas.js';
import { extractJson } from '../util.js';

const LABEL = {
  yas: (v) => `${v} yaş`,
  cinsiyet: (v) => (v === 'kadin' ? 'kadın' : 'erkek'),
  yerlesim: (v) => ({ kirsal: 'kırsalda', kent: 'bir kentte', metropol: 'büyükşehirde' }[v] + ' yaşıyor'),
  egitim: (v) => ({ ilkokul: 'ilkokul mezunu', lise: 'lise mezunu', universite: 'üniversite mezunu', lisansustu: 'lisansüstü eğitimli' }[v]),
  gelir: (v) => `${({ dusuk: 'düşük', orta: 'orta', yuksek: 'yüksek' })[v]} gelirli`,
  ideoloji: (v) => `siyasi olarak ${({ sol: 'solda', merkez: 'merkezde', sag: 'sağda' })[v]}`,
  dindarlik: (v) => `dindarlığı ${({ dusuk: 'düşük', orta: 'orta', yuksek: 'yüksek' })[v]}`,
  dijital: (v) => `dijital becerisi ${({ dusuk: 'düşük', orta: 'orta', yuksek: 'yüksek' })[v]}`,
  medya: (v) => `haberleri çoğunlukla ${({ tv: 'televizyondan', sosyal: 'sosyal medyadan', haber_sitesi: 'haber sitelerinden', yazili: 'gazeteden', radyo_podcast: 'radyo/podcastten' })[v]} alıyor`,
  kurumsal_guven: (v) => `kurumlara güveni ${({ dusuk: 'düşük', orta: 'orta', yuksek: 'yüksek' })[v]}`,
  bilissel_ihtiyac: (v) => (v === 'yuksek' ? 'konuları derinlemesine düşünmeyi sever' : 'hızlı, sezgisel karar verir'),
  kanaat_onderi: (v) => (v === 'evet' ? 'çevresinde fikri sorulan biri' : ''),
  azinlik_kimlik: (v) => (v === 'evet' ? 'toplumda marjinalleştirilmiş bir kimliğe sahip' : ''),
};

/** Persona → doğal dil betimi (MatrAIx persona kartı). */
// Veri satırlarında bulunabilen ek alanlar (gerçek anket değişkenleri) — silikon örneklem bunları da görür
const EXTRA = {
  otoriterlik: (v) => `otoriter yatkınlığı ${v >= 0.7 ? 'yüksek (itaat, düzen, saygı önemli)' : v <= 0.3 ? 'düşük (bağımsızlık, merak önemli)' : 'orta'}`,
  ekonomi_algisi: (v) => `ülke ekonomisinin ${v > 0.2 ? 'iyileştiğini' : v < -0.2 ? 'kötüleştiğini' : 'aynı kaldığını'} düşünüyor`,
  parti_kimligi: (v) => (Math.abs(v) < 0.2 ? 'kendini bağımsız görüyor' : `kendini ${Math.abs(v) > 0.8 ? 'güçlü biçimde ' : ''}${v > 0 ? 'sağ/muhafazakâr partili' : 'sol/ilerici partili'} görüyor`),
  medya_kaynagi: (v) => ({ sag_medya: 'sağ eğilimli medyayı izliyor', sol_medya: 'sol eğilimli medyayı izliyor' }[v] || ''),
  onceki: (v) => `geçen sefer "${v}" seçmişti`,
  tehdit_algisi: (v) => (v >= 0.6 ? 'ülkenin güvenliğinin tehlikede olduğunu düşünüyor' : v <= 0.25 ? 'güvenlik kaygısı düşük' : ''),
  travma_skoru: (v) => (v >= 0.4 ? 'çocukluğunda ağır travmalar yaşadı' : v > 0 ? 'çocukluğunda bazı zorluklar yaşadı' : ''),
  zorunlu_goc: (v) => (v > 0 ? 'ailesiyle zorla göç etmek zorunda kaldı' : ''),
  deprem_maruziyeti: (v) => (v >= 1 ? 'depremde evini/yakınlarını kaybetti' : v > 0 ? 'büyük bir deprem yaşadı' : ''),
  is_kaybi: (v) => (v > 0 ? 'son yıllarda işini kaybetti' : ''),
};

export function describePersona(p) {
  const base = Object.keys(DIMENSIONS).filter((k) => p[k] !== undefined && p[k] !== null).map((k) => (LABEL[k] ? LABEL[k](p[k]) : `${k}: ${p[k]}`));
  const extra = Object.keys(EXTRA).filter((k) => p[k] !== undefined && p[k] !== null && p[k] !== '').map((k) => EXTRA[k](p[k]));
  const d = [...base, ...extra].filter(Boolean).join(', ');
  return p.__oyku ? `${d}. Hayat öyküsü: ${p.__oyku}` : d;
}

/** Nüfustan tabakalı örnek: seçilen boyutta her değerden sırayla alarak çeşitliliği korur. */
function stratified(people, k, by = 'ideoloji') {
  const groups = {};
  for (const x of people) (groups[x.persona[by]] ||= []).push(x);
  const lists = Object.values(groups);
  const out = [];
  for (let i = 0; out.length < k && lists.some((l) => l.length > i); i++) {
    for (const l of lists) if (l[i] && out.length < k) out.push(l[i]);
  }
  return out;
}

const SYSTEM = `Sen bir anket simülasyonusun. Sana verilen her persona İÇİN, o kişi olsaydın mesaja nasıl tepki vereceğini dürüstçe canlandır.
Personanın değerlerini, medya alışkanlığını ve kurumlara güvenini ciddiye al; herkesi olumlu gösterme.
Okuma türleri (Stuart Hall): "egemen" = mesajın amaçladığı anlamı benimser, "muzakereci" = kısmen kabul eder kendi koşullarına uyarlar, "karsit" = mesajı reddeder ya da tersinden okur.
YALNIZCA şu biçimde TEK bir JSON döndür:
{"yanitlar":[{"no":1,"tutum":-2..2 arası tam sayı,"okuma":"egemen|muzakereci|karsit","paylasir":true|false,"gerekce":"en fazla 15 kelime, birinci tekil şahıs"}]}`;

function messageBrief(m) {
  return [
    `Gönderen: ${m.inst.ad}`,
    `Alan: ${m.domain} · Çerçeve: ${m.frame} · Kanal: ${m.channels.join(', ')}`,
    m.text ? `Mesaj metni: """${m.text.slice(0, 1200)}"""` : `Mesaj: ${m.frame} çerçeveli, ${m.hegemonic > 0 ? 'egemen görüşle uyumlu' : m.hegemonic < 0 ? 'egemen görüşe karşı' : 'nötr'} bir ${m.domain} mesajı.`,
  ].join('\n');
}

const DEC = ['egemen', 'muzakereci', 'karsit'];
const topDec = (d) => DEC.reduce((a, b) => (d[b] > d[a] ? b : a), 'egemen');

function pearson(x, y) {
  const n = x.length; if (n < 3) return null;
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? Math.round((sxy / Math.sqrt(sxx * syy)) * 100) / 100 : null;
}

/**
 * @param {object} message
 * @param {object} o  {k=8, batch=6, by='ideoloji', chat: async (system, user) => string, ...predict opts}
 */
export async function runSurvey(message, o = {}) {
  if (typeof o.chat !== 'function') throw new Error('anket için model bağlantısı gerekli');
  const k = Math.max(2, Math.min(Number(o.k) || 8, 24));
  const batch = Math.max(1, Math.min(Number(o.batch) || 6, 12));
  const m = normalizeMessage(message);
  const sim = predict(message, { ...o, n: Math.max(400, k * 20), bootstrap: 0, keepPeople: true });
  const panel = stratified(sim._people, k, DIMENSIONS[o.by] ? o.by : 'ideoloji');

  const answers = [];
  for (let i = 0; i < panel.length; i += batch) {
    const part = panel.slice(i, i + batch);
    const user = messageBrief(m) + '\n\nPERSONALAR:\n' + part.map((x, j) => `${j + 1}. ${describePersona(x.persona)}`).join('\n');
    const raw = await o.chat(SYSTEM, user);
    const parsed = extractJson(raw);
    const list = Array.isArray(parsed?.yanitlar) ? parsed.yanitlar : Array.isArray(parsed) ? parsed : [];
    part.forEach((x, j) => {
      const a = list.find((r) => Number(r.no) === j + 1) || list[j];
      if (!a) return;
      const tutum = Math.max(-2, Math.min(2, Math.round(Number(a.tutum) || 0)));
      answers.push({
        persona: describePersona(x.persona),
        ajan: { tutum, okuma: DEC.includes(a.okuma) ? a.okuma : 'muzakereci', paylasir: !!a.paylasir, gerekce: String(a.gerekce || '').slice(0, 160) },
        model: { tutum: Math.round(x.out.attitude * 100) / 100, okuma: topDec(x.out.dec) },
      });
    });
  }
  if (!answers.length) throw new Error('model anket yanıtını beklenen JSON biçiminde döndürmedi');

  const n = answers.length;
  const dist = (arr) => Object.fromEntries(DEC.map((d) => [d, Math.round((arr.filter((x) => x === d).length / n) * 1000) / 10]));
  const decMatch = answers.filter((a) => a.ajan.okuma === a.model.okuma).length / n;
  const r = pearson(answers.map((a) => a.ajan.tutum / 2), answers.map((a) => a.model.tutum));
  return {
    yontem: 'MatrAIx tarzı persona-ajan anketi × kuram motoru (üçgenleme)',
    katilimci: n,
    ajan_ozet: {
      ortalama_tutum: Math.round((answers.reduce((s, a) => s + a.ajan.tutum, 0) / n / 2) * 1000) / 1000,
      paylasim_yuzde: Math.round((answers.filter((a) => a.ajan.paylasir).length / n) * 1000) / 10,
      okuma_yuzde: dist(answers.map((a) => a.ajan.okuma)),
    },
    model_ozet: {
      ortalama_tutum: Math.round((answers.reduce((s, a) => s + a.model.tutum, 0) / n) * 1000) / 1000,
      okuma_yuzde: dist(answers.map((a) => a.model.okuma)),
    },
    uyum: {
      okuma_eslesme_yuzde: Math.round(decMatch * 1000) / 10,
      tutum_korelasyonu: r,
      yorum: r === null ? 'korelasyon için yetersiz katılımcı'
        : r > 0.5 && decMatch > 0.5 ? 'iki yöntem büyük ölçüde uyuşuyor — tahmine güven yüksek'
        : r > 0.2 ? 'kısmi uyum — ayrışan personaları incele'
        : 'yöntemler ayrışıyor — kalibrasyon veya gerçek anket önerilir',
    },
    yanitlar: answers,
    uyari: 'Persona ajanları dil modelinin canlandırmasıdır; gerçek katılımcının yerini tutmaz.',
  };
}
