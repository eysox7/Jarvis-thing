// Gerçek tarayıcıda (Playwright/Chromium) uçtan uca senaryolar.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startTestServer } from '../helpers.js';

let chromium = null;
try {
  ({ chromium } = await import('playwright'));
} catch {
  // Playwright kurulu değilse bu dosyadaki testler atlanır.
}

const KADIKOY = { latitude: 40.9925, longitude: 29.0236, accuracy: 12 };
const MODA = { latitude: 40.981, longitude: 29.027, accuracy: 12 };
// 1×1 saydam PNG: harita karoları yerine (testler dış ağa çıkmasın).
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const FAKE_GOOGLE = await readFile(new URL('../fixtures/fake-google-maps.js', import.meta.url), 'utf8');

async function newUser(browser, base, geolocation, { google = 'none' } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    geolocation,
    locale: 'tr-TR',
  });
  await context.route(/basemaps\.cartocdn\.com|tile\.openstreetmap\.org/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG }));
  await context.route(/maps\.googleapis\.com/, (route) => (google === 'fake'
    ? route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_GOOGLE })
    : route.abort()));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(base);
  await page.waitForSelector('body.is-ready');
  return { context, page, errors };
}

const sheet = (page) => page.locator('#sheet');

async function loginAsGuest(page) {
  await page.locator('[data-nav="profile"]').click();
  await sheet(page).getByRole('button', { name: 'Giriş yap' }).click();
  await sheet(page).getByRole('button', { name: /misafir/ }).click();
  await page.waitForFunction(() => window.overheard.app.state.user?.isGuest);
}

const zoomTo = (page, lat, lng) => page.evaluate(([la, ln]) => window.overheard.app.goToPlace({ cityId: 'istanbul', lat: la, lng: ln }), [lat, lng]);

