// Uçtan uca: sahte Telegram → bot → sahte Claude → sahte Telegram.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tzParts } from '../src/reminders.mjs';
import { mockServer, setup, userMsg, USER, waitFor, waitSent } from './helpers.mjs';

const pad = (n) => String(n).padStart(2, '0');
const localIn = (ms, tz = 'Europe/Istanbul') => {
  const p = tzParts(Date.now() + ms, tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
};

const lastUserBlocks = (req) => req.body.messages.at(-1).content;

test('izinsiz kullanıcı Claude\'a ulaşamaz, kurulum için kimliğini öğrenir', async () => {
  const h = await setup({ ALLOWED_USERS: '' });
  try {
    h.tg.push(userMsg('selam', { from: { id: 7, is_bot: false, first_name: 'X' }, chat: { id: 7, type: 'private' } }));
    const sent = await waitSent(h, 1);
    assert.match(sent.text, /7/);
    assert.match(sent.text, /ALLOWED_USERS=7/);
    h.tg.push(userMsg('tekrar', { from: { id: 7, is_bot: false, first_name: 'X' }, chat: { id: 7, type: 'private' } }));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(h.tg.state.sent.length, 1, 'aynı kişiye saatte bir kez yazar');
    assert.equal(h.cl.state.requests.length, 0, 'Claude çağrılmadı');
  } finally {
    await h.close();
  }
});

test('grup sohbetleri yok sayılır', async () => {
  const h = await setup();
  try {
    h.tg.push(userMsg('selam', { chat: { id: -100, type: 'group' } }));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(h.tg.state.sent.length, 0);
    assert.equal(h.cl.state.requests.length, 0);
  } finally {
    await h.close();
  }
});

test('metin → Claude → HTML cevap; istek token tasarruflu kurulur; geçmişe yalnızca metin yazılır', async () => {
  const h = await setup();
  h.cl.state.chat = () => ({ text: '**Yarın** güneşli, 18°C.' });
  try {
    h.tg.push(userMsg('selam şey yarın hava nasıl olacak'));
    const sent = await waitSent(h, 1);
    assert.equal(sent.parse_mode, 'HTML');
    assert.equal(sent.text, '<b>Yarın</b> güneşli, 18°C.');

    const [req] = h.cl.chats();
    const b = req.body;
    assert.match(req.url, /\/v1\/messages\?beta=true/);
    assert.equal(b.model, 'claude-opus-5-5');
    assert.deepEqual(b.output_config, { effort: 'low' });
    assert.deepEqual(b.cache_control, { type: 'ephemeral' });
    assert.equal(b.fallbacks, 'default');
    assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.deepEqual(b.tools.map((t) => t.name), ['hatirlatici_kur', 'hatirlaticilari_listele', 'hatirlatici_iptal', 'web_search']);
    assert.deepEqual(b.tools.map((t) => t.strict), [true, undefined, true, undefined]);
    assert.equal(b.tools[3].type, 'web_search_20260209');
    assert.equal(b.tools[3].max_uses, 3);
    assert.equal(b.stream, true, 'sohbet akışlı gider');
    assert.equal(b.thinking, undefined, 'Opus 5.5 düşünmeyi kendisi yönetir');

    const sys = b.system[0].text;
    assert.match(sys, /# Verimli Sohbet/);
    assert.match(sys, /## Ortam/);
    assert.doesNotMatch(sys, /Claude Code ve claude\.ai/, 'Claude Code bölümü bota girmez');
    assert.equal(b.system.length, 1, 'hafıza boşken ikinci blok yok');

    const blocks = lastUserBlocks(req);
    assert.equal(blocks.length, 1);
    assert.match(blocks[0].text, /^\[\d{2}\.\d{2}\.\d{4} .+\d{2}:\d{2}\] selam şey yarın hava nasıl olacak$/);

    const saved = h.saved();
    assert.equal(saved.turns.length, 2);
    assert.equal(typeof saved.turns[0].text, 'string');
    assert.equal(saved.turns[1].text, '**Yarın** güneşli, 18°C.');
    assert.equal(saved.usage.requests, 1);
    assert.ok(saved.usage.costUsd > 0);
  } finally {
    await h.close();
  }
});

test('art arda atılan mesajlar tek istekte birleşir', async () => {
  const h = await setup({ MERGE_WINDOW_MS: '150' });
  try {
    h.tg.push(userMsg('selam'));
    h.tg.push(userMsg('bir şey soracağım'));
    h.tg.push(userMsg('istanbul ankara kaç km'));
    await waitSent(h, 1);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(h.cl.chats().length, 1);
    assert.match(lastUserBlocks(h.cl.chats()[0]).at(-1).text, /selam\nbir şey soracağım\nistanbul ankara kaç km$/);
  } finally {
    await h.close();
  }
});

test('geçmiş sonraki turda metin olarak gider, düşünme blokları saklanmaz', async () => {
  const h = await setup();
  h.cl.state.chat = () => ({
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: 'Cevap bir.' },
    ],
  });
  try {
    h.tg.push(userMsg('soru bir'));
    await waitSent(h, 1);
    h.tg.push(userMsg('soru iki'));
    await waitSent(h, 2);
    const msgs = h.cl.chats()[1].body.messages;
    assert.equal(msgs.length, 3);
    assert.equal(msgs[1].role, 'assistant');
    assert.equal(msgs[1].content, 'Cevap bir.');
    assert.doesNotMatch(JSON.stringify(h.saved()), /signature/);
  } finally {
    await h.close();
  }
});

test('eşik aşılınca damıtma: hafıza güncellenir, geçmiş kısalır, sonraki istem hafızayı taşır', async () => {
  const h = await setup({ COMPACT_AT_TOKENS: '500', KEEP_TURNS: '2' });
  h.cl.state.chat = () => ({ text: 'Not aldım.', usage: { input_tokens: 900 } });
  h.cl.state.distill = () => ({ text: "<hafiza>\n- Ankara'da yaşıyor\n- Ankara'da yaşıyor\n</hafiza>\n<ozet>\nKira araştırması sürüyor.\n</ozet>" });
  try {
    h.tg.push(userMsg('Ankara\'da yaşıyorum'));
    await waitSent(h, 1);
    assert.equal(h.cl.distills().length, 0, 'tutulacak 2 mesajdan fazlası yokken damıtma yok');

    h.tg.push(userMsg('kira fiyatlarına bakıyorum'));
    await waitSent(h, 2);
    await waitFor(() => h.cl.distills().length === 1);
    await waitFor(() => h.state().compactions === 1);

    const d = h.cl.distills()[0].body;
    assert.match(d.system, /# Damıtma kuralları/);
    assert.match(d.messages[0].content, /<konusma>\nKullanıcı: \[.+\] Ankara'da yaşıyorum\n\nAsistan: Not aldım\.\n<\/konusma>/);
    assert.doesNotMatch(d.messages[0].content, /kira fiyatlarına/, 'son 2 mesaj damıtılmaz');
    assert.equal(d.cache_control, undefined, 'seyrek damıtma önbelleğe yazılmaz');
    assert.deepEqual(d.output_config, { effort: 'low' });

    const s = h.state();
    assert.deepEqual(s.memory, ["Ankara'da yaşıyor"], 'tekrar eden satır birleşir');
    assert.equal(s.summary, 'Kira araştırması sürüyor.');
    assert.equal(s.turns.length, 2);
    assert.match(s.turns[0].text, /kira fiyatlarına/);

    h.tg.push(userMsg('2+1 ne kadar'));
    await waitSent(h, 3);
    const next = h.cl.chats()[2].body;
    assert.equal(next.messages.length, 3);
    assert.match(next.system[1].text, /<hafiza>\n- Ankara'da yaşıyor\n<\/hafiza>/);
    assert.match(next.system[1].text, /<onceki_ozet>\nKira araştırması sürüyor\.\n<\/onceki_ozet>/);
  } finally {
    await h.close();
  }
});

test('damıtma başarısızsa geçmiş korunur, yalnızca sert sınırda kırpılır', async () => {
  const h = await setup({ COMPACT_AT_TOKENS: '10', KEEP_TURNS: '2', HARD_MAX_TURNS: '4' });
  h.cl.state.distill = () => ({ text: 'biçimsiz çıktı' });
  try {
    for (let i = 1; i <= 3; i++) {
      h.tg.push(userMsg(`mesaj ${i}`));
      await waitSent(h, i);
    }
    // 1. mesajdan sonra damıtılacak yok (2 tutulur); 2. ve 3. mesajdan sonra denenir.
    await waitFor(() => h.cl.distills().length === 2);
    await waitFor(() => h.state().turns.length === 4 && /mesaj 2/.test(h.state().turns[0].text));
    const s = h.state();
    assert.equal(s.compactions, 0);
    assert.equal(s.turns.length, 4);
    assert.match(s.turns[0].text, /mesaj 2/);
  } finally {
    await h.close();
  }
});

test('fotoğraf yalnızca o turda gönderilir; geçmişte kısa işaret kalır', async () => {
  const h = await setup();
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  h.tg.state.files.set('photos/PH2.jpg', jpeg);
  try {
    h.tg.push(userMsg(undefined, { caption: 'bu ne?', photo: [{ file_id: 'PH1', width: 90 }, { file_id: 'PH2', width: 800 }] }));
    await waitSent(h, 1);
    const blocks = lastUserBlocks(h.cl.chats()[0]);
    assert.equal(blocks[0].type, 'image');
    assert.equal(blocks[0].source.media_type, 'image/jpeg');
    assert.equal(blocks[0].source.data, jpeg.toString('base64'));
    assert.match(blocks[1].text, /\] \[Fotoğraf\] bu ne\?$/);

    h.tg.push(userMsg('peki'));
    await waitSent(h, 2);
    const hist = h.cl.chats()[1].body.messages;
    assert.match(hist[0].content, /\[Fotoğraf\] bu ne\?$/);
    assert.doesNotMatch(JSON.stringify(hist), new RegExp(jpeg.toString('base64').replace(/[+/]/g, '.')));
  } finally {
    await h.close();
  }
});

test('PDF document bloğu olarak gider; desteklenmeyen dosya için uyarı', async () => {
  const h = await setup();
  h.tg.state.files.set('documents/DOC1.pdf', Buffer.from('%PDF-1.4 test'));
  try {
    h.tg.push(userMsg(undefined, { caption: 'özetle', document: { file_id: 'DOC1', file_name: 'rapor.pdf', mime_type: 'application/pdf', file_size: 13 } }));
    await waitSent(h, 1);
    const blocks = lastUserBlocks(h.cl.chats()[0]);
    assert.equal(blocks[0].type, 'document');
    assert.equal(blocks[0].source.media_type, 'application/pdf');
    assert.match(blocks[1].text, /\[PDF: rapor\.pdf\] özetle$/);

    h.tg.push(userMsg(undefined, { document: { file_id: 'Z', file_name: 'a.zip', mime_type: 'application/zip', file_size: 10 } }));
    const warn = await waitSent(h, 2);
    assert.match(warn.text, /desteklenmiyor/);
    assert.equal(h.cl.chats().length, 1);
  } finally {
    await h.close();
  }
});

test('sesli mesaj yazıya çevrilir, metni gösterilir ve Claude\'a [Sesli] olarak gider', async () => {
  const stt = { bodies: [] };
  const sttSrv = await mockServer((req, body) => {
    stt.bodies.push({ auth: req.headers.authorization, body: body.toString() });
    return { json: { text: 'yarın saat üçte toplantı var hatırlat' } };
  });
  const h = await setup({ STT_API_KEY: 'gsk-test', STT_API_URL: `${sttSrv.url}/stt` });
  h.tg.state.files.set('voice/VC1.oga', Buffer.from('OggS fake'));
  try {
    h.tg.push(userMsg(undefined, { voice: { file_id: 'VC1', duration: 3, mime_type: 'audio/ogg' } }));
    const echo = await waitSent(h, 1);
    assert.equal(echo.text, '🎙 yarın saat üçte toplantı var hatırlat');
    await waitSent(h, 2);
    assert.match(lastUserBlocks(h.cl.chats()[0]).at(-1).text, /\] \[Sesli\] yarın saat üçte toplantı var hatırlat$/);
    assert.equal(stt.bodies[0].auth, 'Bearer gsk-test');
    assert.match(stt.bodies[0].body, /name="model"\r\n\r\nwhisper-large-v3-turbo/);
    assert.match(stt.bodies[0].body, /filename="ses\.ogg"/);
    assert.match(stt.bodies[0].body, /name="language"\r\n\r\ntr/);
  } finally {
    await h.close();
    await sttSrv.close();
  }
});

test('STT anahtarı yoksa sesli mesajda ne yapılacağı söylenir', async () => {
  const h = await setup();
  try {
    h.tg.push(userMsg(undefined, { voice: { file_id: 'VC1', duration: 3 } }));
    const sent = await waitSent(h, 1);
    assert.match(sent.text, /STT_API_KEY/);
    assert.equal(h.cl.state.requests.length, 0);
  } finally {
    await h.close();
  }
});

test('güvenlik reddi geçmişe yazılmaz', async () => {
  const h = await setup();
  h.cl.state.chat = () => ({ content: [], stop_reason: 'refusal' });
  try {
    h.tg.push(userMsg('...'));
    const sent = await waitSent(h, 1);
    assert.match(sent.text, /güvenlik/);
    assert.equal(h.saved().turns.length, 0);
    assert.equal(h.saved().usage.requests, 1);
  } finally {
    await h.close();
  }
});

test('web araması reddedilirse bir kez özelliksiz denenir ve kapatılır', async () => {
  const h = await setup();
  h.cl.state.chat = (body) => (body.tools.some((t) => t.name === 'web_search')
    ? { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'web_search is not enabled' } } }
    : { text: 'Aramasız cevap.' });
  try {
    h.tg.push(userMsg('dolar kaç'));
    const sent = await waitSent(h, 1);
    assert.equal(sent.text, 'Aramasız cevap.');
    const [first, second] = h.cl.chats();
    assert.ok(first.body.tools && first.body.fallbacks);
    assert.deepEqual(second.body.tools.map((t) => t.name), ['hatirlatici_kur', 'hatirlaticilari_listele', 'hatirlatici_iptal'],
      'istemci araçları kalır, yalnızca web araması çıkar');
    assert.ok(second.body.tools.every((t) => t.strict === undefined));
    assert.equal(second.body.fallbacks, undefined);
    assert.equal(second.headers['anthropic-beta'], undefined);
    assert.ok(h.bot.claude.disabled.has('web'));
  } finally {
    await h.close();
  }
});

