// İLETİŞİM MERCEĞİ — iletişim kuramları karar modelinin ana ayağıdır, yanında koşan bir araç değil.
// Seçmen partileri, ekonomiyi ve tehdidi doğrudan görmez; onları iletişim ekolojisi üzerinden görür:
// izlediği medya, konuştuğu insanlar, ait olduğu kurumlar ve kendi dolaysız deneyimi (Lippmann 1922,
// "kafamızdaki resimler"). Bu yüzden her kuram teriminin hem AĞIRLIĞI hem GİRDİSİ kişinin iletişim
// ortamından geçer: z'_k = g_k(kişi) · z_k(kişinin algıladığı dünya). Katsayılar (θ) yine veriden
// öğrenilir; mercek, aynı θ'nın kime ne kadar işlediğini kuramla belirler (MAP tahmini doğrusal kalır).
//
//   Gündem belirleme (McCombs & Shaw 1972) + konu sahipliği (Petrocik 1996) + açıklayıcı/isyancı kampanya
//     (Vavreck 2009): kişinin medyası hangi ekseni öne çıkarıyorsa o eksen ağırlaşır. İktidar yanlısı
//     medya ekonomi iyiyse ekonomiyi, kötüyse kültür/güvenliği; muhalif medya tersini işler.
//   Yönelim ihtiyacı (Weaver 1977): gündem etkisi ilgisi yüksek ama bağlılığı zayıf kişide en güçlü.
//   Dolaysız konular (Zucker 1978): iş kaybı, borç, terör, göç kişinin kendi deneyimiyse medya gerekmez.
//   Öncelikleme (Iyengar & Kinder 1987): öne çıkan eksen iktidarı değerlendirme ölçütü olur.
//   ELM (Petty & Cacioppo 1986): yüksek ilgi ve bilişsel ihtiyaç merkezi yol → çevresel ipuçlarına
//     (yanlı medya, araç, çoğunluk/bandwagon) direnç; düşük → bu ipuçlarına açıklık.
//   Seçici maruziyet ve pekiştirme (Klapper 1960; Stroud 2008; Levendusky 2013): kendi partisinin
//     medyasını izleyende parti kimliği güçlenir; çapraz baskı (Mutz 2002) onu zayıflatır.
//   İki aşamalı akış (Lazarsfeld vd. 1944; Katz 1957): medyayı az izleyen siyaseti çevresinden alır →
//     tartışma ağının ağırlığı artar; kanaat önderi ise kaynaktır, alıcı değil.
//   Kodlama/kodaçımlama (Hall 1973) + hegemonya (Gramsci): egemen koddaki medya mesajını marjinal ve
//     egemen ideolojiden uzak kişi karşıt okur → yanlı medyanın etkisi tersine döner (bumerang).
//   Ekme (Gerbner & Gross 1976): ağır televizyon izleyicisinde tehdit algısı ve otoriter tepki artar.
//   Suskunluk sarmalı (Noelle-Neumann 1974): yalıtılma korkusu yüksek, topluluğa gömülü kişi
//     çevresinin iklimine uyar → topluluk etkisi güçlenir; anket düzeltmesi communication.js'de.
// Kişi alanları (varsa kullanılır, yoksa vekil): siyasi_ilgi 0..1, medya, medya_kaynagi, tv_kanal_turu, tv_saat,
// sosyal_kaynak_turu, sosyal_saat,
// parti_kimligi, is_kaybi, borc_yuku, hane_algisi, teror_maruziyeti, sehit_yakini, zorunlu_goc, tehdit_algisi.
// Bağlam: mercek 0..1 (0 = kapalı, varsayılan 1), medya_yanliligi, ekonomi_algisi, egemen_ideoloji.

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const num = (v, d = 0) => (v !== null && v !== '' && Number.isFinite(+v) ? +v : d);
const has = (p, k) => p && p[k] !== undefined && p[k] !== null && p[k] !== '' && Number.isFinite(+p[k]);

