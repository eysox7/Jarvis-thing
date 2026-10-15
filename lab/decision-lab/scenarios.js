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
