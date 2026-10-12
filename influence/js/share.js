// Klon kartı: arkadaşa gönderilebilen küçük paket. Ham dosyalar ve mesajlar ASLA girmez.
import { S, save } from './store.js';
import { b64urlEncode, b64urlDecode, download } from './util.js';
import { BY_ID } from './dilemmas.js';

const pack = (o) => Object.entries(o || {}).map(([id, c]) => id.slice(1) + c).join('');
const unpack = (s) => Object.fromEntries((String(s || '').match(/\d{2}[AB]/g) || []).map((t) => ['d' + t.slice(0, 2), t[2]]));

export function toCard(clone) {
  return {
    k: 'influence-clone', v: 1,
    id: clone.id, n: clone.name, c: clone.code, h: clone.hue, bio: clone.bio || '', st: clone.style || '',
    w: clone.w, b: clone.b, tr: pack(clone.train), te: pack(clone.test),
    s: clone.sync?.core?.acc ?? null, sn: clone.sync?.neural?.acc ?? null, at: clone.builtAt,
  };
}

export function fromCard(card) {
  if (!card || card.k !== 'influence-clone' || !Array.isArray(card.w) || card.w.length !== 8) throw new Error('Geçerli bir klon kartı değil.');
  const train = unpack(card.tr), test = unpack(card.te);
  for (const id of [...Object.keys(train), ...Object.keys(test)]) if (!BY_ID[id]) throw new Error('Kartta bilinmeyen soru: ' + id);
  return {
    id: String(card.id).slice(0, 40), own: false,
    name: String(card.n || 'İsimsiz').slice(0, 30), code: String(card.c || '').slice(0, 12),
    hue: Number(card.h) % 360 || 0, bio: String(card.bio || '').slice(0, 280), style: String(card.st || '').slice(0, 200),
    w: card.w.map(Number), b: Number(card.b) || 0, train, test,
    sync: { core: card.s != null ? { acc: Number(card.s) } : null, neural: card.sn != null ? { acc: Number(card.sn) } : null },
    builtAt: card.at, importedAt: new Date().toISOString(),
  };
}

export const cardLink = (clone) => {
  const base = location.href.split('#')[0];
  return `${base}#klon=${b64urlEncode(JSON.stringify(toCard(clone)))}`;
};

export function parseLinkOrJson(text) {
  const t = String(text || '').trim();
  const m = t.match(/#klon=([A-Za-z0-9_-]+)/);
  return fromCard(JSON.parse(m ? b64urlDecode(m[1]) : t));
}

export function addFriend(clone) {
  if (S.clone && clone.id === S.clone.id) throw new Error('Bu senin kendi klonun.');
  const i = S.friends.findIndex((f) => f.id === clone.id);
  if (i >= 0) S.friends[i] = { ...S.friends[i], ...clone };
  else S.friends.push(clone);
  save();
  return i >= 0 ? 'updated' : 'added';
}

export function exportFile(clone) {
  download(`${clone.name.replace(/[^\p{L}\p{N}]+/gu, '_')}.influence.json`, JSON.stringify(toCard(clone), null, 1));
}

export async function shareCard(clone) {
  const url = cardLink(clone);
  const text = `${clone.name} klonuyla Influence Arena'da kapışmaya var mısın? 🧬⚔️`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Influence klon kartı', text, url }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'aborted'; }
  }
  try { await navigator.clipboard.writeText(url); return 'copied'; } catch { return url; }
}