// Hangi kuram terimi hangi iletişim mekanizmasından geçer
// ELM bir ikna kuramıdır: ayrıntılandırma olasılığı yüksek kişi çevresel ipuçlarına (medya yanlılığı, araç, çoğunluk)
// daha az kapılır. Mesele yakınlığını ilgiyle ölçeklemek ANES'te sınandı ve reddedildi (bkz. README: iletişim merceği).
const CEVRESEL = ['stratejik', 'arac'];

/** Kişinin siyasete ilgisi/dikkati 0..1 (kullanımlar-doyumlar). Ölçülmüşse o; yoksa bilişsel ihtiyaç ve kanaat önderliğinden. */
export function attention(f, p) {
  return has(p, 'siyasi_ilgi') ? clamp(+p.siyasi_ilgi, 0, 1) : clamp(0.25 + 0.4 * f.nfc + 0.25 * f.leader + 0.1 * f.egitim, 0, 1);
}

/**
 * Medya diyeti (Lasswell: kim, hangi kanalla, ne kadar): kişinin her kanalının yanlılığı, o kanala ayırdığı
 * saatin azalan getirili dozuyla tartılır. Kanal alanları: tv_kanal_turu + tv_saat, sosyal_kaynak_turu +
 * sosyal_saat; yoksa yalnız ana kaynak (medya_kaynagi) tam ağırlıkla. Döner {seçenek: maruziyet} ya da null.
 */
export function mediaDiet(p, ctx, alts) {
  const tab = ctx?.medya_yanliligi;
  if (!tab || !p) return null;
  const doz = (h) => (has(p, h) ? Math.log1p(clamp(+p[h], 0, 12)) / Math.log1p(4) : null);
  const kanal = [];
  if (p.tv_kanal_turu !== undefined || p.sosyal_kaynak_turu !== undefined) {
    if (tab[p.tv_kanal_turu]) kanal.push([tab[p.tv_kanal_turu], doz('tv_saat') ?? 1]);
    if (tab[p.sosyal_kaynak_turu]) kanal.push([tab[p.sosyal_kaynak_turu], doz('sosyal_saat') ?? 1]);
  } else if (tab[p.medya_kaynagi ?? p.medya]) kanal.push([tab[p.medya_kaynagi ?? p.medya], 1]);
  if (!kanal.length) return null;
  return Object.fromEntries(alts.map((a) => [a.id, kanal.reduce((s, [t, w]) => s + (t[a.id] === undefined ? 0 : clamp(num(t[a.id]), -1, 1) * w), 0)]));
}

/**
 * Kişinin iletişim ortamı → terim çarpanları (g) ve konu önemleri (s). Döner null: mercek kapalı
 * ya da alan siyaset değil. Ortalama kişide çarpanlar ≈ 1 (mercek öncülü ölçek değiştirmez, dağıtır).
 */
