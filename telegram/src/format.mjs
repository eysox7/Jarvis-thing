// Claude'un Markdown'ını Telegram HTML'ine çevirir ve 4096 karakter sınırına göre böler.
// Telegram yalnızca sınırlı etiketleri tanır: b i s u code pre a blockquote.
// Çeviri bozuk çıkarsa gönderici düz metne düşer (telegram.mjs), yani burası "en iyi çaba".

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');

export function toTelegramHTML(md) {
  const slots = [];
  const hold = (html) => `\u0000${slots.push(html) - 1}\u0000`;

  // 1) Kod blokları ve satır içi kod: içleri olduğu gibi kalır.
  let s = md.replace(/```([\w+#.-]*)[^\S\n]*\n?([\s\S]*?)```/g, (_, lang, code) => {
    const body = esc(code.replace(/\n$/, ''));
    return hold(lang ? `<pre><code class="language-${attr(lang)}">${body}</code></pre>` : `<pre>${body}</pre>`);
  });
  s = s.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${esc(code)}</code>`));

  // 2) Gerisini kaçır.
  s = esc(s);

  // 3) Satır düzeyi: başlık → kalın, madde imi → •, alıntı → blockquote, yatay çizgi → boş.
  const lines = s.split('\n');
  const out = [];
  let quote = [];
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.join('\n')}</blockquote>`);
    quote = [];
  };
  for (let line of lines) {
    const q = line.match(/^&gt;\s?(.*)$/);
    if (q) { quote.push(q[1]); continue; }
    flushQuote();
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue;
    line = line.replace(/^#{1,6}\s+(.+?)\s*#*\s*$/, (_, t) => `**${t.replace(/\*\*/g, '')}**`);
    line = line.replace(/^(\s*)[-*+]\s+/, '$1• ');
    out.push(line);
  }
  flushQuote();
  s = out.join('\n');

  // 4) Bağlantılar: adresin içindeki _ ve * biçim sanılmasın diye saklanır.
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) =>
    hold(`<a href="${url.replace(/"/g, '&quot;')}">${text}</a>`));
  s = s.replace(/https?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g, (url) => hold(url));

  // 5) Satır içi biçim.
  s = s.replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^\w])__(?=\S)([^\n]*?\S)__(?!\w)/g, '$1<b>$2</b>');
  s = s.replace(/~~(?=\S)([^\n]*?\S)~~/g, '<s>$1</s>');
  s = s.replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1<i>$2</i>');
  s = s.replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g, '$1<i>$2</i>');

  // 6) Saklananları geri koy (bağlantı metnindeki kod gibi iç içe olanlar dahil).
  while (/\u0000\d+\u0000/.test(s)) s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[+i]);
  return s;
}

// Metni sınırı aşmayan parçalara böler; mümkünse paragraf/satır sınırından.
// Kod bloğunun ortasından bölünürse blok kapatılıp sonraki parçada yeniden açılır.
export function splitMessage(text, limit = 3800) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let cur = '';
  let fence = null; // açık kod bloğunun açılış satırı (```dil)

  const push = () => {
    if (!cur.trim()) { cur = ''; return; }
    chunks.push(fence ? `${cur.replace(/\n$/, '')}\n\`\`\`` : cur.replace(/\n+$/, ''));
    cur = fence ? `${fence}\n` : '';
  };

  for (const raw of text.split('\n')) {
    const pieces = [];
    for (let i = 0; i < raw.length || i === 0; i += limit - 10) pieces.push(raw.slice(i, i + limit - 10));
    for (const line of pieces) {
      const reserve = fence ? 4 : 0;
      if (cur.length + line.length + 1 + reserve > limit) push();
      cur += `${line}\n`;
    }
    if (/^\s*```/.test(raw)) fence = fence ? null : raw.trim();
  }
  if (cur.trim()) chunks.push(cur.replace(/\n+$/, ''));
  return chunks;
}
