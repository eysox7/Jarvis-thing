// İletişim kuramları, birleştirilebilir "etki operatörleri" olarak.
// Her kuram, bir persona × mesaj × kurum × kanal karşılaşmasında gizil değişkenlere
// toplanabilir katkı (delta) üretir. Motor katkıları ağırlıkla toplar ve kuram başına kaydeder;
// böylece her tahmin "hangi kuram neyi ne kadar itti" diye açıklanabilir.
//
// Gizil değişkenler (lojit/toplamsal uzayda):
//   exp    maruz kalma         att    dikkat/ilgilenim     cred   kaynak güvenilirliği (-1..1)
//   shift  tutum değişimi       share  paylaşma/ifade        comp   anlama/bilgi kazanımı
//   adopt  benimseme/davranış   dom/neg/opp  Hall kodaçımı   delib  müzakereci katılım
//
// gelenek: 'ana_akim' (etkiler/işlevselci) | 'elestirel' (eleştirel/kültürel)
// asama:   'kanal'  → her kanal için ayrı uygulanır (maruz kalma)
//          'birey'  → bireysel işlem
//          'nufus'  → ilk geçişin nüfus toplamlarına bakar (sosyal etkileşim)
//
// Katsayılar kuramların yön ve göreli büyüklüğünü kodlar; mutlak değerler kalibrasyonla
// (calibrate.js) kurumun gözlenmiş verisine oturtulmalıdır.

const logit = (p) => Math.log(Math.max(1e-4, Math.min(1 - 1e-4, p)) / (1 - Math.max(1e-4, Math.min(1 - 1e-4, p))));
const sig = (x) => 1 / (1 + Math.exp(-x));
export { logit, sig };

/** Persona–çerçeve uyumu: hangi çerçeve kime daha çok işler (çerçeveleme alan yazınından). */
function frameFit(frame, f) {
  switch (frame) {
    case 'kayip': return 0.15 * f.yas + 0.1 * (1 - f.nfc);
    case 'kazanc': return 0.12 * (1 - f.yas) + 0.08 * f.gelir;
    case 'korku': return 0.2 * (1 - f.nfc) - 0.15 * f.egitim;          // aşırı korku eğitimlide geri teper
    case 'umut': return 0.15 * (1 - f.yas);
    case 'ahlaki': return 0.3 * f.dindarlik - 0.1;
    case 'ekonomik': return 0.2 * (1 - f.gelir);
    case 'catisma': return 0.1 * Math.abs(f.ideoloji) - 0.05;
    case 'insan_hikayesi': return 0.15 * (1 - f.nfc) + 0.05 * f.kadin;
    case 'sorumluluk': return 0.1 * f.egitim;
    default: return 0;
  }
}

