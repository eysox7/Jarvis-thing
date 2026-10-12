// Veri yükleme: düz metin, WhatsApp dışa aktarımı, JSON, CSV. Hepsi cihazda çözülür.
// WhatsApp dosyalarından yalnızca kullanıcının kendi mesajları tutulur (veri en aza indirme).

const WA = /^\[?(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(?:-\s*)?([^:]{1,40}):\s(.+)$/;
const SKIP = /(<Medya dahil edilmedi>|<Media omitted>|Bu mesaj silindi|This message was deleted|uçtan uca şifreli|end-to-end encrypted)/i;
export const MAX_DOC_CHARS = 200_000;

export async function readFile(file) {
  const text = await file.text();
  const name = file.name;
  const lines = text.split(/\r?\n/);
  const waHits = lines.slice(0, 60).filter((l) => WA.test(l)).length;
  if (waHits >= 3) {
    const msgs = [];
    for (const l of lines) {
      const m = l.match(WA);
      if (m) msgs.push({ who: m[3].trim(), text: m[4] });
      else if (msgs.length && l.trim()) msgs[msgs.length - 1].text += '\n' + l;
    }
    const clean = msgs.filter((m) => !SKIP.test(m.text));
    const counts = {};
    for (const m of clean) counts[m.who] = (counts[m.who] || 0) + 1;
    const senders = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([who, n]) => ({ who, n }));
    return { kind: 'whatsapp', name, msgs: clean, senders };
  }
  if (/\.json$/i.test(name)) {
    try { return { kind: 'json', name, text: flattenJson(JSON.parse(text)).join('\n') }; } catch { /* düz metin say */ }
  }
  if (/\.csv$/i.test(name)) return { kind: 'csv', name, text: lines.map((l) => l.split(/[;,]/).join(' · ')).join('\n') };
  return { kind: 'text', name, text };
}

function flattenJson(v, out = []) {
  if (typeof v === 'string') { if (v.trim().length > 1) out.push(v); }
  else if (Array.isArray(v)) v.forEach((x) => flattenJson(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => flattenJson(x, out));
  return out;
}

/** Ham çözümlemeyi saklanacak belgeye çevirir. who: WhatsApp'ta kullanıcının adı. */
export function toDoc(parsed, who) {
  let text, style = '';
  if (parsed.kind === 'whatsapp') {
    const mine = parsed.msgs.filter((m) => m.who === who).map((m) => m.text);
    style = styleOf(mine);
    text = mine.join('\n');
  } else text = parsed.text;
  text = text.slice(-MAX_DOC_CHARS); // en yeni kısmı tut
  return { id: 'doc-' + Date.now().toString(36), name: parsed.name, kind: parsed.kind, chunks: chunk(text), style, chars: text.length, at: new Date().toISOString() };
}

export function chunk(text, size = 420) {
  const out = [];
  let buf = '';
  for (const part of text.split(/\n+/)) {
    if ((buf + '\n' + part).length > size && buf) { out.push(buf.trim()); buf = ''; }
    buf += (buf ? '\n' : '') + part;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const EMOJI = /\p{Extended_Pictographic}/gu;
export function styleOf(msgs) {
  if (!msgs.length) return '';
  const lens = msgs.map((m) => m.length);
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
  const emojis = msgs.join(' ').match(EMOJI) || [];
  const freq = {};
  for (const e of emojis) freq[e] = (freq[e] || 0) + 1;
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
  const lower = msgs.filter((m) => m === m.toLocaleLowerCase('tr')).length / msgs.length;
  const q = msgs.filter((m) => m.includes('?')).length / msgs.length;
  const parts = [avg < 40 ? 'kısa ve hızlı yazar' : avg < 120 ? 'orta uzunlukta yazar' : 'uzun, detaylı yazar'];
  if (top.length) parts.push(`sık kullandığı emojiler ${top.join(' ')}`);
  if (lower > 0.7) parts.push('çoğunlukla küçük harfle yazar');
  if (q > 0.3) parts.push('çok soru sorar');
  return parts.join(', ');
}

// --- Arama: Türkçe için kaba ama etkili "ilk 5 harf" kökleme + BM25 ---
const STOP = new Set('ve ile ama fakat bir bu şu o da de mi mu mü mı ne çok daha gibi için kadar sonra önce ben sen biz siz onlar var yok olan oldu olur ise ki hem ya'.split(' '));
export function tokens(s) {
  return (s.toLocaleLowerCase('tr').match(/[\p{L}\p{N}]+/gu) || [])
    .filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 5));
}

export function search(docs, query, k = 3) {
  const chunks = docs.flatMap((d) => d.chunks);
  if (!chunks.length) return [];
  const qt = [...new Set(tokens(query))];
  if (!qt.length) return [];
  const toks = chunks.map(tokens);
  const avgdl = toks.reduce((s, t) => s + t.length, 0) / toks.length || 1;
  const df = {};
  for (const t of toks) for (const w of new Set(t)) df[w] = (df[w] || 0) + 1;
  const N = chunks.length, k1 = 1.2, b = 0.75;
  return toks.map((t, i) => {
    const tf = {};
    for (const w of t) tf[w] = (tf[w] || 0) + 1;
    let score = 0;
    for (const q of qt) {
      if (!tf[q]) continue;
      const idf = Math.log(1 + (N - df[q] + 0.5) / (df[q] + 0.5));
      score += idf * (tf[q] * (k1 + 1)) / (tf[q] + k1 * (1 - b + b * t.length / avgdl));
    }
    return { i, score };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, k).map((r) => chunks[r.i]);
}
