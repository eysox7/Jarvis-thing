// Paylaşılabilir rapor (Markdown): senaryo, nüfus, hedef, plan, açıklama, sağlamlık, doğrulama.
// Rapor, sayıların bir modelin tahmini olduğunu ve nasıl elde edildiğini açıkça yazar.

import * as M from './model.js';
import { initialConfig, describeConfig } from './scenarios.js';

const pct = (v) => `%${Math.round(v * 100)}`;
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : '–');

const PART = {
  impact: 'Etkinlik (dönem ort.)', support: 'Destek', minSegment: 'En düşük segment', polarization: 'Kutuplaşma (−)',
  revenue: 'Gelir', adoption: 'Benimseme', satisfaction: 'Memnuniyet', churn: 'Bırakma (−)', overspend: 'Bütçe aşımı (−)',
};

function table(head, rows) {
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

// S: uygulama durumu, ctx: model bağlamı, robust: sağlamlık sonucu (isteğe bağlı)
export function buildReport(S, ctx, robust = null) {
  const scn = S.scenario;
  const metric = scn.domain === 'policy' ? 'Destek' : 'Benimseme';
  const init = M.forecast(ctx, initialConfig(scn));
  const az = S.az, st = S.bestStatic;
  const out = [];

  out.push(`# ${scn.title}`);
  out.push(`*Karar Laboratuvarı raporu · ${new Date().toLocaleString('tr-TR')} · ${scn.domain === 'policy' ? 'Kamu politikası' : 'Pazarlama'}*`);
  out.push(`> Bu rapordaki sayılar bir simülasyon modelinin tahminidir; gerçek kamuoyu/pazar araştırmasının yerini tutmaz. Varsayımlar aşağıda açıkça listelenmiştir.`);
  out.push(scn.summary || '');

  out.push('## Nüfus');
  const src = S.popSource === 'synthetic' ? '**sentetik örnek nüfus** (gerçek veri değil)' : 'MatrAIx personaları';
  out.push(`${S.personas.length} persona, kaynak: ${src}. Segmentler: \`${S.segDim}\` (${ctx.seg.labels.join(', ')}).`);
  const cal = Array.from(ctx.segBias).some((b) => b !== 0);
  out.push(cal ? 'Model, LLM/MatrAIx cevaplarıyla segment düzeyinde **kalibre edildi**.' : 'Model **kalibre edilmedi** (seçenek etkileri varsayımdır).');

  const cd = M.crowdDiagnostics(ctx, initialConfig(scn));
  out.push('## Kitle dinamiği (başlangıç tasarımı)');
  out.push(table(['Gösterge', 'Değer'], [
    ['Kitleleşme (çevreden gelen karar payı)', cd.herd.toFixed(2)],
    [`Yankı odası (ek benzeşme; ağ homofilisi ${cd.homophily.toFixed(2)})`, cd.echo.toFixed(2)],
    ['Kutuplaşma (iki kampa ayrılma)', cd.split.toFixed(2)],
  ]));

  out.push('## Hedef fonksiyonu');
  out.push(table(['Bileşen', 'Ağırlık'], Object.entries(scn.objective).map(([k, v]) => [PART[k] || k, v.toFixed(2)])));

  out.push('## Karşılaştırma');
  const rows = [['Başlangıç tasarımı', f3(init.total), pct(init.final), pct(Math.min(...init.segs))]];
  if (st) {
    const r = M.forecast(ctx, st.config);
    rows.push([st.approx ? 'İyi statik tasarım (yaklaşık)' : 'En iyi statik tasarım', f3(r.total), pct(r.final), pct(Math.min(...r.segs))]);
  }
  if (az?.moves) {
    const r = M.replay(ctx, az.moves, az.start);
    rows.push(['AlphaZero planı', f3(r.total), pct(r.final), pct(Math.min(...r.segs))]);
  }
  out.push(table(['Strateji', 'Hedef skoru', `${metric} (dönem sonu)`, 'En düşük segment'], rows));
  out.push(`### Başlangıç tasarımı\n${describeConfig(scn, initialConfig(scn))}`);

  if (az?.plan) {
    out.push('## Önerilen plan (AlphaZero)');
    out.push(az.plan.map((p) => `- **${p.phase === 'design' ? 'Tasarım' : `${p.t + 1}. ${scn.unit}`}:** ${p.label}`).join('\n'));
    out.push(`Sonuç: ${Object.entries(az.parts || {}).map(([k, v]) => `${PART[k] || k} ${v.toFixed(2)}`).join(' · ')}`);
    out.push('### Segmentlere göre');
    out.push(table(['Segment', 'Başlangıç', 'Plan', 'Fark'], ctx.seg.labels.map((l, k) => [l, pct(init.segs[k]), pct(az.segs[k]), `${az.segs[k] >= init.segs[k] ? '+' : ''}${Math.round((az.segs[k] - init.segs[k]) * 100)}`])));
    if (az.moves) {
      const ex = M.explainPlan(ctx, az.moves, az.start);
      out.push('### Neden bu plan?');
      out.push('Her adım plandan çıkarılıp sonuç yeniden hesaplandı. Katkı: adım olmasaydı skor ne kadar düşerdi.');
      out.push(table(['Ne zaman', 'Adım', 'Katkı', 'En çok yaradığı segment'],
        ex.rows.sort((a, b) => b.delta - a.delta).map((x) => {
          const k = x.segDelta.indexOf(Math.max(...x.segDelta));
          return [x.when, x.label, `${x.delta >= 0 ? '+' : ''}${x.delta.toFixed(3)}`, `${ctx.seg.labels[k]} (+${Math.round(x.segDelta[k] * 100)})`];
        })));
    }
    if (az.stale) out.push('> ⚠ Bu plan, model kalibre edilmeden önce bulundu.');
  }

  if (robust) {
    out.push('## Sağlamlık testi');
    out.push('Planlar, seçenek etkileri rastgele bozulmuş alternatif dünyalarda yeniden oynatıldı.');
    out.push(table(['Plan', 'Ortalama', 'Kötü durum (%10)', 'İyi durum (%90)', 'En iyi olduğu dünyalar'],
      Object.entries(robust).map(([n, v]) => [n, f3(v.mean), f3(v.p10), f3(v.p90), pct(v.winRate)])));
  }

  const llm = (S.llmRows || []);
  if (llm.length) {
    out.push('## Doğrulama: persona cevapları');
    out.push(`${llm.length} persona cevabı (LLM ya da MatrAIx). Örnekler:`);
    out.push(llm.slice(0, 8).map((x) => `- *${x.name}* (${ctx.seg.labels[x.seg]}), ${x.score}/5: ${x.reason}`).join('\n'));
  }

  out.push('## Varsayımlar ve sınırlar');
  out.push([
    '- Kişilerin seçeneklere tepkisi, persona boyutlarından türetilen eğilimler ve senaryoda yazılan etki ağırlıklarıyla hesaplanır; bunlar varsayımdır.',
    '- Zaman içindeki değişim (bilgilenme, çevre etkisi, alışkanlık) basitleştirilmiş bir modeldir.',
    '- Simüle edilmiş personalar (LLM/MatrAIx) gerçek insanlardan daha tutarlı ve uyumlu olma eğilimindedir.',
    '- Önemli kararlar gerçek kullanıcı/vatandaş araştırmasıyla doğrulanmalıdır.',
  ].join('\n'));

  out.push('## Seçenekler ve varsayılan etkiler');
  for (const l of scn.levers) {
    out.push(`**${l.label}**`);
    out.push(l.options.map((o) => `- ${o.label}: genel ${o.effect.base ?? 0}; ${Object.entries(o.effect.traits || {}).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ') || 'eğilim etkisi yok'}; amaca katkı ${o.impact ?? 1}`).join('\n'));
  }
  return out.filter(Boolean).join('\n\n') + '\n';
}
