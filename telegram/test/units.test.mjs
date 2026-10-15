// Birim testleri: biçim çevirici, bölücü, skill yükleyici, damıtma ayrıştırıcı, yapılandırma.

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { parseCommand, renderContext } from '../src/bot.mjs';
import { parseDistill } from '../src/claude.mjs';
import { ROOT, loadEnvFile, readConfig, validateConfig } from '../src/config.mjs';
import { splitMessage, toTelegramHTML } from '../src/format.mjs';
import { loadSkill } from '../src/skill.mjs';

test('Markdown → Telegram HTML', () => {
  assert.equal(toTelegramHTML('**kalın** ve *eğik* ve ~~çizik~~'), '<b>kalın</b> ve <i>eğik</i> ve <s>çizik</s>');
  assert.equal(toTelegramHTML('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
  assert.equal(toTelegramHTML('`x<y>`'), '<code>x&lt;y&gt;</code>');
  assert.equal(toTelegramHTML('```js\nif (a<b) {}\n```'), '<pre><code class="language-js">if (a&lt;b) {}</code></pre>');
  assert.equal(toTelegramHTML('```\n**değil**\n```'), '<pre>**değil**</pre>');
  assert.equal(toTelegramHTML('## Başlık'), '<b>Başlık</b>');
  assert.equal(toTelegramHTML('- bir\n* iki'), '• bir\n• iki');
  assert.equal(toTelegramHTML('[site](https://a.com/?x=1&y="2")'), '<a href="https://a.com/?x=1&amp;y=&quot;2&quot;">site</a>');
  assert.equal(toTelegramHTML('> alıntı\n> devam\nnormal'), '<blockquote>alıntı\ndevam</blockquote>\nnormal');
  assert.equal(toTelegramHTML('snake_case_adi ve 2 * 3 * 4'), 'snake_case_adi ve 2 * 3 * 4');
  assert.equal(toTelegramHTML('---'), '');
});

test('uzun mesaj bölünür; kod bloğu parçalar arasında kapanıp yeniden açılır', () => {
  assert.deepEqual(splitMessage('kısa'), ['kısa']);
  const para = 'x'.repeat(100);
  const parts = splitMessage(Array(30).fill(para).join('\n'), 1000);
  assert.ok(parts.length >= 3);
  assert.ok(parts.every((p) => p.length <= 1000));
  assert.equal(parts.join('\n'), Array(30).fill(para).join('\n'));

  const code = `\`\`\`py\n${Array(30).fill('print(1)').join('\n')}\n\`\`\``;
  const cparts = splitMessage(code, 120);
  assert.ok(cparts.length > 1);
  for (const p of cparts) {
    assert.ok(p.length <= 120, p.length);
    assert.equal((p.match(/```/g) || []).length % 2, 0, `açık kalan blok: ${p}`);
  }
  assert.match(cparts[1], /^```py\n/);

  const huge = splitMessage('y'.repeat(2500), 1000);
  assert.ok(huge.every((p) => p.length <= 1000));
  assert.equal(huge.join(''), 'y'.repeat(2500));
});

test('skill: sohbet kısmı Claude Code bölümünü ve frontmatter\'ı içermez', () => {
  const skill = loadSkill(path.join(ROOT, '..', '.claude', 'skills', 'verimli-sohbet'));
  assert.match(skill.chat, /^# Verimli Sohbet/);
  assert.doesNotMatch(skill.chat, /^---|name: verimli-sohbet/m);
  assert.doesNotMatch(skill.chat, /yalnizca-claude-code|## 4\./);
  assert.doesNotMatch(skill.chat, /\]\(references\//, 'bot dosya bağlantısı izleyemez');
  assert.match(skill.chat, /references\/damitma\.md\s+kurallarıyla/);
  assert.match(skill.distill, /<hafiza>[\s\S]*<ozet>/);
});

test('damıtma çıktısı ayrıştırılır, tekrarlar ve fazlalık atılır', () => {
  const r = parseDistill('ön söz\n<hafiza>\n- A\n• B\n1. C\n- a\n\n</hafiza>\n<ozet>\n Durum. \n</ozet>', 3);
  assert.deepEqual(r.memory, ['A', 'B', 'C']);
  assert.equal(r.summary, 'Durum.');
  assert.deepEqual(parseDistill('<hafiza>\n- ...\n</hafiza><ozet>...</ozet>'), { memory: [], summary: '' });
  assert.throws(() => parseDistill('<hafiza>- A</hafiza>'), /biçimde değil/);
});

test('hafıza bağlamı yalnızca dolu parçaları içerir', () => {
  assert.equal(renderContext([], ''), '');
  const c = renderContext(['A'], '');
  assert.match(c, /<hafiza>\n- A\n<\/hafiza>/);
  assert.doesNotMatch(c, /onceki_ozet/);
});

test('komut ayrıştırma: Türkçe karakter, takma ad, @bot', () => {
  assert.deepEqual(parseCommand('/hafıza', 'b'), { name: 'hafiza', arg: '' });
  assert.deepEqual(parseCommand('/HATIRLA  süt al ', 'b'), { name: 'hatirla', arg: 'süt al' });
  assert.deepEqual(parseCommand('/new@b', 'b'), { name: 'yeni', arg: '' });
  assert.equal(parseCommand('/yeni@baskabot', 'b'), null);
  assert.equal(parseCommand('selam /yeni', 'b'), null);
  assert.equal(parseCommand('/xyz', 'b').name, 'bilinmeyen');
});

test('yapılandırma: varsayılanlar, doğrulama, .env okuma', async () => {
  const cfg = readConfig({ KEEP_TURNS: '5', ALLOWED_USERS: '1, 2 x' });
  assert.equal(cfg.model, 'claude-opus-5-5');
  assert.equal(cfg.memoryModel, 'claude-opus-5-5');
  assert.equal(cfg.effort, 'low');
  assert.equal(cfg.keepTurns, 4, 'çift sayıya yuvarlanır');
  assert.deepEqual([...cfg.allowedUsers], [1, 2]);
  assert.equal(cfg.webSearch, true);
  const errs = validateConfig(readConfig({ BOT_EFFORT: 'turbo', TIMEZONE: 'Mars/Olympus' }));
  assert.equal(errs.length, 4);

  const fs = await import('node:fs');
  const os = await import('node:os');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'env-')), '.env');
  fs.writeFileSync(file, '# yorum\nA=1\nexport B="iki kelime"\nC=3 # not\nD=önceden\n');
  const env = { D: 'ortam' };
  loadEnvFile(file, env);
  assert.deepEqual(env, { A: '1', B: 'iki kelime', C: '3', D: 'ortam' });
});

test('hatırlatma zamanı: yerel saat ↔ epoch, yaz saati, geçersiz tarih', async () => {
  const { parseLocal, formatLocal, nextOccurrence } = await import('../src/reminders.mjs');
  const ist = 'Europe/Istanbul';
  const t = parseLocal('2026-10-16 15:00', ist);
  assert.equal(t, Date.UTC(2026, 9, 16, 12, 0));
  assert.equal(formatLocal(t, ist), '2026-10-16 Cum 15:00');
  // Berlin'de 29 Mart 2026 02:00'de saat ileri alınır: 03:30 yerel = 01:30 UTC.
  assert.equal(parseLocal('2026-03-29 03:30', 'Europe/Berlin'), Date.UTC(2026, 2, 29, 1, 30));
  assert.throws(() => parseLocal('2026-02-30 10:00', ist), /Geçersiz/);
  assert.throws(() => parseLocal('yarın 3', ist), /biçiminde/);

  const fri = parseLocal('2026-10-16 09:00', ist);
  assert.equal(nextOccurrence(fri, 'yok', ist), null);
  assert.equal(formatLocal(nextOccurrence(fri, 'her_gun', ist), ist), '2026-10-17 Cmt 09:00');
  assert.equal(formatLocal(nextOccurrence(fri, 'hafta_ici', ist), ist), '2026-10-19 Pzt 09:00');
  assert.equal(formatLocal(nextOccurrence(fri, 'her_hafta', ist), ist), '2026-10-23 Cum 09:00');
  // Bot kapalıyken kaçırılanlar atlanır: ilk gelecek zamana gider.
  const after = parseLocal('2026-10-20 12:00', ist);
  assert.equal(formatLocal(nextOccurrence(fri, 'her_gun', ist, after), ist), '2026-10-21 Çar 09:00');
});

test('hatırlatma ekleme/iptal kuralları', async () => {
  const { addReminder, cancelReminder, listReminders } = await import('../src/reminders.mjs');
  const ist = 'Europe/Istanbul';
  const now = Date.UTC(2026, 9, 15, 12, 0); // 15:00 yerel
  const s = {};
  assert.throws(() => addReminder(s, { zaman: '2026-10-15 14:00', metin: 'x', tekrar: 'yok' }, ist, now), /geçmişte/);
  assert.throws(() => addReminder(s, { zaman: '2026-10-15 16:00', metin: '  ', tekrar: 'yok' }, ist, now), /boş/);
  const a = addReminder(s, { zaman: '2026-10-16 09:00', metin: 'Fatura\n öde', tekrar: 'her_gun' }, ist, now);
  const b = addReminder(s, { zaman: '2026-10-15 18:00', metin: 'Ara', tekrar: 'saçma' }, ist, now);
  assert.deepEqual([a.id, b.id, b.repeat, a.text], [1, 2, 'yok', 'Fatura öde']);
  assert.equal(listReminders(s, ist), '#2 · 2026-10-15 Per 18:00 — Ara\n#1 · 2026-10-16 Cum 09:00 (her gün) — Fatura öde');
  cancelReminder(s, 2);
  assert.throws(() => cancelReminder(s, 2), /yok/);
  assert.equal(s.reminders.length, 1);
});

test('Markdown: adresteki _ ve * biçim sanılmaz, bağlantı metnindeki kod korunur', () => {
  assert.equal(toTelegramHTML('bak https://a.com/_x_/y*z* sonra'), 'bak https://a.com/_x_/y*z* sonra');
  assert.equal(toTelegramHTML('(https://a.com/x).'), '(https://a.com/x).');
  assert.equal(toTelegramHTML('[`kod`](https://a.com/a_b_)'), '<a href="https://a.com/a_b_"><code>kod</code></a>');
});