export function lensOf(resolved, f, p) {
  const ctx = resolved.ctx || {};
  const lam = ctx.mercek === undefined ? 1 : clamp(num(ctx.mercek, 1), 0, 1);
  if (!lam || resolved.domain.id !== 'siyaset') return null;
  const off = new Set(ctx.mercek_kapali || []);   // bileşen sınaması: gundem, elm, oncelik, pekistirme, hall, akis, sarmal
  const inc = resolved.alts.find((a) => a.iktidar);
  const A = attention(f, p);
  const medya = mediaDiet(p, ctx, resolved.alts);
  const sigma = medya && inc ? clamp(medya[inc.id], -1.5, 1.5) : 0;
  const e = num(ctx.ekonomi_algisi, -0.2);
  const pk = has(p, 'parti_kimligi') ? clamp(+p.parti_kimligi, -1, 1) : null;

  // --- Gündem: medya vurgusu (Petrocik + Vavreck) × yönelim ihtiyacı (Weaver) + dolaysız deneyim (Zucker)
  const nfo = A * (pk === null ? 0.7 : 1 - 0.6 * Math.abs(pk));
  const ekoVurgu = off.has('gundem') ? 0 : 0.8 * sigma * Math.tanh(3 * e) * nfo;                 // iktidar medyası + iyi ekonomi, muhalif + kötü ekonomi → ekonomi
  const zorluk = clamp(num(p?.is_kaybi) + 0.7 * num(p?.borc_yuku) + 0.5 * Math.max(0, -num(p?.hane_algisi)), 0, 1.5);
  const tehditDeneyim = clamp(num(p?.teror_maruziyeti) + num(p?.sehit_yakini), 0, 1.5);
  const kimlikDeneyim = clamp(num(p?.zorunlu_goc) + 0.6 * f.marginal, 0, 1.5);
  const tv = has(p, 'tv_saat') ? clamp(+p.tv_saat / 4, 0, 1.5) : p?.medya === 'tv' ? 1 : 0.3;
  const raw = {
    ekonomi: Math.exp(ekoVurgu + (off.has('dolaysiz') ? 0 : 0.5 * zorluk)),
    kultur: Math.exp(-ekoVurgu + (off.has('dolaysiz') ? 0 : 0.35 * tehditDeneyim) + (off.has('ekme') ? 0 : 0.25 * (tv - 0.5))),   // ekme: TV güvenlik/tehdit gündemini besler
    kimlik: Math.exp(off.has('dolaysiz') ? 0.09 : 0.6 * kimlikDeneyim),
  };
  const m2 = (raw.ekonomi + raw.kultur) / 2;
  const s = { ekonomi: raw.ekonomi / m2, kultur: raw.kultur / m2, kimlik: raw.kimlik / Math.exp(0.6 * 0.15) };

  // --- ELM: merkezi yol olasılığı
  const c = clamp(0.15 + 0.55 * A + 0.3 * f.nfc, 0, 1);
  const g = {};
  const elm = off.has('elm') ? 1 : 1.25 - 0.5 * c;   // çevresel yola açıklık (ortalama kişide ≈ 1)
  for (const k of CEVRESEL) g[k] = elm;
  if (off.has('oncelik')) return fin({ g, s: off.has('gundem_eksen') ? null : s, A, c, sigma, medya: off.has('diyet') ? null : medya }, lam);
  // Öncelikleme: öne çıkan eksen iktidar değerlendirmesinin ölçütü
  g.ekonomik_oy = s.ekonomi;
  g.otoriter_dinamik = s.kultur * (1 + 0.2 * (tv - 0.5) * (has(p, 'tehdit_algisi') ? 0.3 : 1));   // ölçülmüş algı ekmeyi zaten taşır
  g.kimlik_siyaseti = s.kimlik;
  g.kolektif_travma = s.kimlik;
  g.afet_cezasi = 0.7 + 0.6 * c;                                            // sorumluluk atfı (Iyengar 1991) bilgi ister

  // --- Pekiştirme / çapraz baskı: medya kişinin partisine mi karşı mı?
  if (pk !== null && medya && !off.has('pekistirme')) {
    let cong = 0;
    if (medya) for (const a of resolved.alts) if (a.kimlik) cong += medya[a.id] * (a.kimlik === 'sag' ? pk : a.kimlik === 'sol' ? -pk : 0);
    g.parti_kimligi = 1 + 0.35 * A * clamp(cong, -1, 1);
  }
  // --- Hall + hegemonya: egemen koddaki (iktidar yanlısı) medyayı karşıt okuma
  if (sigma && !off.has('hall')) {
    const H = num(ctx.egemen_ideoloji, 0.5), ideo = clamp(f.ideoloji, -1, 1);
    const opp = sigma > 0 ? clamp(0.6 * f.marginal + 0.4 * Math.abs(ideo - H) / 2, 0, 1) : clamp(0.5 * f.kurumsal_guven * (1 - f.marginal) + 0.3 * Math.max(0, ideo - 0.3), 0, 1);
    g.medya_yanliligi = (0.4 + 0.6 * A) * elm * (1 - 1.5 * opp) / 0.7;   // maruziyet × ikna edilebilirlik × okuma konumu
  }
  // --- İki aşamalı akış + suskunluk sarmalı
  if (!off.has('akis')) g.ag = 1 + 0.5 * (0.5 - A) - 0.25 * f.leader;
  if (!off.has('sarmal')) g.topluluk = 1 + 0.3 * (1 - f.nfc) * (0.4 * (1 - f.yerlesim) + 0.3 * f.yas + 0.3 * f.dindarlik) - 0.1;
  return fin({ g, s: off.has('gundem_eksen') ? null : s, A, c, sigma, medya: off.has('diyet') ? null : medya }, lam);
}