test('API hatası kullanıcıya anlaşılır mesajla bildirilir, geçmiş değişmez', async () => {
  const h = await setup();
  h.cl.state.chat = () => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
  try {
    h.tg.push(userMsg('selam'));
    const sent = await waitSent(h, 1);
    assert.match(sent.text, /API anahtarı geçersiz/);
    assert.equal(h.state().turns.length, 0);
  } finally {
    await h.close();
  }
});

test('Telegram HTML\'i reddederse aynı parça düz metin gider', async () => {
  const h = await setup();
  h.cl.state.chat = () => ({ text: 'a **b** c' });
  h.tg.state.rejectHtml = true;
  try {
    h.tg.push(userMsg('x'));
    const sent = await waitSent(h, 1);
    assert.equal(sent.parse_mode, undefined);
    assert.equal(sent.text, 'a **b** c');
  } finally {
    await h.close();
  }
});

test('komutlar: hatirla, hafiza, efor, web, unut, durum', async () => {
  const h = await setup();
  try {
    h.tg.push(userMsg('/hatirla Kahveyi şekersiz içer'));
    assert.match((await waitSent(h, 1)).text, /Hafızada \(1 satır\)/);
    h.tg.push(userMsg('/hafıza'));
    assert.match((await waitSent(h, 2)).text, /1\. Kahveyi şekersiz içer/);
    h.tg.push(userMsg('/efor high'));
    assert.match((await waitSent(h, 3)).text, /Efor: high/);
    h.tg.push(userMsg('/efor çok'));
    assert.match((await waitSent(h, 4)).text, /Kullanım: \/efor/);
    h.tg.push(userMsg('/web kapat'));
    assert.match((await waitSent(h, 5)).text, /kapalı/);

    h.tg.push(userMsg('kahve öner'));
    await waitSent(h, 6);
    const b = h.cl.chats()[0].body;
    assert.deepEqual(b.output_config, { effort: 'high' });
    assert.ok(!b.tools.some((t) => t.name === 'web_search'));
    assert.doesNotMatch(b.system[0].text, /Web aramasını/);
    assert.match(b.system[1].text, /- Kahveyi şekersiz içer/);

    h.tg.push(userMsg('/unut 1'));
    assert.match((await waitSent(h, 7)).text, /Silindi: Kahveyi şekersiz içer/);
    assert.deepEqual(h.state().memory, []);

    h.tg.push(userMsg('/durum'));
    const st = (await waitSent(h, 8)).text;
    assert.match(st, /claude-opus-5-5/);
    assert.match(st, /efor: high/);
    assert.match(st, /Tahmini maliyet: \$/);

    h.tg.push(userMsg('/unut hepsi'));
    assert.match((await waitSent(h, 9)).text, /silindi/);
    assert.equal(h.state().turns.length, 0);

    h.tg.push(userMsg('/olmayan'));
    assert.match((await waitSent(h, 10)).text, /Bilinmeyen komut/);
  } finally {
    await h.close();
  }
});