export const THEORIES = [
  /* ===================== ANA AKIM ===================== */
  {
    id: 'lasswell', ad: 'Lasswell formülü', kurucu: 'H. Lasswell (1948)', gelenek: 'ana_akim', asama: 'kanal', core: true,
    ozet: 'Kim, ne dedi, hangi kanalla, kime, hangi etkiyle — kanalın personaya erişimi maruz kalmanın omurgasıdır.',
    apply: ({ p, chan }) => ({ exp: logit(chan.reach[p.medya] ?? 0.3) }),
  },
  {
    id: 'gundem_belirleme', ad: 'Gündem belirleme', kurucu: 'McCombs & Shaw (1972)', gelenek: 'ana_akim', asama: 'kanal',
    ozet: 'Tekrar ve ana akım görünürlük, konunun önemini (salience) ve maruz kalmayı artırır.',
    apply: ({ m, chan }) => {
      const r = Math.log(Math.max(1, m.repetition));
      return { exp: 0.55 * r + 0.25 * chan.mainstream, att: 0.35 * r };
    },
  },
  {
    id: 'kullanimlar_doyumlar', ad: 'Kullanımlar ve doyumlar', kurucu: 'Katz, Blumler & Gurevitch (1974)', gelenek: 'ana_akim', asama: 'birey',
    ozet: 'Etkin izleyici: kişi ihtiyacını karşılayan içeriğe yönelir; alan ilgisi dikkati ve paylaşımı belirler.',
    apply: ({ interest }) => ({ att: 2.4 * (interest - 0.5), share: 1.0 * (interest - 0.5) }),
  },
  {
    id: 'kaynak_guvenilirligi', ad: 'Kaynak güvenilirliği', kurucu: 'Hovland & Weiss (1951)', gelenek: 'ana_akim', asama: 'birey',
    ozet: 'Güvenilir ve uzman kaynak daha ikna edicidir; kuruma güven kişiye göre değişir.',
    apply: ({ f, inst, dom }) => {
      const exp = (inst.uzmanlik?.[dom.id] ?? 0.3) * dom.expertise;
      const trust = (f.kurumsal_guven - 0.5) * (0.4 + 0.8 * inst.hegemonik);   // kurumsal güven, kurumsallaşmış kaynakta daha belirleyici
      const cred = Math.max(-1, Math.min(1, (inst.guvenilirlik - 0.5) * 1.6 + 0.6 * exp - 0.15 + trust));
      return { cred, shift: 0.8 * cred };
    },
  },
  {
    id: 'secici_maruziyet', ad: 'Seçici maruziyet & düşmanca medya', kurucu: 'Festinger (1957); Vallone vd. (1985)', gelenek: 'ana_akim', asama: 'birey',
    ozet: 'İnsanlar görüşlerine uymayan kaynaktan kaçınır, karşı taraftaki kaynağı yanlı algılar.',
    apply: ({ f, m, inst, dom }) => {
      const dInst = Math.abs(f.ideoloji - inst.ideoloji) / 2;
      const dMsg = Math.abs(f.ideoloji - m.slant) / 2;
      const w = dom.ideological;
      return { exp: -0.9 * w * dInst, shift: 1.6 * w * (0.4 - (0.5 * dInst + 0.5 * dMsg)), cred: -0.5 * w * dInst };
    },
  },
  {
    id: 'cerceveleme', ad: 'Çerçeveleme', kurucu: 'Goffman (1974); Entman (1993); Kahneman & Tversky', gelenek: 'ana_akim', asama: 'birey',
    ozet: 'Aynı içerik farklı çerçeveyle farklı etki üretir; çerçevenin alana ve kişiye uyumu belirleyicidir.',
    apply: ({ f, m, dom }) => {
      const domFit = (dom.frames[m.frame] ?? 1) - 1;
      const fit = domFit + frameFit(m.frame, f);
      return { shift: 1.0 * fit, att: 0.8 * fit + (m.frame === 'catisma' || m.frame === 'korku' ? 0.3 : 0), share: m.frame === 'catisma' ? 0.4 : m.frame === 'insan_hikayesi' ? 0.25 : 0 };
    },
  },
  {
    id: 'elm', ad: 'Ayrıntılandırma olasılığı modeli', kurucu: 'Petty & Cacioppo (1986)', gelenek: 'ana_akim', asama: 'birey',
    ozet: 'Motivasyon ve yetenek yüksekse merkezi yol (argüman kalitesi), düşükse çevresel yol (ipuçları, kaynak) işler.',
    apply: ({ f, m, interest, state }) => {
      const e = sig(3 * (0.55 * f.nfc + 0.45 * interest + 0.2 * f.egitim - 0.6));
      return {
        shift: e * 2.4 * (m.quality - 0.5) + (1 - e) * (1.4 * (m.cues - 0.5) + 0.5 * state.cred),
        comp: 1.2 * e * m.quality,
        delib: 0.6 * e,
      };
    },
  },
  {
    id: 'ekme', ad: 'Ekme (kültivasyon)', kurucu: 'Gerbner & Gross (1976)', gelenek: 'ana_akim', asama: 'birey',
    ozet: 'Yoğun TV izleyicisi dünyayı TV gibi görür: korku çerçevesine açıktır, görüşleri "ana akımlaşır".',
    apply: ({ p, m, dom, channels }) => {
      if (p.medya !== 'tv') return {};
      const onTv = channels.includes('tv') ? 1 : 0.4;
      return { shift: onTv * ((m.frame === 'korku' || m.frame === 'kayip' ? 0.5 : 0) + 0.35 * dom.ideological * 0.5) };
    },
  },
  {
    id: 'bilgi_acigi', ad: 'Bilgi açığı hipotezi', kurucu: 'Tichenor, Donohue & Olien (1970)', gelenek: 'ana_akim', asama: 'birey',
    ozet: 'Bilgi akışı arttıkça yüksek SES grupları daha hızlı öğrenir; dijital kanal açığı büyütür.',
    apply: ({ f, channels, CH }) => {
      const dig = channels.reduce((s, c) => s + (CH[c]?.digital ?? 0), 0) / channels.length;
      return { comp: 2 * ((f.egitim + f.gelir) / 2 - 0.4) + 1.2 * dig * (f.dijital - 0.5) };
    },
  },
  {
    id: 'tepkisellik', ad: 'Psikolojik tepkisellik', kurucu: 'J. Brehm (1966); Dillard & Shen (2005)', gelenek: 'ana_akim', asama: 'birey',
    ozet: 'Özgürlüğü tehdit edilen kişi direnir: baskıcı çerçeve, aşırı tekrar ve güvenilmeyen kaynak ters teper.',
    apply: ({ f, m, state }) => {
      const pressure = (m.frame === 'korku' ? 0.7 : m.frame === 'kayip' || m.frame === 'catisma' ? 0.4 : m.frame === 'ahlaki' ? 0.3 : 0)
        + 0.25 * Math.log(Math.max(1, m.repetition)) + 0.3 * Math.max(0, m.hegemonic);
      const proneness = 0.5 * (1 - f.kurumsal_guven) + 0.3 * (1 - f.yas) + 0.2 * f.egitim;
      return { shift: -1.4 * pressure * proneness - 0.6 * Math.max(0, -state.cred) * proneness, share: 0.3 * pressure * proneness };
    },
  },
  {
    id: 'yeniliklerin_yayilmasi', ad: 'Yeniliklerin yayılması', kurucu: 'E. Rogers (1962)', gelenek: 'ana_akim', asama: 'nufus',
    ozet: 'Yenilikçiler ve erken benimseyenler önce, geç çoğunluk sosyal kanıt geldikçe benimser.',
    apply: ({ f, m }) => ({ adopt: 3 * m.novelty * (f.innovativeness - 0.5) - 1.2 * m.novelty }),
    population: (agg) => ({ f, m }) => ({ adopt: 2.5 * m.novelty * (agg.earlyAdopt - 0.15) * (1 - f.innovativeness) }),
  },
  {
    id: 'iki_asamali_akis', ad: 'İki aşamalı akış', kurucu: 'Lazarsfeld, Berelson & Gaudet (1944); Katz', gelenek: 'ana_akim', asama: 'nufus',
    ozet: 'Mesaj önce kanaat önderlerine ulaşır, onlar aracılığıyla geri kalana yayılır ve yorumlanır.',
    apply: ({ f }) => (f.leader ? { exp: 0.8, att: 0.5, share: 0.9 } : {}),
    population: (agg) => ({ f }) => (f.leader ? {} : { exp: 1.6 * agg.leaderShare, shift: 0.6 * agg.leaderAttitude }),
  },
  {
    id: 'suskunluk_sarmali', ad: 'Suskunluk sarmalı', kurucu: 'E. Noelle-Neumann (1974)', gelenek: 'ana_akim', asama: 'nufus',
    ozet: 'Kendini azınlıkta sanan, tartışmalı konularda susar; çoğunluk sanılan görüş daha yüksek sesle duyulur.',
    apply: () => ({}),
    population: (agg) => ({ f, m, state }) => {
      const mine = Math.tanh(state.shift);
      const agree = Math.sign(mine) === Math.sign(agg.climate) ? 1 : -1;
      return { share: agree * 2.2 * m.controversy * Math.min(1, Math.abs(agg.climate) * 3) * (1 - 0.5 * f.leader) };
    },
  },

  /* ===================== ELEŞTİREL ===================== */
  {
    id: 'kodlama_kodacimlama', ad: 'Kodlama / kodaçımlama', kurucu: 'Stuart Hall (1973)', gelenek: 'elestirel', asama: 'birey',
    ozet: 'Metin "tercih edilen anlam"la kodlanır; izleyici toplumsal konumuna göre egemen, müzakereci ya da karşıt okur.',
    apply: ({ f, m, inst }) => {
      // Tercih edilen anlamın egemen ideolojiyle hizası
      const encoded = 0.5 * m.hegemonic + 0.5 * (inst.hegemonik - 0.5) * 2;
      // Kişinin egemen düzenle (göndericiyle değil!) hizası; m.H = egemen bloğun ideolojik konumu
      const aligned = 0.45 * (f.kurumsal_guven - 0.5) * 2 + 0.35 * (0.75 - Math.abs(f.ideoloji - m.H)) + 0.2 * (f.social_position - 0.5) * 2 - 0.3 * f.marginal;
      const fit = encoded * aligned;              // aynı yönde → egemen okuma
      const dom = 1.8 * fit + 0.4 * (1 - Math.abs(encoded));
      const opp = -1.8 * fit + 0.8 * f.marginal * Math.max(0, encoded) + 0.6 * f.nfc * (1 - f.kurumsal_guven) * Math.abs(encoded);
      const neg = 1.0;   // Hall: müzakereci okuma en yaygın konumdur
      const z = Math.exp(dom) + Math.exp(neg) + Math.exp(opp);
      return { dom, neg, opp, shift: 1.1 * (Math.exp(dom) - Math.exp(opp)) / z };
    },
  },
  {
    id: 'propaganda_modeli', ad: 'Propaganda modeli (5 filtre)', kurucu: 'Herman & Chomsky (1988)', gelenek: 'elestirel', asama: 'kanal',
    ozet: 'Sahiplik, reklam, resmi kaynak, "flak" ve ortak düşman filtreleri ana akım kanalda neyin büyüyeceğini seçer.',
    apply: ({ f, m, inst, chan }) => {
      const filters =
        (inst.sahiplik === 'devlet' || inst.sahiplik === 'sermaye' ? 0.3 : -0.2) +     // sahiplik
        0.3 * Math.max(m.commercial, inst.ticari) +                                      // reklam
        0.35 * (inst.hegemonik - 0.5) * 2 +                                              // resmi kaynak
        (m.hegemonic < 0 ? 0.6 * m.hegemonic : 0) +                                      // flak
        (m.frame === 'catisma' && m.hegemonic > 0 ? 0.25 : 0);                           // ortak düşman
      const critical = (1 - f.kurumsal_guven) * f.nfc;                                   // filtreyi "gören" izleyici
      return { exp: chan.mainstream * filters, shift: -0.6 * critical * chan.mainstream * Math.max(0, filters) };
    },
  },
  {
    id: 'ekonomi_politik', ad: 'Medyanın ekonomi politiği & dijital uçurum', kurucu: 'Golding & Murdock; Schiller; van Dijk', gelenek: 'elestirel', asama: 'kanal',
    ozet: 'Erişim yapısal olarak eşitsizdir: düşük gelir ve düşük dijital beceri dijital kanallardan dışlanır.',
    apply: ({ f, chan }) => ({ exp: -1.4 * chan.digital * (1 - f.dijital) * (1 - 0.5 * f.gelir) + (chan.digital ? 0 : -0.3 * f.gelir * (1 - f.yas)) }),
  },
  {
    id: 'kultur_endustrisi', ad: 'Kültür endüstrisi', kurucu: 'Adorno & Horkheimer (1944)', gelenek: 'elestirel', asama: 'birey',
    ozet: 'Standartlaşmış ticari içerik her yerdedir ve edilgen tüketilir: erişim artar, eleştirel düşünme ve anlama azalır.',
    apply: ({ f, m, inst }) => {
      const c = Math.max(m.commercial, inst.ticari);
      return { exp: 0.5 * c, att: 0.4 * c * (1 - f.nfc), comp: -0.7 * c, delib: -0.9 * c, shift: 0.35 * c * (1 - f.nfc) - 0.35 * c * f.nfc };
    },
  },
  {
    id: 'hegemonya', ad: 'Hegemonya', kurucu: 'A. Gramsci (1930\'lar)', gelenek: 'elestirel', asama: 'birey',
    ozet: 'Egemen fikirler "sağduyu" olarak rıza üretir; karşı-hegemonik mesaj çevredeki gruplarda yankı bulur.',
    apply: ({ f, m }) => {
      if (m.hegemonic >= 0) return { shift: 0.7 * m.hegemonic * (f.kurumsal_guven - 0.35) };
      const periphery = 0.6 * f.marginal + 0.4 * (1 - f.kurumsal_guven) + 0.3 * (1 - f.social_position);
      return { shift: 0.7 * -m.hegemonic * (periphery - 0.55), share: 0.4 * -m.hegemonic * periphery };
    },
  },
  {
    id: 'kamusal_alan', ad: 'Kamusal alan', kurucu: 'J. Habermas (1962)', gelenek: 'elestirel', asama: 'birey',
    ozet: 'Akılcı-eleştirel tartışma kaliteli, ticari olmayan, sakin çerçeveli içerikle beslenir.',
    apply: ({ f, m, inst }) => {
      const d = 1.6 * (m.quality - 0.5) + 0.8 * f.nfc - 1.0 * Math.max(m.commercial, inst.ticari) - (m.frame === 'catisma' || m.frame === 'korku' ? 0.5 : 0);
      return { delib: d, share: 0.25 * d * f.leader };
    },
  },
  {
    id: 'feminist_kesisimsel', ad: 'Feminist & kesişimsel eleştiri', kurucu: 'Mulvey (1975); hooks; Crenshaw (1989)', gelenek: 'elestirel', asama: 'birey',
    ozet: 'Temsil önemlidir: kapsayıcı temsil kadın ve marjinal gruplarda karşılık bulur, kalıp yargı karşıt okumayı besler.',
    apply: ({ f, m }) => {
      const w = 0.5 * f.kadin + 0.7 * f.marginal;
      return { shift: 0.9 * m.representation * w, att: 0.4 * m.representation * w, opp: m.representation < 0 ? -1.5 * m.representation * w : 0 };
    },
  },
];

export const THEORY_BY_ID = Object.fromEntries(THEORIES.map((t) => [t.id, t]));

/** Mercek → kuram ağırlıkları. 'butunlesik' her iki geleneği birlikte koşturur. */
export function lensWeights(lens = 'butunlesik', overrides = {}) {
  const w = {};
  for (const t of THEORIES) {
    w[t.id] = t.core ? 1
      : lens === 'ana_akim' ? (t.gelenek === 'ana_akim' ? 1 : 0)
      : lens === 'elestirel' ? (t.gelenek === 'elestirel' ? 1 : 0)
      : 1;
  }
  for (const [k, v] of Object.entries(overrides || {})) if (k in w && Number.isFinite(+v)) w[k] = +v;
  return w;
}