describe('Uçtan uca', { skip: !chromium && 'playwright kurulu değil' }, () => {
  let browser;
  before(async () => { browser = await chromium.launch(); });
  after(async () => { await browser?.close(); });

  describe('Leaflet ile iki kullanıcı', () => {
    let srv;
    before(async () => { srv = await startTestServer({ demo: true }); });
    after(async () => { await srv.close(); });

    test('söz bırak → kilitli gör → mekâna git → aç → mesajlaş (canlı)', async () => {
      const a = await newUser(browser, srv.base, KADIKOY);
      const b = await newUser(browser, srv.base, MODA);
      assert.equal(await a.page.evaluate(() => window.overheard.mapProvider), 'leaflet');

      // A: "Duydum" → giriş yoksa önce giriş, sonra doğrudan söz formu açılır.
      await a.page.locator('[data-nav="post"]').click();
      await sheet(a.page).getByRole('button', { name: /misafir/ }).click();
      const text = 'Vapurda biri: "Martılar bizden daha çok seyahat ediyor."';
      await sheet(a.page).locator('textarea[name="text"]').fill(text);
      await sheet(a.page).getByText('Kadıköy İskelesi').waitFor();
      await sheet(a.page).getByRole('button', { name: /Bırak/ }).click();
      await a.page.locator('.leaflet-popup .bubble-quote', { hasText: 'Martılar bizden' }).waitFor();
      const id = await a.page.evaluate(() => window.overheard.openBubbleId);
      assert.ok(id);

      // B: Moda'da; Kadıköy'deki söz kilitli ve metni sayfada hiç yok.
      await loginAsGuest(b.page);
      await zoomTo(b.page, 40.9925, 29.0236);
      await b.page.locator(`.oh-bubble[data-id="${id}"]`).waitFor();
      assert.match(await b.page.locator(`.oh-bubble[data-id="${id}"]`).getAttribute('class'), /is-locked/);
      assert.ok(!(await b.page.content()).includes('Martılar bizden'));
      await b.page.locator(`.oh-bubble[data-id="${id}"]`).click();
      await b.page.locator('.leaflet-popup', { hasText: 'Kadıköy İskelesi mekânında duyuldu' }).waitFor();

      // B mekâna "ışınlanır" (demo) → kilit açılır, aynı anda orada oldukları görülür.
      await b.page.locator('.leaflet-popup').getByRole('button', { name: /ışınlan/ }).click();
      await b.page.locator('.toast', { hasText: 'Kadıköy İskelesi açıldı' }).waitFor();
      await b.page.locator('.leaflet-popup .bubble-quote', { hasText: 'Martılar bizden' }).waitFor();
      await b.page.locator('.leaflet-popup', { hasText: 'Sen de oradaydın' }).waitFor();

      // B tepki verir ve mesaj atar.
      await b.page.locator('.leaflet-popup .react[title="Güldüm"]').click();
      await b.page.locator('.leaflet-popup .react.is-pressed[title="Güldüm"]').waitFor();
      await b.page.locator('.leaflet-popup').getByRole('button', { name: /Mesaj at/ }).click();
      await sheet(b.page).locator('textarea').fill('Ben de o vapurdaydım! Arka sırada mıydın?');
      await sheet(b.page).locator('textarea').press('Enter');
      await sheet(b.page).locator('.msg.is-me', { hasText: 'Arka sırada' }).waitFor();
      await sheet(b.page).locator('.chip', { hasText: 'Kadıköy İskelesi' }).waitFor();

      // A: mesaj SSE ile canlı gelir; bildirimden konuşmaya geçip cevaplar.
      await a.page.locator('[data-nav="inbox"] .badge:not([hidden])').waitFor();
      await a.page.locator('.toast', { hasText: 'Arka sırada' }).getByRole('button').click();
      await sheet(a.page).locator('.msg.is-them', { hasText: 'Arka sırada' }).waitFor();
      await sheet(a.page).locator('textarea').fill('Evet, simitçinin yanındaydım :)');
      await sheet(a.page).getByRole('button', { name: 'Gönder' }).click();

      // B'nin açık sohbetine cevap canlı düşer.
      await sheet(b.page).locator('.msg.is-them', { hasText: 'simitçinin yanındaydım' }).waitFor();

      assert.deepEqual(a.errors, []);
      assert.deepEqual(b.errors, []);
      await a.context.close();
      await b.context.close();
    });

    test('"Ben de duydum" tanığı balonda görünür, söz sahibi ona yazar', async () => {
      const a = await newUser(browser, srv.base, KADIKOY);
      const b = await newUser(browser, srv.base, MODA);
      await loginAsGuest(a.page);
      await a.page.locator('[data-nav="post"]').click();
      await sheet(a.page).locator('textarea[name="text"]').fill('İskelede biri: "Bu vapur da bizi beklemedi."');
      await sheet(a.page).getByText('Kadıköy İskelesi').waitFor();
      await sheet(a.page).getByRole('button', { name: /Bırak/ }).click();
      await a.page.locator('.leaflet-popup .bubble-quote', { hasText: 'beklemedi' }).waitFor();
      const id = await a.page.evaluate(() => window.overheard.openBubbleId);

      await loginAsGuest(b.page);
      const witness = await b.page.evaluate(() => window.overheard.app.state.user.handle);
      await zoomTo(b.page, 40.9925, 29.0236);
      await b.page.locator(`.oh-bubble[data-id="${id}"]`).click();
      await b.page.locator('.leaflet-popup').getByRole('button', { name: /ışınlan/ }).click();
      await b.page.locator('.leaflet-popup .bubble-quote', { hasText: 'beklemedi' }).waitFor();
      await b.page.locator('.leaflet-popup .react[title="Ben de duydum"]').click();
      await b.page.locator('.leaflet-popup .bubble-witnesses', { hasText: witness }).waitFor();

      // Söz sahibi balonu yeniden açınca tanığı görür ve ona yazar.
      await a.page.evaluate(() => window.overheard.app.refresh());
      await a.page.evaluate((oid) => {
        const o = window.overheard.app.state.data.overheards.find((x) => x.id === oid);
        window.overheard.app.openOverheard(o);
      }, id);
      await a.page.locator('.leaflet-popup .bubble-witnesses .chip-btn', { hasText: witness }).last().click();
      await sheet(a.page).getByText('İkiniz de bu sözü duydunuz').waitFor();
      await sheet(a.page).locator('textarea').fill('Sen de oradaydın demek!');
      await sheet(a.page).locator('textarea').press('Enter');
      await sheet(a.page).locator('.msg.is-me', { hasText: 'oradaydın demek' }).waitFor();
      await b.page.locator('.toast', { hasText: 'oradaydın demek' }).waitFor();

      assert.deepEqual(a.errors, []);
      assert.deepEqual(b.errors, []);
      await a.context.close();
      await b.context.close();
    });

    test('anonim söz: ad gizli, sohbette sahibi kimliğini açar', async () => {
      const a = await newUser(browser, srv.base, KADIKOY);
      const b = await newUser(browser, srv.base, KADIKOY);
      await loginAsGuest(a.page);
      const authorHandle = await a.page.evaluate(() => window.overheard.app.state.user.handle);
      await a.page.locator('[data-nav="post"]').click();
      await sheet(a.page).locator('textarea[name="text"]').fill('Biri telefonda: "Ben aslında çok sakin biriyim, bağırmıyorum!"');
      await sheet(a.page).getByText('Kadıköy İskelesi').waitFor();
      await sheet(a.page).locator('input[name="anonymous"]').check();
      await sheet(a.page).getByRole('button', { name: /Bırak/ }).click();
      await a.page.locator('.leaflet-popup', { hasText: 'Senin sözün (anonim)' }).waitFor();
      const id = await a.page.evaluate(() => window.overheard.openBubbleId);

      await loginAsGuest(b.page);
      await b.page.locator('#btn-locate').click();
      await b.page.locator('.toast', { hasText: 'açıldı' }).first().waitFor();
      await b.page.evaluate((oid) => {
        const o = window.overheard.app.state.data.overheards.find((x) => x.id === oid);
        window.overheard.app.openOverheard(o);
      }, id);
      await b.page.locator('.leaflet-popup .bubble-author', { hasText: 'Anonim kulak' }).last().waitFor();
      assert.ok(!(await b.page.content()).includes(authorHandle), 'anonim yazarın adı sayfada olmamalı');
      await b.page.locator('.leaflet-popup').last().getByRole('button', { name: /Mesaj at/ }).click();
      await sheet(b.page).locator('textarea').fill('Sakin olduğun belliydi :)');
      await sheet(b.page).locator('textarea').press('Enter');
      await sheet(b.page).locator('.sheet-title', { hasText: 'Anonim kulak' }).waitFor();

      await a.page.locator('.toast', { hasText: 'Sakin olduğun' }).getByRole('button').click();
      await sheet(a.page).getByRole('button', { name: 'Kimliğimi göster' }).click();
      await sheet(a.page).getByRole('button', { name: 'Kimliğimi göster' }).waitFor({ state: 'detached' });
      await b.page.locator('.toast', { hasText: 'kimliğini açtı' }).waitFor();
      await sheet(b.page).locator('.sheet-title', { hasText: authorHandle }).waitFor();

      assert.deepEqual(a.errors, []);
      assert.deepEqual(b.errors, []);
      await a.context.close();
      await b.context.close();
    });

    test('Mekânlarım kilidi açılan ve bekleyen mekânları listeler', async () => {
      const u = await newUser(browser, srv.base, KADIKOY);
      await loginAsGuest(u.page);
      await u.page.locator('#btn-locate').click();
      await u.page.locator('.toast', { hasText: 'Kadıköy İskelesi açıldı' }).waitFor();
      await u.page.locator('[data-nav="places"]').click();
      await sheet(u.page).locator('.list-item:not(.is-locked)', { hasText: 'Kadıköy İskelesi' }).waitFor();
      await sheet(u.page).locator('.list-item.is-locked').first().waitFor();
      // İlk check-in rozet kazandırır; profilde seri, şehir ilerlemesi ve rozet görünür.
      await u.page.locator('.toast', { hasText: 'Yeni rozet: İlk adım' }).waitFor();
      await u.page.locator('[data-nav="profile"]').click();
      await sheet(u.page).locator('.badge-card.is-earned', { hasText: 'İlk adım' }).waitFor();
      await sheet(u.page).locator('.streak', { hasText: '1 haftalık seri' }).waitFor();
      await sheet(u.page).locator('.progress-row', { hasText: 'İstanbul' }).waitFor();
      assert.deepEqual(u.errors, []);
      await u.context.close();
    });

    test('yakındaki kilitli mekân kartı ve keşif modunda "sıcak" ipucu', async () => {
      const start = { latitude: 40.985, longitude: 29.033, accuracy: 12 };
      const u = await newUser(browser, srv.base, start);
      await loginAsGuest(u.page);
      await u.page.locator('#btn-locate').click();
      const nudge = u.page.locator('#nudge');
      await nudge.getByText('kilitli söz seni bekliyor').waitFor();
      await nudge.getByText('Bahariye Caddesi').waitFor();

      // Keşif modu: Bahariye'ye yaklaştıkça ipucu gelir (300 m eşiği).
      await u.page.locator('#btn-explore').click();
      await u.page.locator('.toast', { hasText: 'Keşif modu açık' }).waitFor();
      await u.context.setGeolocation({ latitude: 40.9862, longitude: 29.0305, accuracy: 12 });
      await u.page.locator('.toast', { hasText: 'Sıcak! Bahariye Caddesi' }).waitFor();

      // Kartı kapatınca sıradaki kilitli mekân gösterilir.
      await nudge.getByRole('button', { name: 'Kapat' }).click();
      await nudge.filter({ hasNotText: 'Bahariye Caddesi' }).getByText('kilitli söz seni bekliyor').waitFor();
      assert.deepEqual(u.errors, []);
      await u.context.close();
    });

    test('İngilizce arayüze geçiş', async () => {
      const u = await newUser(browser, srv.base, KADIKOY);
      await u.page.locator('[data-nav="profile"]').click();
      await sheet(u.page).locator('select').selectOption('en');
      await u.page.locator('[data-nav="map"] span', { hasText: 'Map' }).waitFor();
      await sheet(u.page).getByText('How it works').waitFor();
      await u.context.close();
    });
  });

  describe('Moderasyon paneli', () => {
    let srv;
    before(async () => { srv = await startTestServer({ demo: true, admins: ['moderator'] }); });
    after(async () => { await srv.close(); });

    test('moderatör gizlenen sözü panelde görür ve geri yükler', async () => {
      // Bir demo sözünü şikâyetlerle gizlenmiş hâle getir.
      const target = srv.db.prepare("SELECT id, text FROM overheards WHERE place_id = 'ist-moda-sahil' LIMIT 1").get();
      const users = srv.db.prepare('SELECT id FROM users LIMIT 3').all();
      for (const u of users) srv.db.prepare("INSERT INTO reports (overheard_id, user_id, reason, created_at) VALUES (?, ?, 'spam', ?)").run(target.id, u.id, Date.now());
      srv.db.prepare('UPDATE overheards SET hidden = 1 WHERE id = ?').run(target.id);

      const u = await newUser(browser, srv.base, KADIKOY);
      await u.page.locator('[data-nav="profile"]').click();
      await sheet(u.page).getByRole('button', { name: 'Giriş yap' }).click();
      await sheet(u.page).getByRole('tab', { name: 'Kayıt ol' }).click();
      await sheet(u.page).locator('input[name="handle"]').fill('moderator');
      await sheet(u.page).locator('input[name="password"]').fill('cok-gizli-parola');
      await sheet(u.page).locator('form').getByRole('button', { name: 'Kayıt ol' }).click();
      try {
        await u.page.waitForFunction(() => window.overheard.app.state.user?.isAdmin, null, { timeout: 8000 });
      } catch (err) {
        const debug = await u.page.evaluate(() => ({ user: window.overheard.app.state.user, sheet: document.querySelector('#sheet')?.innerText }));
        throw new Error(`kayıt olmadı: ${JSON.stringify(debug)} ${JSON.stringify(u.errors)}`);
      }

      await u.page.locator('[data-nav="profile"]').click();
      await sheet(u.page).getByRole('button', { name: /Moderasyon paneli/ }).click();
      const item = sheet(u.page).locator('.admin-item', { hasText: target.text });
      await item.getByText('Gizlendi').waitFor();
      await item.getByRole('button', { name: 'Geri yükle' }).click();
      await u.page.locator('.toast', { hasText: 'Söz geri yüklendi' }).waitFor();
      await sheet(u.page).getByText('Bekleyen şikâyet yok').waitFor();
      assert.equal(srv.db.prepare('SELECT hidden FROM overheards WHERE id = ?').get(target.id).hidden, 0);
      assert.deepEqual(u.errors, []);
      await u.context.close();
    });
  });

  describe('Yoğun bölge', () => {
    let srv;
    before(async () => {
      srv = await startTestServer({ demo: true });
      const { id: userId } = srv.db.prepare('SELECT id FROM users LIMIT 1').get();
      const insert = srv.db.prepare("INSERT INTO overheards (id, user_id, place_id, text, created_at) VALUES (?, ?, 'ist-bebek', ?, ?)");
      srv.db.exec('BEGIN');
      for (let i = 0; i < 400; i++) insert.run(`yogun${i}`, userId, `Bebek'te söz ${i}`, Date.now() - i * 1000);
      srv.db.exec('COMMIT');
    });
    after(async () => { await srv.close(); });

    test('yakınlaşınca görünür alanın sözleri ayrıca yüklenir', async () => {
      const u = await newUser(browser, srv.base, KADIKOY);
      const before = await u.page.evaluate(() => window.overheard.app.state.data.overheards.length);
      assert.equal(before, 300);
      // Mekân sayacı listedeki 300 sözle sınırlı değildir (400 toplu + 1 demo sözü).
      const count = await u.page.evaluate(() => window.overheard.app.state.data.places.find((p) => p.id === 'ist-bebek').count);
      assert.equal(count, 401);
      await u.page.locator('.oh-place, .oh-dot', { hasText: '401' }).first().waitFor();
      await zoomTo(u.page, 41.077, 29.0435);
      await u.page.waitForFunction(() => window.overheard.app.state.data.overheards.filter((o) => o.placeId === 'ist-bebek').length >= 300);
      await u.page.locator('.oh-bubble.is-locked, .oh-dot.is-locked').first().waitFor();
      assert.deepEqual(u.errors, []);
      await u.context.close();
    });
  });

  describe('Google Maps', () => {
    let srv;
    before(async () => { srv = await startTestServer({ demo: true, googleMapsKey: 'test-key' }); });
    after(async () => { await srv.close(); });

    test('anahtar varken Google Maps uyarlayıcısı balonları çizer ve açar', async () => {
      const u = await newUser(browser, srv.base, KADIKOY, { google: 'fake' });
      assert.equal(await u.page.evaluate(() => window.overheard.mapProvider), 'google');
      // Genel bakışta mekân baloncukları.
      await u.page.locator('.oh-gmarker .oh-place', { hasText: 'Kadıköy İskelesi' }).waitFor();
      await loginAsGuest(u.page);
      await zoomTo(u.page, 40.9925, 29.0236);
      // Harita boşta ('idle') kalıp balonları yeniden çizene kadar bekle.
      await u.page.waitForTimeout(300);
      const locked = u.page.locator('.oh-gmarker .oh-bubble.is-locked').first();
      await locked.waitFor();
      await locked.click();
      const info = u.page.locator('.gm-style-iw-c');
      await info.getByText('mekânında duyuldu').waitFor();
      await info.getByRole('button', { name: /ışınlan/ }).click();
      await u.page.locator('.toast', { hasText: 'açıldı' }).first().waitFor();
      await u.page.locator('.oh-gmarker .oh-bubble.is-open').first().waitFor();
      await u.page.locator('.oh-gmarker .oh-bubble.is-open').first().click();
      await info.locator('.bubble-quote').waitFor();
      assert.deepEqual(u.errors, []);
      await u.context.close();
    });

    test('Google Maps yüklenemezse Leaflet\'e döner', async () => {
      const u = await newUser(browser, srv.base, KADIKOY, { google: 'blocked' });
      await u.page.waitForFunction(() => window.overheard.mapProvider === 'leaflet');
      await u.page.locator('.toast', { hasText: 'OpenStreetMap' }).waitFor();
      await u.page.locator('.leaflet-container').waitFor();
      assert.deepEqual(u.errors, []);
      await u.context.close();
    });

    test('CSP Google alan adlarına yalnızca anahtar varken izin verir', async () => {
      const withKey = (await fetch(`${srv.base}/`)).headers.get('content-security-policy');
      assert.match(withKey, /script-src 'self' 'unsafe-eval' https:\/\/\*\.googleapis\.com/);
      const plain = await startTestServer();
      const without = (await fetch(`${plain.base}/`)).headers.get('content-security-policy');
      await plain.close();
      assert.match(without, /script-src 'self';/);
    });
  });
});
