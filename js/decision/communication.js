// İletişim kuramlarının karar modeline entegrasyonu.
// Her seçeneğin kamusal iletişimi (parti mesajı, marka reklamı, kurum önerisi) kitle motorunda
// 20 iletişim kuramıyla, KARARI VERECEK AYNI PERSONALAR üzerinde koşturulur. Kişi × seçenek
// çıktıları karar faydasına terim olarak girer ve ağırlıkları diğer kuram terimleri gibi veriden
// öğrenilir:
//   m  maruziyet × dikkat   — Lasswell, gündem belirleme, kullanımlar-doyumlar, propaganda modeli,
//                             ekonomi politik/dijital uçurum, kültür endüstrisi, iki aşamalı akış
//   t  tutum etkisi          — kaynak güvenilirliği, seçici maruziyet, çerçeveleme, ELM, ekme,
//                             tepkisellik, hegemonya, feminist eleştiri (+ maruziyetle ağırlıklı)
//   o  Hall okuma konumu     — egemen − karşıt okuma olasılığı (maruziyetle ağırlıklı)
//   s  ifade eğilimi          — suskunluk sarmalı: tercihini açıkça söyleme/paylaşma olasılığı
// Seçenek `iletisim` alanı verirse o mesaj kullanılır; yoksa seçenek özelliklerinden türetilir.

import { predict as audiencePredict } from '../audience/engine.js';

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const isPassive = (a) => a.tur === 'cekimser' || a.tur === 'disarida' || a.id === 'oy_kullanmama' || a.id === 'satin_almama';

/** Seçeneğin kamusal mesajını kitle motoru girdisine çevirir (null = iletişimi yok). */
export function commMessage(resolved, a) {
  if (a.iletisim === false || isPassive(a)) return null;
  if (a.iletisim && typeof a.iletisim === 'object') return { domain: resolved.domain.id === 'gundelik' ? 'genel' : resolved.domain.id, ...a.iletisim };
  const ctx = resolved.ctx || {};
  if (resolved.domain.id === 'siyaset') {
    const ideoOf = (x) => Math.max(-1, Math.min(1, 0.6 * num(x.ekonomi) + 0.4 * num(x.kultur)));
    const ideo = ideoOf(a);
    // Egemen blok (Gramsci; Hall'un "egemen kod"u): bağlam vermezse iktidardaki partinin ideolojisi —
    // egemen okuma ülkeye ve döneme göre değişir, sabit bir "sağ" ya da "sol" değildir.
    const inc = resolved.alts.find((x) => x.iktidar);
    const H = ctx.egemen_ideoloji !== undefined ? num(ctx.egemen_ideoloji) : inc ? ideoOf(inc) : 0.5;
    return {
      domain: 'siyaset', egemen_ideoloji: H,
      institution: { tur: a.iktidar ? 'parti_iktidar' : 'parti_muhalefet', ideoloji: ideo, hegemonik: a.iktidar ? 0.9 : 0.35, guvenilirlik: 0.3 + 0.35 * num(a.lider, 0.5) },
      channels: a.iktidar ? ['tv', 'sosyal'] : ['sosyal', 'yuz_yuze'],
      hegemonic: a.iktidar ? 0.8 : -0.4,
      slant: ideo,
      frame: a.iktidar ? 'sorumluluk' : num(ctx.ekonomi_algisi, -0.2) < 0 ? 'ekonomik' : 'catisma',
      repetition: 1 + 6 * num(a.anket, 0.2),
      controversy: 0.8,
    };
  }
  if (resolved.domain.id === 'ticaret') {
    const strong = num(a.marka, 0.5) > 0.7;
    return {
      domain: 'ticaret',
      institution: { tur: strong ? 'holding_marka' : 'kobi', guvenilirlik: 0.3 + 0.5 * num(a.puan, 0.5), ideoloji: a.yerli ? 0.3 : 0 },
      channels: a.online ? ['sosyal', 'influencer'] : strong ? ['tv', 'sosyal'] : ['sosyal'],
      frame: num(a.indirim_yuzde) > 0 || a.referans_fiyat ? 'kazanc' : 'notr',
      commercial: 1, repetition: 1 + 8 * num(a.marka, 0.5), quality: num(a.kalite, 0.5), cues: num(a.marka, 0.5),
      hegemonic: strong ? 0.3 : 0,
    };
  }
  // Gündelik: kurum önerisi yoksa iletişim ortamı kişiler arasıdır — sosyal çevrenin ağızdan ağıza
  // anlatımı (Katz & Lazarsfeld kişisel etki, iki aşamalı akış); gücü betimleyici normla orantılı.
  if (!a.kurum_onerisi) {
    return {
      domain: ctx.konu || 'genel',
      institution: { tur: 'stk', ad: 'Sosyal çevre', guvenilirlik: 0.6, hegemonik: 0.3, ideoloji: 0, ticari: 0 },
      channels: ['yuz_yuze', 'sosyal'], frame: 'insan_hikayesi',
      repetition: 1 + 5 * num(a.norm, 0.3), quality: num(a.fayda, 0.5), hegemonic: a.varsayilan ? 0.4 : 0,
    };
  }
  return {
    domain: ctx.konu && ['saglik', 'cevre', 'finans', 'egitim', 'kamu_hizmeti', 'kriz'].includes(ctx.konu) ? ctx.konu : 'genel',
    institution: a.kurum_onerisi ? (ctx.oneren_kurum || 'kamu_bakanlik') : 'stk',
    channels: a.kurum_onerisi ? ['tv', 'sms'] : ['sosyal'],
    frame: a.kayip_cercevesi ? 'kayip' : 'sorumluluk',
    quality: num(a.fayda, 0.5), hegemonic: a.kurum_onerisi ? 0.8 : 0,
  };
}

