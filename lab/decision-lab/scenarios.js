// Senaryo şablonları.
//
// Bir senaryo; karar vericinin elindeki kolları (lever) ve her kolun seçeneklerini, zaman içinde
// yapılabilecek tek seferlik eylemleri (event) ve hedef fonksiyonunu tanımlar.
//
// Seçenek etkisi: effect = { base, traits: { eğilim: ağırlık } }
//   Kişinin bu seçeneğe tepkisi = base + Σ ağırlık × kişinin eğilimi   (eğilimler population.js'te)
// impact:  seçeneğin karar vericinin asıl amacına katkısı (politikada etkinlik, pazarlamada gelir/kullanıcı) [0,1]
// cost:    adım başına bütçe harcaması (bütçe birimi)
//
// Arayüzden düzenlenebilir; JSON olarak dışa/içe aktarılabilir.

export const TEMPLATES = [
  {
    id: 'congestion-charge',
    domain: 'policy',
    title: 'Şehir merkezine araç giriş ücreti',
    summary: 'Trafik ve hava kirliliğini azaltmak için şehir merkezine giren özel araçlardan ücret alınması.',
    question: 'Bu düzenlemeyi destekler misiniz?',
    unit: 'ay', horizon: 12, budget: 30,
    levers: [
      {
        id: 'fee', label: 'Günlük ücret', initial: 'mid',
        options: [
          { id: 'low', label: '25 TL', impact: 0.35, cost: 0, effect: { base: 0.1, traits: { price: -0.6, environment: 0.4, time: 0.2 } } },
          { id: 'mid', label: '60 TL', impact: 0.65, cost: 0, effect: { base: -0.2, traits: { price: -1.2, environment: 0.7, time: 0.3 } } },
          { id: 'high', label: '120 TL', impact: 0.9, cost: 0, effect: { base: -0.6, traits: { price: -1.8, environment: 0.9, time: 0.3 } } },
        ],
      },
      {
        id: 'revenue', label: 'Gelirin kullanımı', initial: 'general',
        options: [
          { id: 'general', label: 'Belediye genel bütçesine', impact: 0.5, cost: 0, effect: { base: -0.3, traits: { trust: 0.9, fairness: -0.3 } } },
          { id: 'transit', label: 'Toplu taşımaya (sefer artışı, indirim)', impact: 0.8, cost: 0, effect: { base: 0.3, traits: { price: 0.3, environment: 0.5, fairness: 0.3 } } },
          { id: 'dividend', label: 'Tüm sakinlere eşit geri ödeme', impact: 0.6, cost: 0, effect: { base: 0.2, traits: { price: 0.6, fairness: 0.6, trust: -0.2 } } },
        ],
      },
      {
        id: 'exempt', label: 'Muafiyet', initial: 'none',
        options: [
          { id: 'none', label: 'Muafiyet yok', impact: 1.0, cost: 0, effect: { base: -0.1, traits: { fairness: -0.4 } } },
          { id: 'needs', label: 'Düşük gelirli ve engelli sürücüler', impact: 0.9, cost: 1, effect: { base: 0.2, traits: { fairness: 0.7, price: 0.3 } } },
          { id: 'locals', label: 'Bölgede oturanlar ve esnaf', impact: 0.7, cost: 1, effect: { base: 0.1, traits: { habit: 0.4, fairness: -0.2 } } },
        ],
      },
      {
        id: 'rollout', label: 'Uygulama biçimi', initial: 'now',
        options: [
          { id: 'now', label: 'Hemen tüm merkezde', impact: 1.0, cost: 0, effect: { base: -0.2, traits: { habit: -0.8, novelty: 0.3 } } },
          { id: 'phased', label: '3 ay pilot, sonra genişleme', impact: 0.8, cost: 0.5, effect: { base: 0.15, traits: { habit: -0.2, trust: 0.2 } } },
        ],
      },
    ],
    events: [
      { id: 'inform', label: 'Bilgilendirme kampanyası (gerçek veri: trafik, hava kalitesi)', kind: 'information', strength: 0.3, cost: 3 },
      { id: 'consult', label: 'Halk istişaresi ve mahalle toplantıları', kind: 'consultation', strength: 0.35, cost: 4 },
      { id: 'pilot-report', label: 'Pilot sonuç raporunu yayımla', kind: 'evidence', strength: 0.25, cost: 1 },
    ],
    objective: { impact: 0.4, support: 0.35, minSegment: 0.25, polarization: 0.3 },
  },
  {
    id: 'fitness-app',
    domain: 'marketing',
    title: 'Abonelikli sağlık/fitness uygulaması lansmanı',
    summary: 'Kişisel antrenman ve beslenme önerileri sunan yeni bir mobil uygulamanın pazara sunulması.',
    question: 'Bu uygulamayı kullanmaya başlar mıydınız?',
    unit: 'ay', horizon: 12, budget: 40,
    levers: [
      {
        id: 'price', label: 'Fiyat', initial: 'p99',
        options: [
          { id: 'freemium', label: 'Ücretsiz + reklamlı, premium 79 TL', impact: 0.45, cost: 0, effect: { base: 0.6, traits: { price: 0.5, privacy: -0.4 } } },
          { id: 'p49', label: '49 TL/ay', impact: 0.6, cost: 0, effect: { base: 0.2, traits: { price: -0.4 } } },
          { id: 'p99', label: '99 TL/ay', impact: 0.85, cost: 0, effect: { base: -0.2, traits: { price: -1.0, novelty: 0.2 } } },
          { id: 'p149', label: '149 TL/ay (koç desteği dahil)', impact: 1.0, cost: 0, effect: { base: -0.6, traits: { price: -1.5, novelty: 0.3, time: 0.3 } } },
        ],
      },
      {
        id: 'data', label: 'Veri yaklaşımı', initial: 'cloud',
        options: [
          { id: 'cloud', label: 'Bulutta kişiselleştirme (verilerle eğitim)', impact: 1.0, cost: 0, effect: { base: 0.2, traits: { privacy: -0.9, novelty: 0.4 } } },
          { id: 'device', label: 'Yalnızca cihazda, veri paylaşılmaz', impact: 0.85, cost: 0.5, effect: { base: 0.0, traits: { privacy: 0.6, trust: 0.2 } } },
        ],
      },
      {
        id: 'focus', label: 'Ürün odağı', initial: 'performance',
        options: [
          { id: 'performance', label: 'Performans ve hedefler', impact: 0.9, cost: 0, effect: { base: 0.0, traits: { novelty: 0.4, time: -0.3 } } },
          { id: 'busy', label: 'Yoğun insanlar için 15 dakikalık programlar', impact: 0.9, cost: 0, effect: { base: 0.1, traits: { time: 0.7 } } },
          { id: 'community', label: 'Arkadaşlarla birlikte, topluluk', impact: 0.9, cost: 0.5, effect: { base: 0.0, traits: { social: 0.8, novelty: 0.2 } } },
        ],
      },
    ],
    events: [
      { id: 'ads', label: 'Tanıtım kampanyası (bilinirlik)', kind: 'awareness', strength: 0.25, cost: 4 },
      { id: 'trial', label: '1 ay ücretsiz deneme', kind: 'trial', strength: 0.6, cost: 3 },
      { id: 'reviews', label: 'Bağımsız inceleme / test sonuçlarını yayımla', kind: 'evidence', strength: 0.25, cost: 1 },
    ],
    objective: { revenue: 0.45, adoption: 0.3, satisfaction: 0.25, churn: 0.3 },
  },
  {
    id: 'pension-age',
    domain: 'policy',
    title: 'Emeklilik yaşı reformu',
    summary: 'Sosyal güvenlik sisteminin finansman açığını kapatmak için emeklilik yaşının yükseltilmesi ve geçiş düzenlemeleri.',
    question: 'Bu reformu destekler misiniz?',
    unit: 'ay', horizon: 12, budget: 30,
    levers: [
      {
        id: 'age', label: 'Yeni emeklilik yaşı', initial: 'a67',
        options: [
          { id: 'a65', label: '65', impact: 0.55, cost: 0, effect: { base: -0.1, traits: { security: -0.3, habit: -0.3 } } },
          { id: 'a67', label: '67', impact: 0.85, cost: 0, effect: { base: -0.5, traits: { security: -0.7, habit: -0.6, fairness: -0.2 } } },
          { id: 'a67life', label: '67, sonra yaşam süresine bağlı', impact: 1.0, cost: 0, effect: { base: -0.7, traits: { security: -0.9, habit: -0.6, trust: 0.4, novelty: 0.2 } } },
        ],
      },
      {
        id: 'transition', label: 'Geçiş', initial: 'now',
        options: [
          { id: 'now', label: 'Yürürlüğe girdiği yıl herkes için', impact: 1.0, cost: 0, effect: { base: -0.4, traits: { habit: -0.7, security: -0.4 } } },
          { id: 'gradual', label: '15 yılda kademeli (yaşa yakın olanlar etkilenmez)', impact: 0.75, cost: 0, effect: { base: 0.2, traits: { fairness: 0.4, habit: 0.4, security: 0.3 } } },
        ],
      },
      {
        id: 'protect', label: 'Koruma düzenlemesi', initial: 'none',
        options: [
          { id: 'none', label: 'Yok', impact: 1.0, cost: 0, effect: { base: 0, traits: { fairness: -0.5 } } },
          { id: 'hard', label: 'Ağır ve yıpratıcı işlerde erken emeklilik korunur', impact: 0.9, cost: 1, effect: { base: 0.15, traits: { fairness: 0.7, security: 0.3 } } },
          { id: 'minimum', label: 'En düşük emekli aylığı yükseltilir', impact: 0.8, cost: 2, effect: { base: 0.2, traits: { fairness: 0.5, price: 0.6, security: 0.4 } } },
        ],
      },
      {
        id: 'option', label: 'Esneklik', initial: 'fixed',
        options: [
          { id: 'fixed', label: 'Sabit yaş', impact: 1.0, cost: 0, effect: { base: 0, traits: {} } },
          { id: 'flex', label: 'Kesintili erken ya da primli geç emeklilik seçeneği', impact: 0.9, cost: 0.5, effect: { base: 0.15, traits: { novelty: 0.3, time: 0.3, trust: 0.2 } } },
        ],
      },
    ],
    events: [
      { id: 'inform', label: 'Sistemin finansman durumunu açıklayan bilgilendirme', kind: 'information', strength: 0.3, cost: 3 },
      { id: 'consult', label: 'Sendikalar ve emekli dernekleriyle müzakere', kind: 'consultation', strength: 0.4, cost: 4 },
      { id: 'report', label: 'Bağımsız aktüerya raporunu yayımla', kind: 'evidence', strength: 0.3, cost: 1 },
    ],
    objective: { impact: 0.4, support: 0.35, minSegment: 0.25, polarization: 0.3 },
  },
  {
    id: 'flood-warning',
    domain: 'policy',
    title: 'Kriz iletişimi: sel uyarısı ve tahliye',
    summary: 'Önümüzdeki saatlerde dere taşkını beklenen mahallelerde halkın zamanında ve paniğe kapılmadan bölgeyi terk etmesi için uyarı ve tahliye iletişimi. Herkese aynı doğru bilgi verilir; tasarlanan şey mesajın içeriği, kaynağı, kanalı ve sağlanan destektir.',
    question: 'Bu uyarıya uyup bölgeyi zamanında terk eder misiniz?',
    unit: 'saat', horizon: 12, budget: 25,
    levers: [
      {
        id: 'message', label: 'Mesajın içeriği', initial: 'generic',
        options: [
          { id: 'generic', label: 'Genel uyarı: "Sel riski var, dikkatli olun"', impact: 0.5, cost: 0, effect: { base: -0.3, traits: { trust: 0.5, habit: -0.4 } } },
          { id: 'specific', label: 'Mahalleye özel risk + tahliye rotası + toplanma noktası', impact: 0.9, cost: 0, effect: { base: 0.3, traits: { time: 0.3, security: 0.4 } } },
          { id: 'concrete', label: 'Somut etki: "Sokağınızda su 1,5 metreye çıkabilir" + rota', impact: 1.0, cost: 0, effect: { base: 0.25, traits: { security: 0.6, habit: -0.2, trust: 0.2 } } },
        ],
      },
      {
        id: 'source', label: 'Kaynak', initial: 'gov',
        options: [
          { id: 'gov', label: 'Valilik / AFAD resmi açıklaması', impact: 1.0, cost: 0, effect: { base: 0, traits: { trust: 0.8 } } },
          { id: 'local', label: 'Muhtar ve yerel gönüllüler', impact: 0.8, cost: 0.5, effect: { base: 0.1, traits: { social: 0.5, trust: -0.4 } } },
          { id: 'both', label: 'Resmi açıklama + yerel kanaldan aynı mesaj', impact: 1.0, cost: 1, effect: { base: 0.2, traits: { trust: 0.4, social: 0.3 } } },
        ],
      },
      {
        id: 'channel', label: 'Kanal', initial: 'tv',
        options: [
          { id: 'tv', label: 'TV ve radyo', impact: 0.6, cost: 0, effect: { base: 0, traits: { habit: 0.4, novelty: -0.2 } } },
          { id: 'cell', label: 'Tüm telefonlara hücre yayını (cell broadcast)', impact: 0.9, cost: 0.5, effect: { base: 0.2, traits: { novelty: 0.2, time: 0.2 } } },
          { id: 'multi', label: 'Hücre yayını + TV/radyo + mahalle anonsu', impact: 1.0, cost: 1.5, effect: { base: 0.3, traits: { habit: 0.2 } } },
        ],
      },
      {
        id: 'support', label: 'Tahliye desteği', initial: 'none',
        options: [
          { id: 'none', label: 'Ek destek yok', impact: 0.6, cost: 0, effect: { base: -0.3, traits: { price: -0.6, security: -0.2 } } },
          { id: 'transport', label: 'Ücretsiz ulaşım ve geçici barınma', impact: 1.0, cost: 2, effect: { base: 0.3, traits: { price: 0.6, time: 0.2, security: 0.2 } } },
        ],
      },
    ],
    events: [
      { id: 'live', label: 'Canlı su seviyesi haritası ve tahmin güncellemesi', kind: 'information', strength: 0.3, cost: 2 },
      { id: 'expert', label: 'Bağımsız hidroloji uzmanının açıklaması', kind: 'evidence', strength: 0.3, cost: 1 },
      { id: 'door', label: 'Kapı kapı bilgilendirme ve yardım ihtiyacı tespiti', kind: 'consultation', strength: 0.35, cost: 3 },
    ],
    objective: { impact: 0.35, support: 0.4, minSegment: 0.35, polarization: 0.2 },
  },
  {
    id: 'ev-launch',
    domain: 'marketing',
    title: 'Elektrikli otomobil lansmanı',
    summary: 'Orta segmentte yeni bir elektrikli otomobilin pazara sunulması.',
    question: 'Bir sonraki aracınız olarak bu otomobili ciddi şekilde düşünür müydünüz?',
    unit: 'ay', horizon: 12, budget: 40,
    levers: [
      {
        id: 'price', label: 'Fiyat', initial: 'list',
        options: [
          { id: 'list', label: '1.6 milyon TL', impact: 1.0, cost: 0, effect: { base: -0.3, traits: { price: -1.2 } } },
          { id: 'promo', label: '1.4 milyon TL (lansman fiyatı)', impact: 0.75, cost: 0, effect: { base: 0.1, traits: { price: -0.6 } } },
          { id: 'lease', label: 'Aylık kiralama, bakım dahil', impact: 0.8, cost: 0.5, effect: { base: 0.0, traits: { price: -0.3, time: 0.5, habit: -0.2, novelty: 0.2 } } },
        ],
      },
      {
        id: 'warranty', label: 'Batarya garantisi', initial: 'std',
        options: [
          { id: 'std', label: '5 yıl', impact: 1.0, cost: 0, effect: { base: 0, traits: { security: -0.3 } } },
          { id: 'long', label: '10 yıl, değer kaybı güvencesi', impact: 0.85, cost: 1, effect: { base: 0.2, traits: { security: 0.6, habit: 0.3, trust: 0.2 } } },
        ],
      },
      {
        id: 'charging', label: 'Şarj', initial: 'paid',
        options: [
          { id: 'paid', label: 'Ortak şarj ağı, standart ücret', impact: 1.0, cost: 0, effect: { base: -0.2, traits: { time: -0.4, habit: -0.3 } } },
          { id: 'home', label: 'Ev şarj ünitesi ve kurulum hediye', impact: 0.9, cost: 1, effect: { base: 0.2, traits: { time: 0.4, habit: 0.2 } } },
          { id: 'free', label: '1 yıl ücretsiz hızlı şarj', impact: 0.85, cost: 1.5, effect: { base: 0.2, traits: { price: 0.5, time: 0.2 } } },
        ],
      },
    ],
    events: [
      { id: 'ads', label: 'Lansman kampanyası', kind: 'awareness', strength: 0.25, cost: 5 },
      { id: 'drive', label: 'Hafta sonu test sürüşü etkinlikleri', kind: 'trial', strength: 0.5, cost: 3 },
      { id: 'test', label: 'Bağımsız menzil ve güvenlik testlerini yayımla', kind: 'evidence', strength: 0.3, cost: 1 },
    ],
    objective: { revenue: 0.45, adoption: 0.3, satisfaction: 0.25, churn: 0.3 },
  },
];

