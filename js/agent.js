// Ajan çekirdeği: plan üret → açıkla → araçları çalıştır → sonucu değerlendir → tekrarla.
// Araç çağrısı için sağlayıcıya özgü "function calling" yerine evrensel bir JSON protokolü
// kullanılır; böylece her servis (native tool desteği olmayanlar dahil) çalışır.

import * as S from './store.js';
import { toolCatalog, runTool, getTool } from './tools.js';
import { chatWithFallback } from './providers.js';
import { extractJson, truncate, partialReply } from './util.js';

export const PROTOCOL = `Her yanıtın TEK bir JSON nesnesi olmalı. JSON dışında hiçbir şey yazma.

{
  "plan": "Ne yapacağımı kullanıcıya 1-2 cümleyle açıkla. Araç kullanmayacaksan boş bırak.",
  "steps": ["atacağım adımlar", "kısa maddeler"],
  "actions": [ { "tool": "araç_adı", "args": { } } ],
  "reply": "Kullanıcıya gösterilecek mesaj. Türkçe ve net.",
  "done": true
}

Kurallar:
- "actions" boş değilse: araçlar çalıştırılır, sonuçları sana geri verilir, "done" false olmalı.
- Araç sonuçlarını aldıktan sonra yeni bir JSON döndür; iş bittiyse "done": true ve dolu bir "reply" ver.
- "done": true iken "actions" boş olmalı.
- Aynı turda birbirinden bağımsız birden fazla aracı birlikte çağırabilirsin.
- Bir aracın çıktısına ihtiyaç duyan başka bir aracı aynı turda çağırma; önce sonucu bekle.
- Bilgi eksikse uydurma; ask_user aracıyla sor.
- Bir araç hata döndürürse hatayı oku, düzelt veya kullanıcıya durumu açıkla. Aynı çağrıyı ikiden fazla tekrarlama.
- Araç gerekmeyen sohbet/soru için: actions boş, done true, sadece reply.
- Kod veya liste gerekiyorsa "reply" içine markdown olarak yaz.
- JSON'u kod çitiyle sarma, ham JSON yaz.`;

