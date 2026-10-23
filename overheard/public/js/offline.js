import { api } from './api.js';
import { t, errorText } from './i18n.js';
import { truncate } from './util.js';
import { toast } from './ui.js';
import { store } from './store.js';

// Çevrimdışı söz: metroda, tünelde bağlantı yokken yazılan söz cihazda (outbox) bekler, bağlantı
// gelince gönderilir. Sunucu o sırada orada olduğunu (biniş/giriş ya da cihazın o anki konumu)
// doğrular. Kulaktan kulağa taşınan başkalarının sözleri de (kind: 'relay') aynı kuyruktan gider.
export function createOffline(app) {
  const chip = document.getElementById('offline-chip');
  let flushing = false;

  // Bu cihazdaki kuyruktan bu hesabın gönderebilecekleri: kendi sözlerin ve taşıdıkların.
  async function pending() {
    const handle = app.state.user?.handle;
    return (await store.all('outbox')).filter((item) => item.kind === 'relay' || item.author === handle).sort((a, b) => a.heardAt - b.heardAt);
  }

  async function render() {
    const items = app.state.user ? await pending() : [];
    const offline = !navigator.onLine || app.state.offline;
    chip.hidden = !offline && !items.length;
    chip.classList.toggle('is-offline', offline);
    chip.textContent = items.length ? `📤 ${t('offline.waiting', { n: items.length })}` : `📴 ${t('offline.banner')}`;
  }

  async function save(item) {
    await store.put('outbox', item);
    // Destekleyen tarayıcılarda sayfa kapalıyken de bağlantı gelince gönderilir (sw.js).
    navigator.serviceWorker?.ready.then((reg) => reg.sync?.register('outbox')).catch(() => {});
    await render();
  }

  async function flush() {
    if (flushing || !app.state.user || !navigator.onLine) return;
    flushing = true;
    let sent = 0;
    try {
      for (const item of await pending()) {
        try {
          const { overheard, newBadges } = item.kind === 'relay' ? await api.relay(item.payload) : await api.postOffline(item);
          await store.del('outbox', item.id);
          if (item.kind === 'relay') {
            const got = await store.get('received', item.id);
            if (got) await store.put('received', { ...got, delivered: true });
            toast(t('p2p.deliveredToast', { text: truncate(item.preview || '', 40) }), { tone: 'success' });
          } else {
            toast(t('offline.sent', { text: truncate(overheard.text, 40) }), { tone: 'success' });
          }
          app.celebrate(newBadges);
          sent += 1;
        } catch (err) {
          // Bağlantı yok ya da sunucu meşgul: sonra yeniden dene.
          if (err.code === 'network' || err.status >= 500 || err.status === 429 || err.status === 401) break;
          // Kalıcı ret (o sırada orada olduğun doğrulanamadı, süre doldu, denetim): kuyruktan çıkar.
          await store.del('outbox', item.id);
          toast(t('offline.failed', { text: truncate(item.text || item.preview || '', 40), reason: errorText(err) }), { tone: 'error', timeout: 9000 });
        }
      }
    } finally {
      flushing = false;
    }
    if (sent) {
      app.state.offline = false;
      await app.refresh();
    }
    await render();
  }

  // Misafir hesap kalıcıya çevrilince kullanıcı adı değişir: bekleyen sözler yeni ada geçer.
  async function retag(from, to) {
    for (const item of await store.all('outbox')) if (item.author === from) await store.put('outbox', { ...item, author: to });
  }

  window.addEventListener('online', () => {
    app.state.offline = false;
    flush();
    render();
  });
  window.addEventListener('offline', () => render());
  setInterval(flush, 30000);

  return { save, flush, render, pending, retag };
}