export function cloneScenario(s) { return JSON.parse(JSON.stringify(s)); }

// Bir kol seçimi (lever → option) kümesini insan diline çevirir (LLM ve MatrAIx için).
export function describeConfig(scn, config) {
  return scn.levers.map((l) => `- ${l.label}: ${l.options.find((o) => o.id === config[l.id])?.label ?? '?'}`).join('\n');
}

export function initialConfig(scn) {
  return Object.fromEntries(scn.levers.map((l) => [l.id, l.initial ?? l.options[0].id]));
}

// Senaryo doğrulama: arayüzde düzenlenen JSON'u kullanmadan önce.
export function validateScenario(s) {
  const errs = [];
  if (!['policy', 'marketing'].includes(s.domain)) errs.push('domain "policy" ya da "marketing" olmalı');
  if (!Array.isArray(s.levers) || !s.levers.length) errs.push('en az bir kol (lever) gerekli');
  for (const l of s.levers || []) {
    if (!l.id || !Array.isArray(l.options) || l.options.length < 2) errs.push(`kol "${l.id}": en az iki seçenek gerekli`);
    for (const o of l.options || []) if (!o.effect) errs.push(`seçenek "${l.id}/${o.id}": effect eksik`);
  }
  if (!(s.horizon >= 2 && s.horizon <= 36)) errs.push('horizon 2-36 arası olmalı');
  return errs;
}