test('/yeni konuyu kapatır: tüm geçmiş damıtılır, yalnız açık işler özette kalır', async () => {
  const h = await setup();
  h.cl.state.distill = () => ({ text: '<hafiza>\n- Pazartesi spor yapar\n</hafiza>\n<ozet>\n</ozet>' });
  try {
    h.tg.push(userMsg('pazartesileri spor yapıyorum'));
    await waitSent(h, 1);
    h.tg.push(userMsg('/yeni'));
    assert.match((await waitSent(h, 2)).text, /Konu kapatıldı\. Hafıza: 1 satır/);
    assert.match(h.cl.distills()[0].body.messages[0].content, /<not>Kullanıcı bu konuyu kapattı/);
    const s = h.state();
    assert.equal(s.turns.length, 0);
    assert.equal(s.summary, '');
    assert.deepEqual(s.memory, ['Pazartesi spor yapar']);
  } finally {
    await h.close();
  }
});

test('uzun sessizlikten sonra sohbet arka planda damıtılır (bir kez)', async () => {
  const h = await setup({ KEEP_TURNS: '0', IDLE_COMPACT_MINUTES: '60' });
  try {
    h.tg.push(userMsg('bir şey'));
    await waitSent(h, 1);
    h.bot.sweepIdle();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(h.cl.distills().length, 0, 'henüz sessiz değil');

    h.state().lastActivity = Date.now() - 61 * 60_000;
    h.bot.sweepIdle();
    await waitFor(() => h.state().compactions === 1);
    h.bot.sweepIdle();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(h.cl.distills().length, 1);
    assert.equal(h.state().turns.length, 0);
  } finally {
    await h.close();
  }
});

