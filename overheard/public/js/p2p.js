import { api } from './api.js';
import { t } from './i18n.js';
import { h, timeAgo, displayName } from './util.js';
import { openSheet, closeSheet, sheetKey, toast } from './ui.js';
import { store } from './store.js';
import { qrMatrix } from './qr.js';

// Kulaktan kulağa (eşten eşe, internetsiz). Metroda bağlantı yokken yazdığın sözü ekranında QR olarak
// gösterirsin ya da AirDrop/Quick Share ile gönderirsin (ikisi de internet istemez). Yanındaki sözü
// hemen okur ve o da taşır; hanginiz önce bağlantı bulursa sözü sunucuya o ulaştırır. Söz bu cihazın
// anahtarıyla imzalanır (anahtarın açık yarısı bağlıyken bir kez kaydedilir): taşıyan sözü
// değiştiremez, kimse başkası adına söz uyduramaz.
const KEY = 'device';
const b64url = (bytes) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export const linkFor = (payload) => `${location.origin}/#p2p=${payload}`;

export function createP2P(app) {
  // Bağlıyken bir kez: cihaz anahtarı üretilir, açık yarısı sunucuya kaydedilir. Özel anahtar
  // dışarı aktarılamaz biçimde yalnızca bu cihazda (IndexedDB) durur.
  async function ensureKey() {
    const user = app.state.user;
    if (!user || !globalThis.crypto?.subtle) return null;
    const saved = await store.get('keys', KEY);
    if (saved?.handle === user.handle) return saved;
    if (!navigator.onLine) return null;
    try {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
      const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
      const { keyId } = await api.registerDeviceKey(jwk);
      const record = { id: KEY, keyId, handle: user.handle, privateKey: pair.privateKey };
      await store.put('keys', record);
      return record;
    } catch {
      return null;
    }
  }

  // Sözü imzalı, kısa bir pakete çevirir: "<veri>.<anahtar>.<imza>" (QR'a sığsın diye kısa alanlar).
  async function payloadFor(item) {
    const key = await ensureKey();
    if (!key) throw new Error('no_key');
    const fix = item.fix ? [Number(item.fix[0].toFixed(5)), Number(item.fix[1].toFixed(5)), Math.round(item.fix[2]), Math.round(item.fix[3])] : null;
    const data = {
      c: item.clientId, p: item.placeId, n: item.placeName, t: item.text, h: item.heardAt,
      v: item.visibility === 'public' ? 'p' : 'l', a: item.anonymous ? 1 : 0, e: item.ephemeral ? 1 : 0, f: fix,
      u: item.anonymous ? null : item.author,
    };
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, bytes));
    return `${b64url(bytes)}.${key.keyId}.${b64url(sig)}`;
  }

  function qrCanvas(text) {
    const rows = qrMatrix(text, { ecl: 'L' });
    const quiet = 4;
    const n = rows.length + quiet * 2;
    const scale = Math.max(2, Math.floor(720 / n));
    const canvas = h('canvas', { class: 'p2p-qr', width: n * scale, height: n * scale, role: 'img', 'aria-label': t('p2p.qrAlt') });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '1') ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    });
    return canvas;
  }

  async function show(item) {
    let link;
    try {
      link = linkFor(await payloadFor(item));
    } catch {
      toast(t('p2p.noKey'), { tone: 'error', timeout: 8000 });
      return;
    }
    const share = navigator.share
      ? h('button', {
        class: 'btn btn-block',
        type: 'button',
        onclick: () => navigator.share({ title: 'Dedikoydu', text: t('p2p.shareText'), url: link }).catch(() => {}),
      }, `📲 ${t('p2p.share')}`)
      : null;
    openSheet({
      key: `p2p:${item.id}`,
      title: `📡 ${t('p2p.title')}`,
      body: h('div', { class: 'stack' },
        h('p', { class: 'muted small' }, t('p2p.showHow')),
        qrCanvas(link),
        h('blockquote', { class: 'chat-quote' }, item.text),
        share,
        h('input', { class: 'input qr-url', type: 'text', readonly: true, value: link, 'aria-label': t('p2p.link'), onfocus: (e) => e.currentTarget.select() })),
    });
  }

  function receivedCard(record) {
    const { item } = record;
    return h('div', { class: 'stack' },
      h('blockquote', { class: 'chat-quote' }, item.t),
      h('p', { class: 'muted small' }, [item.n, timeAgo(item.h), displayName(item.u)].filter(Boolean).join(' · ')),
      h('p', { class: 'offline-note' }, record.own ? t('p2p.ownNote') : record.delivered ? `✅ ${t('p2p.delivered')}` : `📡 ${t('p2p.receivedNote')}`));
  }

  // Kod/bağlantıyla gelen söz: hemen okunur, saklanır ve (başkasınınsa) taşınmak üzere kuyruğa girer.
  async function receive(payload) {
    const [data, keyId, sig] = String(payload).split('.');
    let item;
    try {
      item = JSON.parse(new TextDecoder().decode(fromB64url(data)));
      if (!item?.c || !item.t || !keyId || !sig) throw new Error('bad');
    } catch {
      toast(t('p2p.bad'), { tone: 'error' });
      return;
    }
    const id = `${keyId}:${item.c}`;
    const own = (await store.get('keys', KEY))?.keyId === keyId;
    let record = await store.get('received', id);
    if (!record) {
      record = { id, payload, item, own, receivedAt: Date.now(), delivered: false };
      await store.put('received', record);
      if (!own) await app.offline.save({ id, kind: 'relay', payload: { p: payload }, preview: item.t, placeName: item.n, heardAt: item.h });
    }
    openSheet({ key: `p2p-got:${id}`, title: `📡 ${t('p2p.received')}`, body: receivedCard(record) });
    app.offline.flush();
  }

  async function list() {
    const records = (await store.all('received')).sort((a, b) => b.receivedAt - a.receivedAt);
    openSheet({
      key: 'p2p-list',
      title: `📡 ${t('p2p.list')}`,
      body: h('div', { class: 'stack' },
        h('p', { class: 'muted small' }, t('p2p.listHow')),
        h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: scan }, `📷 ${t('p2p.scan')}`),
        records.length
          ? h('ul', { class: 'list' }, records.map((r) => h('li', { class: 'admin-item' }, receivedCard(r))))
          : h('p', { class: 'empty' }, t('p2p.listEmpty'))),
    });
  }

  function loadJsQR() {
    if (window.jsQR) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = h('script', { src: '/vendor/jsqr/jsQR.js' });
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  }

  // Uygulama içinde kamerayla okutma (telefonun kendi kamera uygulaması da bağlantıyı açar).
  async function scan() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch {
      toast(t('p2p.noCamera'), { tone: 'error', timeout: 8000 });
      return;
    }
    const stop = () => stream.getTracks().forEach((track) => track.stop());
    const video = h('video', { class: 'p2p-video', playsinline: true, muted: true, autoplay: true });
    video.srcObject = stream;
    openSheet({ key: 'p2p-scan', title: `📷 ${t('p2p.scan')}`, body: h('div', { class: 'stack' }, h('p', { class: 'muted small' }, t('p2p.scanHow')), video), onClose: stop });
    const detector = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
    if (!detector) await loadJsQR().catch(() => {});
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (sheetKey() !== 'p2p-scan') {
        stop();
        return;
      }
      let text = null;
      if (video.readyState >= 2) {
        if (detector) {
          text = (await detector.detect(video).catch(() => []))[0]?.rawValue ?? null;
        } else if (window.jsQR) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          text = window.jsQR(frame.data, frame.width, frame.height)?.data ?? null;
        }
      }
      const match = text?.match(/#p2p=([\w.-]+)/);
      if (match) {
        stop();
        closeSheet();
        receive(match[1]);
        return;
      }
      setTimeout(tick, 150);
    };
    tick();
  }

  return { ensureKey, show, receive, list, scan, payloadFor };
}

// Adres çubuğundaki "#p2p=..." (telefonun kamerası ya da AirDrop ile açılan bağlantı). Parça
// (fragment) sunucuya hiç gitmez; okununca adresten silinir.
export function takeP2pPayload() {
  const match = location.hash.match(/^#p2p=([\w.-]+)$/);
  if (!match) return null;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  return match[1];
}

