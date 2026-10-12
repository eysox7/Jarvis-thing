// Anket birleştirme: tek anket gürültülüdür; birleşik tahmin örneklem büyüklüğü, tazelik ve
// kuruluş (house) yanlılığına göre ağırlıklandırılır (Silver 2008 / Jackman 2005 mantığının
// sade bir hâli). Çıktı calibrateShares'e hedef pay olarak verilir; bireysel farklılaşmayı
// kuram + veri modeli taşımaya devam eder.

const r1 = (x) => Math.round(x * 10) / 10;

/**
 * @param {Array<{kurulus, tarih, n, paylar: {id: yüzde}}>} polls
 * @param {object} o {bugun, yariOmurGun=14, kurulusYanliligi=true}
 */
export function aggregatePolls(polls, o = {}) {
  if (!Array.isArray(polls) || !polls.length) throw new Error('en az bir anket gerekli');
  const today = o.bugun ? Date.parse(o.bugun) : Math.max(...polls.map((p) => Date.parse(p.tarih) || 0)) || Date.now();
  const half = o.yariOmurGun ?? 14;
  const ids = [...new Set(polls.flatMap((p) => Object.keys(p.paylar || {})))];
  const norm = (sh) => { const t = ids.reduce((s, k) => s + (Number(sh[k]) || 0), 0) || 1; return Object.fromEntries(ids.map((k) => [k, (Number(sh[k]) || 0) / t])); };
  const P = polls.map((p) => {
    const age = Math.max(0, (today - (Date.parse(p.tarih) || today)) / 86400000);
    const n = Math.max(50, Number(p.n) || 800);
    return { ...p, sh: norm(p.paylar || {}), age, w: Math.sqrt(n) * Math.pow(0.5, age / half) };
  });
  const avg = (list) => { const W = list.reduce((s, p) => s + p.w, 0); return Object.fromEntries(ids.map((k) => [k, list.reduce((s, p) => s + p.w * p.sh[k], 0) / W])); };
  let est = avg(P);
  // Kuruluş yanlılığı: her kuruluşun birleşik tahminden ortalama sapması çıkarılır (≥2 kuruluş varsa)
  const houses = [...new Set(P.map((p) => p.kurulus || '?'))];
  const effects = {};
  if (o.kurulusYanliligi !== false && houses.length >= 2) {
    for (let it = 0; it < 5; it++) {
      for (const h of houses) {
        const hp = P.filter((p) => (p.kurulus || '?') === h);
        effects[h] = Object.fromEntries(ids.map((k) => [k, hp.reduce((s, p) => s + p.w * (p.sh[k] - est[k]), 0) / hp.reduce((s, p) => s + p.w, 0)]));
      }
      // Kimlik kısıtı: yanlılıkların AĞIRLIKLI ortalaması sıfır (eski/tek anketli kuruluş ölçeği kaydırmasın)
      const hw = Object.fromEntries(houses.map((h) => [h, P.filter((p) => (p.kurulus || '?') === h).reduce((s, p) => s + p.w, 0)]));
      const HW = houses.reduce((s, h) => s + hw[h], 0);
      for (const k of ids) { const m = houses.reduce((s, h) => s + hw[h] * effects[h][k], 0) / HW; for (const h of houses) effects[h][k] -= m; }
      const adj = P.map((p) => ({ ...p, sh: Object.fromEntries(ids.map((k) => [k, Math.max(0, p.sh[k] - effects[p.kurulus || '?'][k])])) }));
      est = avg(adj);
    }
  }
  // Belirsizlik: etkin örneklem + anketler arası dağılım
  const Wt = P.reduce((s, p) => s + p.w, 0), Wt2 = P.reduce((s, p) => s + p.w * p.w, 0);
  const nEff = P.reduce((s, p) => s + Math.max(50, Number(p.n) || 800) * Math.pow(0.5, p.age / half), 0);
  const moe = Object.fromEntries(ids.map((k) => {
    const sampling = Math.sqrt(est[k] * (1 - est[k]) / Math.max(50, nEff));
    const between = P.length > 1 ? Math.sqrt(P.reduce((s, p) => s + p.w * (p.sh[k] - est[k]) ** 2, 0) / Wt / Math.max(1, Wt * Wt / Wt2 - 1)) : 0;
    return [k, r1(196 * Math.sqrt(sampling ** 2 + between ** 2))];
  }));
  return {
    paylar: Object.fromEntries(ids.map((k) => [k, r1(est[k] * 100)])),
    hata_payi_95: moe,
    anket_sayisi: P.length, etkin_orneklem: Math.round(nEff),
    kurulus_yanliligi_puan: Object.keys(effects).length ? Object.fromEntries(houses.map((h) => [h, Object.fromEntries(ids.map((k) => [k, r1(effects[h][k] * 100)]))])) : undefined,
    agirliklar: P.map((p) => ({ kurulus: p.kurulus, tarih: p.tarih, agirlik: Math.round((p.w / Wt) * 1000) / 10 })),
  };
}