test('durum dosyası yeniden başlatmada geri yüklenir', async () => {
  const h = await setup();
  try {
    h.tg.push(userMsg('/hatirla Adı Asil'));
    await waitSent(h, 1);
    assert.deepEqual(h.saved().memory, ['Adı Asil']);
    h.store.cache.clear();
    assert.deepEqual(h.store.get(String(USER)).memory, ['Adı Asil']);
  } finally {
    await h.close();
  }
});

test('hatırlatma: model aracı çağırır, bot kurar, zamanı gelince yollar, sonraki turda bağlam olur', async () => {
  const h = await setup();
  const when = localIn(2 * 3600_000);
  h.cl.state.chat = (body, n) => {
    if (n === 1) {
      return {
        stop_reason: 'tool_use',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig-1' },
          { type: 'text', text: 'Kuruyorum.' },
          { type: 'tool_use', id: 'tu_1', name: 'hatirlatici_kur', input: { zaman: when, metin: 'Toplantı', tekrar: 'yok' } },
        ],
      };
    }
    if (n === 2) return { text: 'Kurdum, iki saat sonra yazarım.' };
    return { text: 'Tamam.' };
  };
  try {
    h.tg.push(userMsg('iki saat sonra toplantıyı hatırlat'));
    const sent = await waitSent(h, 1);
    assert.equal(sent.text, 'Kurdum, iki saat sonra yazarım.', 'araç öncesi ön söz gösterilmez');

    const second = h.cl.chats()[1].body.messages;
    assert.equal(second.at(-2).role, 'assistant');
    assert.equal(second.at(-2).content[0].signature, 'sig-1', 'tur içinde düşünme bloğu aynen geri gider');
    assert.deepEqual(second.at(-1).content[0].type, 'tool_result');
    assert.equal(second.at(-1).content[0].tool_use_id, 'tu_1');
    assert.match(second.at(-1).content[0].content, /^Kuruldu #1: \d{4}-\d{2}-\d{2} \S+ \d{2}:\d{2} — Toplantı$/);

    const saved = h.saved();
    assert.equal(saved.reminders.length, 1);
    assert.deepEqual(saved.turns.map((t) => t.role), ['user', 'assistant']);
    assert.doesNotMatch(JSON.stringify(saved.turns), /tool_use|tool_result|sig-1/);

    h.state().reminders[0].at = Date.now() - 1000;
    await h.bot.reminders.tick();
    assert.equal((await waitSent(h, 2)).text, '⏰ Toplantı');
    assert.equal(h.state().reminders.length, 0);

    h.tg.push(userMsg('tamam geldim'));
    await waitSent(h, 3);
    const t = h.cl.chats()[2].body.messages.at(-1).content.at(-1).text;
    assert.match(t, /^\[.+\] \[.+ hatırlattım: «Toplantı»\]\ntamam geldim$/);
    assert.deepEqual(h.state().notes, []);
  } finally {
    await h.close();
  }
});