function fin(L, lam) {
  if (lam < 1) { for (const k in L.g) L.g[k] = 1 + lam * (L.g[k] - 1); if (L.s) for (const k in L.s) L.s[k] = 1 + lam * (L.s[k] - 1); }
  return L;
}

/**
 * Mercek terimleri: her mekanizmanın kişiler arası farkı ayrı, öğrenilebilir bir terimdir.
 * Fayda katkısı θ_k·z_k + θ'_k·(g_k − 1)·z_k; öncül θ'_k = θ_k (kuramın öngördüğü tam mercek).
 * Veri θ'_k'yı büyütür, küçültür ya da sıfırlar → model her iletişim mekanizmasının gücünü ölçer.
 */
export const MERCEK_MEKANIZMA = {
  ag: 'İki aşamalı akış (Lazarsfeld; Katz) — ilgisiz seçmen siyaseti çevresinden alır',
  topluluk: 'Suskunluk sarmalı / iklim (Noelle-Neumann) — yalıtılma korkusu, topluluğa uyum',
  parti_kimligi: 'Pekiştirme ve çapraz baskı (Klapper; Stroud; Mutz)',
  medya_yanliligi: 'Maruziyet × ELM ikna edilebilirliği × Hall okuma konumu',
  ekonomik_oy: 'Gündem belirleme + öncelikleme: ekonomi (McCombs & Shaw; Iyengar & Kinder; Zucker)',
  otoriter_dinamik: 'Gündem + öncelikleme: güvenlik/kültür; ekme (Gerbner)',
  kimlik_siyaseti: 'Dolaysız deneyim: kimlik gündemi (Zucker)',
  kolektif_travma: 'Dolaysız deneyim: kimlik gündemi (Zucker)',
  afet_cezasi: 'Sorumluluk atfı bilgi ister (Iyengar 1991)',
  stratejik: 'ELM çevresel yol: çoğunluk ipucu',
  arac: 'ELM çevresel yol: araç',
};

/** Merceğin kişi için okunabilir özeti (tek kişi tahmini): iletişim ortamı kararı nasıl çerçeveliyor. */
export function describeLens(L) {
  if (!L) return null;
  const r = (x) => Math.round(x * 100) / 100;
  const okuma = L.g.medya_yanliligi === undefined ? null : L.g.medya_yanliligi < 0 ? 'karşıt (Hall): yanlı medya ters teper' : L.g.medya_yanliligi < 0.6 ? 'müzakereci (Hall)' : 'egemen (Hall)';
  return {
    dikkat: r(L.A), ikna_yolu: L.c > 0.6 ? 'merkezi (ELM): ipuçlarına dirençli' : L.c < 0.35 ? 'çevresel (ELM): ipuçlarına açık' : 'karma (ELM)',
    gundem: { ekonomi: r(L.s.ekonomi), kultur_guvenlik: r(L.s.kultur), kimlik: r(L.s.kimlik) },
    iktidara_medya_egilimi: r(L.sigma), okuma_konumu: okuma,
    ag_agirligi: L.g.ag === undefined ? null : r(L.g.ag) + (L.g.ag > 1.1 ? ' (iki aşamalı akış: siyaseti çevresinden alıyor)' : ''),
    parti_kimligi: L.g.parti_kimligi === undefined ? null : L.g.parti_kimligi > 1.05 ? 'medya pekiştiriyor' : L.g.parti_kimligi < 0.95 ? 'çapraz baskı zayıflatıyor' : 'nötr',
  };
}

/** Kişiye özgü eksen ağırlıkları (gündem): yakınlık ve yönsel oy terimleri için. */
export const lensWeights = (p) => p?.__mercek?.s || null;