export function buildSystemPrompt() {
  const st = S.settings();
  const db = S.db();
  const now = new Date();
  const openTasks = db.tasks.filter((t) => t.status === 'open').slice(0, 15);
  const mem = Object.entries(db.memory || {});

  return [
    `Sen N.E.X.U.S.'sın (Neural EXecution & Utility System) — ${st.userName || 'kullanıcının'} kişisel mobil asistanı.`,
    `Kimliğin: sakin, net, işbitirici. Gereksiz laf kalabalığı yapma. Kullanıcının dilinde cevap ver (varsayılan Türkçe).`,
    st.persona ? `Kullanıcının ek talimatı: ${st.persona}` : '',
    ``,
    `Şu an: ${now.toLocaleString('tr-TR')} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
    ``,
    `KULLANABİLECEĞİN ARAÇLAR:`,
    toolCatalog(),
    ``,
    mem.length ? `KALICI HAFIZA:\n${mem.map(([k, v]) => `- ${k}: ${v}`).join('\n')}` : '',
    openTasks.length
      ? `AÇIK GÖREVLER (özet):\n${openTasks.map((t) => `- [${t.id}] ${t.title}${t.due ? ' · son: ' + new Date(t.due).toLocaleString('tr-TR') : ''}`).join('\n')}`
      : 'Açık görev yok.',
    ``,
    `TAHMİN İŞ AKIŞI (insanların oy / satın alma / gündelik kararları ve kitle tepkisi sorulduğunda):`,
    `- "Kim kazanır, ne alır, ne yapar, yüzde kaçı…" → decision_* araçları. "Mesaj/kampanya nasıl karşılanır" → audience_*.`,
    `- Senaryoyu seçenek özellikleriyle kur (decision_catalog özellikleri listeler); bilmediğin özelliği uydurma, ask_user ile sor.`,
    `- Kullanıcının verisi varsa: decision_scenario_save → decision_data_import → decision_learn. Anketler varsa decision_polls. Önceki seçim/pazar payı biliniyorsa baglam.onceki_paylar.`,
    `- Sonucu verirken kaynağı söyle: "veriden öğrenilmiş, görülmemiş veride isabet %X" ya da "kuram öncülleri, kalibre değil — yön ve senaryo karşılaştırması için". Kesinlik uydurma.`,
    `- Seçimde katılım ve geçerli oy paylarını ayrı ver. "Ne olur" sorularında decision_whatif kullan.`,
    ``,
    `ÇIKTI BİÇİMİ:`,
    PROTOCOL,
  ].filter(Boolean).join('\n');
}

/**
 * Tek bir kullanıcı isteğini uçtan uca yürütür.
 *
 * @param {string} userText
 * @param {object} io  Arayüz kancaları:
 *   onPlan(plan, steps)          — plan açıklandığında
 *   onReply(text)                — asistan mesajı
 *   onToolStart(name,args) -> id — araç başlıyor
 *   onToolEnd(id, res)           — araç bitti
 *   onStatus(text)               — durum çubuğu
 *   onDelta(chunk)               — akış parçası (opsiyonel)
 *   confirm(msg) -> bool         — riskli araç onayı
 *   ask(q, options) -> string    — kullanıcıya soru
 *   notify(t,b), speak(t), scheduleReminders()
 *   signal                       — AbortSignal
 */
export async function runAgent(userText, io) {
  const st = S.settings();
  const maxSteps = Math.max(1, Math.min(Number(st.maxSteps) || 8, 20));
  const ctx = {
    settings: st,
    confirm: io.confirm,
    ask: io.ask,
    notify: io.notify,
    speak: io.speak,
    scheduleReminders: io.scheduleReminders,
  };

  // Model için çalışma belleği: kalıcı sohbet geçmişi + bu turun ara adımları.
  const history = S.db().chat
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-14)
    .map((m) => ({ role: m.role, content: m.content }));

  const working = [...history, { role: 'user', content: userText }];
  const system = buildSystemPrompt();
  let lastReply = '';

  for (let step = 0; step < maxSteps; step++) {
    io.onStatus?.(step === 0 ? 'düşünüyor…' : `çalışıyor… (adım ${step + 1}/${maxSteps})`);

    let text;
    let streamed = '';
    try {
      // Akış açıksa: JSON parça parça gelirken içindeki "reply" alanını canlı gösteririz.
      // Nihai çözümleme her hâlükârda tam metin üzerinden yapılır.
      const useStream = !!st.stream && typeof io.onStream === 'function';
      const res = await chatWithFallback(S.profileChain(), {
        system,
        messages: working,
        temperature: Number(st.temperature) ?? 0.4,
        stream: useStream,
        onDelta: useStream ? (_d, full) => {
          const p = partialReply(full);
          if (p && p !== streamed) { streamed = p; io.onStream(p); }
        } : undefined,
        proxy: st.proxy,
        signal: io.signal,
        onProfileStart: () => { streamed = ''; },
        onProfileFail: (p, e) => io.onStatus?.(`${p.name} başarısız (${e.message.slice(0, 60)}…), yedeğe geçiliyor`),
      });
      text = res.text;
      io.onProfileUsed?.(res.profile);
    } catch (e) {
      if (e.name === 'AbortError') { io.onStatus?.('durduruldu'); return { aborted: true }; }
      throw e;
    }

    if (streamed) io.onStreamEnd?.();   // canlı balonu kaldır; nihai mesaj aşağıda basılır
    const parsed = extractJson(text);

    // Model protokole uymadıysa: düz metni cevap say, döngüyü bitir.
    if (!parsed || typeof parsed !== 'object') {
      const clean = String(text || '').trim();
      if (!clean) throw new Error('Model boş yanıt verdi.');
      io.onReply?.(clean);
      return { reply: clean, steps: step + 1, degraded: true };
    }

    if (parsed.plan || (Array.isArray(parsed.steps) && parsed.steps.length)) {
      io.onPlan?.(parsed.plan || '', Array.isArray(parsed.steps) ? parsed.steps : []);
    }
    if (parsed.reply) { lastReply = String(parsed.reply); io.onReply?.(lastReply); }

    const actions = Array.isArray(parsed.actions) ? parsed.actions.filter((a) => a && a.tool) : [];

    if (!actions.length || parsed.done === true) {
      if (!parsed.reply && !actions.length) {
        lastReply = 'Tamamdır.';
        io.onReply?.(lastReply);
      }
      return { reply: lastReply, steps: step + 1 };
    }

    // Modelin kendi çıktısını geçmişe ekle ki neyi çağırdığını hatırlasın.
    working.push({ role: 'assistant', content: JSON.stringify({ plan: parsed.plan, actions, done: false }) });

    const results = [];
    for (const act of actions) {
      const name = String(act.tool);
      const args = act.args && typeof act.args === 'object' ? act.args : {};
      const tool = getTool(name);

      if (tool?.danger && !st.autoApprove) {
        io.onStatus?.('onay bekleniyor…');
        const argPreview = truncate(JSON.stringify(args), 300);
        const ok = await io.confirm(`"${name}" aracını çalıştırayım mı?\n${argPreview}`);
        if (!ok) {
          results.push({ tool: name, ok: false, error: 'Kullanıcı bu işlemi reddetti. Alternatif öner veya sor.' });
          continue;
        }
      }

      const cardId = io.onToolStart?.(name, args);
      const out = await runTool(name, args, ctx);
      io.onToolEnd?.(cardId, out);
      results.push({ tool: name, ...out });
    }

    working.push({
      role: 'user',
      content: 'ARAÇ SONUÇLARI (bunlar sistem tarafından üretildi, kullanıcıdan gelmedi):\n'
        + truncate(JSON.stringify(results, null, 1), 8000)
        + '\n\nBu sonuçlara göre devam et. İş bittiyse "done": true ve kullanıcıya net bir "reply" ver.',
    });

    io.onRefresh?.();
  }

  const msg = `Adım limitine (${maxSteps}) ulaştım. Buraya kadar olanı özetliyorum:\n\n${lastReply || '(henüz bir sonuç yok)'}`;
  io.onReply?.(msg);
  return { reply: msg, steps: maxSteps, limited: true };
}