test('hatırlatma aracı hatası modele is_error olarak döner', async () => {
  const h = await setup();
  h.cl.state.chat = (body, n) => (n === 1
    ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_x', name: 'hatirlatici_kur', input: { zaman: '2020-01-01 10:00', metin: 'eski', tekrar: 'yok' } }] }
    : { text: 'O zaman geçmişte kalmış.' });
  try {
    h.tg.push(userMsg('2020de hatırlat'));
    await waitSent(h, 1);
    const result = h.cl.chats()[1].body.messages.at(-1).content[0];
    assert.equal(result.is_error, true);
    assert.match(result.content, /geçmişte/);
    assert.equal((h.state().reminders || []).length, 0);
  } finally {
    await h.close();
  }
});

test('tekrarlı hatırlatma ateşlenince bir sonraki güne kayar; /hatirlatmalar listeler ve siler', async () => {
  const h = await setup();
  try {
    const s = h.state();
    s.reminders = [{ id: 1, at: Date.now() - 1000, text: 'İlaç', repeat: 'her_gun' }];
    s.nextReminderId = 1;
    await h.bot.reminders.tick();
    assert.equal((await waitSent(h, 1)).text, '⏰ İlaç');
    const next = h.state().reminders[0].at;
    assert.ok(next > Date.now() + 23 * 3600_000 && next < Date.now() + 25 * 3600_000);

    h.tg.push(userMsg('/hatirlatmalar'));
    assert.match((await waitSent(h, 2)).text, /#1 · .+ \(her gün\) — İlaç/);
    h.tg.push(userMsg('/hatırlatmalar sil 1'));
    assert.match((await waitSent(h, 3)).text, /İptal: #1 İlaç/);
    h.tg.push(userMsg('/hatirlatmalar'));
    assert.equal((await waitSent(h, 4)).text, 'Kurulu hatırlatma yok.');
  } finally {
    await h.close();
  }
});

test('REMINDERS=off: araç gönderilmez, model söz vermemesi için uyarılır', async () => {
  const h = await setup({ REMINDERS: 'off', WEB_SEARCH: 'off' });
  try {
    h.tg.push(userMsg('yarın hatırlat'));
    await waitSent(h, 1);
    const b = h.cl.chats()[0].body;
    assert.equal(b.tools, undefined);
    assert.match(b.system[0].text, /Hatırlatma kuramazsın/);
  } finally {
    await h.close();
  }
});