function signature(resolved) {
  return JSON.stringify(resolved.alts.map((a) => [a.id, commMessage(resolved, a)]));
}

/**
 * Personalara kişi × seçenek iletişim özelliklerini ekler (görünmez __ileti alanı; seçenek
 * tanımı değişirse yeniden hesaplanır). Personalar tek bir kitle olarak birlikte koşturulur:
 * iki aşamalı akış ve suskunluk sarmalı bu kitlenin kendi iklimine göre işler.
 */
export function ensureComm(resolved, personas) {
  const sig = signature(resolved);
  const todo = personas.filter((p) => p && p.__ileti?.sig !== sig);
  if (!todo.length) return;
  const vals = todo.map(() => ({}));
  for (const a of resolved.alts) {
    const msg = commMessage(resolved, a);
    if (!msg) continue;
    let r;
    try { r = audiencePredict(msg, { population: todo, bootstrap: 0, keepPeople: true }); } catch { continue; }
    r._people.forEach(({ out }, i) => {
      const m = out.exposed * out.attend;
      vals[i][a.id] = { m, t: m * out.attitude, o: m * (out.dec.egemen - out.dec.karsit), s: out.share };
    });
  }
  todo.forEach((p, i) => Object.defineProperty(p, '__ileti', { value: { sig, v: vals[i] }, enumerable: false, configurable: true, writable: true }));
}

/** Persona'nın seçenek a için iletişim özelliği (yoksa 0). */
export const comm = (p, a, k) => p?.__ileti?.v?.[a.id]?.[k] || 0;

/** Suskunluk sarmalı: seçeneklerin ortalama ifade (açıkça söyleme) eğilimi — anket düzeltmesi için. */
export function expressionRates(resolved, personas) {
  ensureComm(resolved, personas);
  return Object.fromEntries(resolved.alts.map((a) => {
    const vs = personas.map((p) => p.__ileti?.v?.[a.id]?.s).filter((v) => v !== undefined);
    return [a.id, vs.length ? vs.reduce((x, y) => x + y, 0) / vs.length : null];
  }));
}
