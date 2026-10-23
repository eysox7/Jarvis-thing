// Gerçek tarayıcıda (Playwright/Chromium) uçtan uca senaryolar.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startTestServer } from '../helpers.js';
import { addStaff, saveVenue } from '../../server/venues.js';
import { importLines, parseLines } from '../../server/osm.js';

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

async function newUser(browser, base, geolocation, { google = 'none', intro = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    geolocation,
    locale: 'tr-TR',
  });
  if (!intro) await context.addInitScript(() => localStorage.setItem('oh_intro_seen', '1'));
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
      await b.page.locator('.toast', { hasText: 'Kadıköy İskelesi: buradasın' }).waitFor();
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
      await b.page.locator('.toast', { hasText: 'buradasın' }).first().waitFor();
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

    test('yerel söz ayrılınca yeniden kilitlenir; herkese açık söz her yerden okunur', async () => {
      const a = await newUser(browser, srv.base, KADIKOY);
      await loginAsGuest(a.page);
      await a.page.locator('[data-nav="post"]').click();
      await sheet(a.page).locator('textarea[name="text"]').fill('Herkese duyurulur: iskelede çay 20 lira olmuş.');
      await sheet(a.page).getByText('Kadıköy İskelesi').waitFor();
      await sheet(a.page).getByText('Herkese açık').click();
      await sheet(a.page).locator('input[name="ephemeral"]').check();
      await sheet(a.page).getByRole('button', { name: /Bırak/ }).click();
      await a.page.locator('.leaflet-popup .chip', { hasText: 'Herkese açık' }).waitFor();
      await a.page.locator('.leaflet-popup .chip', { hasText: '24 sa sonra kaybolacak' }).waitFor();
      const publicId = await a.page.evaluate(() => window.overheard.openBubbleId);

      // Austin'deki biri herkese açık sözü okur; yerel olanları okuyamaz.
      const far = await newUser(browser, srv.base, { latitude: 30.2672, longitude: -97.739, accuracy: 10 });
      await loginAsGuest(far.page);
      await far.page.evaluate(() => window.overheard.app.selectCity('istanbul'));
      const view = await far.page.evaluate((id) => {
        const list = window.overheard.app.state.data.overheards;
        return { pub: list.find((o) => o.id === id), anyLocalOpen: list.some((o) => o.visibility === 'local' && !o.locked) };
      }, publicId);
      assert.equal(view.pub.locked, false);
      assert.equal(view.pub.text, 'Herkese duyurulur: iskelede çay 20 lira olmuş.');
      assert.equal(view.anyLocalOpen, false);

      // Kadıköy'deyken yerel sözler açık; Moda'ya geçince kilitlenir.
      const b = await newUser(browser, srv.base, KADIKOY);
      await loginAsGuest(b.page);
      await b.page.locator('#btn-locate').click();
      await b.page.locator('.toast', { hasText: 'Kadıköy İskelesi: buradasın' }).waitFor();
      const localOpen = () => b.page.evaluate(() => window.overheard.app.state.data.overheards
        .filter((o) => o.placeId === 'ist-kadikoy-iskele' && o.visibility === 'local').map((o) => o.locked));
      assert.ok((await localOpen()).every((locked) => locked === false));
      await b.context.setGeolocation(MODA);
      await b.page.locator('#btn-locate').click();
      await b.page.locator('.toast', { hasText: 'Kadıköy İskelesi mekânından ayrıldın' }).waitFor();
      assert.ok((await localOpen()).every((locked) => locked === true));

      for (const u of [a, far, b]) {
        assert.deepEqual(u.errors, []);
        await u.context.close();
      }
    });

    test('Mekânlarım kilidi açılan ve bekleyen mekânları listeler', async () => {
      const u = await newUser(browser, srv.base, KADIKOY);
      await loginAsGuest(u.page);
      await u.page.locator('#btn-locate').click();
      await u.page.locator('.toast', { hasText: 'Kadıköy İskelesi: buradasın' }).waitFor();
      await u.page.locator('[data-nav="places"]').click();
      await sheet(u.page).locator('.list-item:not(.is-locked)', { hasText: 'Kadıköy İskelesi' }).first().waitFor();
      await sheet(u.page).getByText('Şu an buradasın').waitFor();
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
      await nudge.getByText('yerel söz seni bekliyor').waitFor();
      await nudge.getByText('Bahariye Caddesi').waitFor();

      // Keşif modu: Bahariye'ye yaklaştıkça ipucu gelir (300 m eşiği).
      await u.page.locator('#btn-explore').click();
      await u.page.locator('.toast', { hasText: 'Keşif modu açık' }).waitFor();
      await u.context.setGeolocation({ latitude: 40.9862, longitude: 29.0305, accuracy: 12 });
      await u.page.locator('#nudge[data-hot="300"]', { hasText: 'Bahariye Caddesi' }).waitFor();

      // Kartı kapatınca sıradaki kilitli mekân gösterilir.
      await nudge.getByRole('button', { name: 'Kapat' }).click();
      await nudge.filter({ hasNotText: 'Bahariye Caddesi' }).getByText('yerel söz seni bekliyor').waitFor();
      assert.deepEqual(u.errors, []);
      await u.context.close();
    });

    test('misafir hesabını kalıcı yapar ve açılışta konumla otomatik check-in olur', async () => {
      const u = await newUser(browser, srv.base, KADIKOY);
      await loginAsGuest(u.page);
      await u.page.locator('[data-nav="profile"]').click();
      await sheet(u.page).locator('form.upgrade input[name="handle"]').fill('kalici_e2e');
      await sheet(u.page).locator('form.upgrade input[name="password"]').fill('cok-gizli-parola');
      await sheet(u.page).locator('form.upgrade').getByRole('button', { name: 'Hesabını kalıcı yap' }).click();
      await u.page.locator('.toast', { hasText: 'Hesabın artık kalıcı' }).waitFor();
      await sheet(u.page).locator('.profile-handle', { hasText: '@kalici_e2e' }).waitFor();
      assert.equal(await sheet(u.page).locator('form.upgrade').count(), 0);

      // Konum izni verilmiş oturumda sayfayı yeniden açınca konum kendiliğinden alınır.
      await u.page.reload();
      await u.page.waitForSelector('body.is-ready');
      await u.page.waitForFunction(() => window.overheard.app.state.position !== null);
      await u.page.waitForFunction(() => window.overheard.app.state.data.places.find((p) => p.id === 'ist-kadikoy-iskele').here);
      assert.deepEqual(u.errors, []);
      await u.context.close();
    });

    test('ilk açılışta tanıtım gösterilir ve misafir olarak başlatır', async () => {
      const u = await newUser(browser, srv.base, KADIKOY, { intro: true });
      await sheet(u.page).getByText('Overheard\'e hoş geldin').waitFor();
      await sheet(u.page).getByText('Yerel sözler için oraya git').waitFor();
      await sheet(u.page).getByRole('button', { name: /misafir/ }).click();
      await u.page.waitForFunction(() => window.overheard.app.state.user?.isGuest);
      await u.page.reload();
      await u.page.waitForSelector('body.is-ready');
      assert.equal(await sheet(u.page).isVisible(), false, 'tanıtım bir kez gösterilir');
      assert.deepEqual(u.errors, []);
      await u.context.close();
    });

    test('verilerimi indir ve hesabımı sil', async () => {
      const u = await newUser(browser, srv.base, KADIKOY);
      await loginAsGuest(u.page);
      await u.page.locator('#btn-locate').click();
      await u.page.locator('.toast', { hasText: 'buradasın' }).first().waitFor();
      await u.page.locator('[data-nav="profile"]').click();
      const [download] = await Promise.all([
        u.page.waitForEvent('download'),
        sheet(u.page).getByRole('link', { name: /Verilerimi indir/ }).click(),
      ]);
      assert.equal(download.suggestedFilename(), 'overheard-verilerim.json');
      const data = JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(), 'utf8'));
      assert.ok(data.checkins.some((c) => c.place === 'Kadıköy İskelesi'));

      u.page.once('dialog', (d) => d.accept());
      await sheet(u.page).getByRole('button', { name: 'Hesabımı sil' }).click();
      await u.page.locator('.toast', { hasText: 'Hesabın ve verilerin silindi' }).waitFor();
      await u.page.waitForFunction(() => window.overheard.app.state.user === null);
      // Yasal sayfalar açılır.
      const privacy = await fetch(`${srv.base}/privacy.html`);
      assert.equal(privacy.status, 200);
      assert.match(await privacy.text(), /24 saat/);
      assert.deepEqual(u.errors, []);
      await u.context.close();
    });

    test('mekân odası: aynı yerdekiler canlı yazışır, ayrılınca oda kapanır', async () => {
      const a = await newUser(browser, srv.base, KADIKOY);
      const b = await newUser(browser, srv.base, KADIKOY);
      for (const u of [a, b]) {
        await loginAsGuest(u.page);
        await u.page.locator('#btn-locate').click();
        await u.page.locator('.toast', { hasText: 'buradasın' }).first().waitFor();
      }
      await a.page.evaluate(() => window.overheard.app.refresh());
      // Sunucu diğer testlerle ortak: Kadıköy'de en az bu iki kişi var.
      await a.page.locator('#btn-room:not([hidden]) .tool-count:not([hidden])').waitFor();
      assert.ok(Number(await a.page.locator('#btn-room .tool-count').textContent()) >= 2);
      await a.page.locator('#btn-room').click();
      await sheet(a.page).getByText(/Şu an burada \d+ kişi/).waitFor();

      await b.page.locator('#btn-room').click();
      await sheet(b.page).locator('textarea').fill('Vapur kaçta kalkıyor, bilen var mı?');
      await sheet(b.page).locator('textarea').press('Enter');
      await sheet(b.page).locator('.room-msg.is-me', { hasText: 'Vapur kaçta' }).waitFor();
      await sheet(a.page).locator('.room-msg.is-them', { hasText: 'Vapur kaçta' }).waitFor();

      // B oda açıkken yürüyüp Moda'ya geçince (keşif modundaki gibi bir check-in) oda kapanır.
      await b.page.evaluate(() => window.overheard.app.checkIn({ lat: 40.981, lng: 29.027, accuracy: 10 }, { silent: true }));
      await b.page.locator('.toast', { hasText: 'odadan çıktın' }).waitFor();
      assert.equal(await sheet(b.page).isVisible(), false);
      for (const u of [a, b]) {
        assert.deepEqual(u.errors, []);
        await u.context.close();
      }
    });

    test('herkese açık sözden paylaşım görseli (1080×1920 PNG)', async () => {
      const u = await newUser(browser, srv.base, KADIKOY);
      // Masaüstü tarayıcıda dosya paylaşımı yok: görsel indirilir.
      await u.page.evaluate(() => { navigator.canShare = undefined; });
      const id = await u.page.evaluate(() => {
        const o = window.overheard.app.state.data.overheards.find((x) => x.visibility === 'public');
        window.overheard.app.openOverheard(o);
        return o.id;
      });
      assert.ok(id);
      const [download] = await Promise.all([
        u.page.waitForEvent('download'),
        u.page.locator('.leaflet-popup').last().getByRole('button', { name: /Paylaş/ }).click(),
      ]);
      assert.equal(download.suggestedFilename(), 'overheard.png');
      const png = await (await import('node:fs/promises')).readFile(await download.path());
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1080, 1920]);
      // Yerel sözlerde paylaş düğmesi yok.
      await u.page.evaluate(() => {
        const o = window.overheard.app.state.data.overheards.find((x) => x.visibility === 'local' && x.locked);
        window.overheard.app.openOverheard(o);
      });
      await u.page.locator('.leaflet-popup', { hasText: 'mekânında duyuldu' }).last().waitFor();
      assert.equal(await u.page.locator('.leaflet-popup').last().getByRole('button', { name: /Paylaş/ }).count(), 0);
      assert.deepEqual(u.errors, []);
      await u.context.close();
    });

    test('haftanın en iyileri listesi ve haritada açma', async () => {
      const u = await newUser(browser, srv.base, KADIKOY);
      await u.page.locator('.best-chip').click();
      await sheet(u.page).getByText('İstanbul: haftanın en iyileri').waitFor();
      const first = sheet(u.page).locator('.best-item').first();
      await first.waitFor();
      const quote = (await first.locator('.best-quote').textContent()).replace(/[“”]/g, '');
      await first.locator('.best-main').click();
      await u.page.locator('.leaflet-popup .bubble-quote', { hasText: quote.slice(0, 20) }).last().waitFor();
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
      // Onaysız kayıt reddedilir; onay kutusu işaretlenince hesap açılır.
      await sheet(u.page).locator('form').getByRole('button', { name: 'Kayıt ol' }).click();
      await sheet(u.page).getByText('kullanım koşullarını ve gizlilik politikasını kabul etmelisin').waitFor();
      await sheet(u.page).locator('input[name="acceptTerms"]').check();
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

  describe('Mekân QR kodu', () => {
    let srv;
    before(async () => { srv = await startTestServer({ demo: true, admins: ['qrmod'] }); });
    after(async () => { await srv.close(); });

    test('moderatör posteri indirir; QR bağlantısıyla gelen kaba konumla mekâna girer', async () => {
      const mod = await newUser(browser, srv.base, KADIKOY);
      await mod.page.evaluate(() => fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'qrmod', password: 'cok-gizli-parola', acceptTerms: true }),
      }));
      await mod.page.reload();
      await mod.page.waitForSelector('body.is-ready');
      await mod.page.locator('[data-nav="profile"]').click();
      await sheet(mod.page).getByRole('button', { name: /Moderasyon paneli/ }).click();
      await sheet(mod.page).getByRole('searchbox', { name: 'Mekân adı' }).fill('galata');
      await sheet(mod.page).getByRole('button', { name: 'Ara', exact: true }).click();
      const item = sheet(mod.page).locator('.admin-item', { hasText: 'Galata Kulesi' });
      await item.getByRole('button', { name: /QR/ }).click();
      await item.locator('img.qr-image').waitFor();
      const url = await item.locator('input.qr-url').inputValue();
      assert.match(url, /\/\?qr=ist-galata\./);
      const [download] = await Promise.all([
        mod.page.waitForEvent('download'),
        item.getByRole('button', { name: /Posteri indir/ }).click(),
      ]);
      assert.equal(download.suggestedFilename(), 'overheard-qr-ist-galata.png');
      assert.deepEqual(mod.errors, []);
      await mod.context.close();

      // Ziyaretçi: kafenin içinde, GPS zayıf (~500 m sapma, 600 m belirsizlik).
      const visitor = await newUser(browser, srv.base, { latitude: 41.0301, longitude: 28.9741, accuracy: 600 });
      await visitor.page.goto(url);
      await visitor.page.waitForSelector('body.is-ready');
      // Kod adres çubuğundan hemen silinir; giriş yapılmamışsa önce giriş istenir.
      assert.equal(new URL(visitor.page.url()).search, '');
      await sheet(visitor.page).getByRole('button', { name: /misafir/ }).click();
      await visitor.page.locator('.toast', { hasText: 'Galata Kulesi: QR ile girdin' }).waitFor();
      await visitor.page.waitForFunction(() => window.overheard.app.state.data.places.find((p) => p.id === 'ist-galata')?.here);
      assert.equal(await visitor.page.locator('#btn-room').isVisible(), true);
      assert.deepEqual(visitor.errors, []);
      await visitor.context.close();
    });
  });

  describe('Overheard Kafe', () => {
    let srv;
    before(async () => { srv = await startTestServer({ demo: true }); });
    after(async () => { await srv.close(); });

    test('garson masayı açar, yazıcı ekranı fişi masa numarasıyla basar', async () => {
      const u = await newUser(browser, srv.base, KADIKOY);
      await u.page.evaluate(() => fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'garson_e2e', password: 'cok-gizli-parola', acceptTerms: true }),
      }));
      saveVenue(srv.db, 'ist-bahariye', { mode: 'nearby' });
      addStaff(srv.db, 'ist-bahariye', 'garson_e2e');
      const { id: authorId } = srv.db.prepare('SELECT id FROM users LIMIT 1').get();
      const insert = srv.db.prepare("INSERT INTO overheards (id, user_id, place_id, text, created_at, visibility) VALUES (?, ?, 'ist-kadikoy-iskele', ?, ?, 'public')");
      insert.run('kafe1', authorId, 'Vapurda biri: "Simit martının, çay benim."', Date.now() - 3600000);
      insert.run('kafe2', authorId, 'İskelede biri: "Bu vapur da kaçtı, hayat da."', Date.now() - 7200000);

      // Yazıcı ekranı (aynı personel hesabı, ayrı sekme); yazdırma penceresi testte sayılır.
      const printer = await u.context.newPage();
      await printer.addInitScript(() => { window.print = () => { window.prints = (window.prints || 0) + 1; }; });
      const printerErrors = [];
      printer.on('pageerror', (err) => printerErrors.push(err.message));
      await printer.goto(`${srv.base}/yazici.html?place=ist-bahariye`);
      await printer.locator('#printer-status', { hasText: 'Bağlı' }).waitFor();
      assert.equal(await printer.locator('#printer-title').textContent(), 'Bahariye Caddesi');

      // Kafe paneli: müşteri "overheard istiyorum" dedi, garson masa 7'yi açar.
      await u.page.reload();
      await u.page.waitForSelector('body.is-ready');
      await u.page.locator('[data-nav="profile"]').click();
      await sheet(u.page).getByRole('button', { name: /Kafe paneli: Bahariye Caddesi/ }).click();
      await sheet(u.page).getByRole('textbox', { name: 'Masa numarası' }).fill('7');
      await sheet(u.page).getByRole('button', { name: 'Aç', exact: true }).click();
      await u.page.locator('.toast', { hasText: 'Masa 7 açıldı' }).waitFor();
      await sheet(u.page).locator('.venue-table', { hasText: 'Masa 7' }).waitFor();

      // Yazıcı canlı haber alır ve basar; fiş son basılanlarda görünür.
      const card = printer.locator('.slip-card').first();
      await card.locator('.slip-table', { hasText: 'MASA 7' }).waitFor();
      // Demo verisinde yakında başka herkese açık sözler de var: hangisi seçildiyse fişte o yazar.
      const first = srv.db.prepare('SELECT o.text, p.name FROM print_jobs j JOIN overheards o ON o.id = j.overheard_id JOIN places p ON p.id = o.place_id ORDER BY j.id LIMIT 1').get();
      assert.equal(await card.locator('.slip-quote').textContent(), `“${first.text}”`);
      assert.match(await card.locator('.slip-meta').textContent(), new RegExp(first.name));
      assert.notEqual(first.name, 'Bahariye Caddesi');
      await card.locator('img.slip-qr').waitFor();
      assert.equal(await printer.evaluate(() => window.prints), 1);

      // "Bir söz daha": ikinci fiş de basılır; ikisi de basıldı olarak işaretlenir.
      await sheet(u.page).getByRole('button', { name: /Bir söz daha/ }).click();
      await printer.waitForFunction(() => window.prints === 2);
      await printer.waitForFunction(() => document.querySelectorAll('.slip-card').length === 2);
      assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM print_jobs WHERE printed_at IS NOT NULL').get().n, 2);
      assert.deepEqual(u.errors, []);
      assert.deepEqual(printerErrors, []);
      await u.context.close();
    });
  });

  describe('Sakin semt ve toplu taşıma hattı', () => {
    let srv;
    before(async () => {
      srv = await startTestServer({ demo: true });
      // Sentetik bir hat (test verisi) ve bir Overheard Kafe.
      const json = JSON.parse(await readFile(new URL('../fixtures/overpass-lines.json', import.meta.url), 'utf8'));
      importLines(srv.db, parseLines(json, { cityId: 'istanbul' }));
      srv.db.prepare("INSERT INTO places (id, city_id, name, kind, lat, lng, radius_m, created_at) VALUES ('ist-test-kafe', 'istanbul', 'Test Semt Kafesi', 'spot', 40.9750, 29.2550, 60, ?)").run(Date.now());
      saveVenue(srv.db, 'ist-test-kafe', { mode: 'nearby' });
    });
    after(async () => { await srv.close(); });

    test('boş bölgede ilk sözü bırakmaya ve en yakın kafeye çağrı; durakta binince hat açılır', async () => {
      // Hiç sözün olmadığı bir semtte, hattın bir durağının yakınında.
      const u = await newUser(browser, srv.base, { latitude: 40.9703, longitude: 29.2503, accuracy: 15 });
      await loginAsGuest(u.page);
      await u.page.locator('#btn-locate').click();
      await u.page.locator('.toast', { hasText: 'T9 Test A–Test D: hattasın' }).waitFor();
      const nudge = u.page.locator('#nudge');
      await nudge.getByText('Bu civarda henüz söz yok').waitFor();
      await nudge.getByText(/En yakın Overheard Kafe: Test Semt Kafesi/).waitFor();
      // Hat güzergâhı haritada; hattasın, bu yüzden dolu çizgi.
      await u.page.locator('path.oh-line.is-open').first().waitFor({ state: 'attached' });

      // İlk sözü bırak: hatta (öncü).
      await nudge.getByRole('button', { name: 'İlk sözü bırak' }).click();
      await sheet(u.page).locator('textarea[name="text"]').fill('Vagonda biri: "Bu hat da benim gibi sabahları geç kalıyor."');
      await sheet(u.page).getByText('T9 Test A–Test D').waitFor();
      await sheet(u.page).getByRole('button', { name: /Bırak/ }).click();
      await u.page.locator('.toast', { hasText: 'hattının ilk sözünü sen bıraktın' }).waitFor();
      // Artık civarda bir söz var: boş bölge kartı kalkar.
      await nudge.getByText('Bu civarda henüz söz yok').waitFor({ state: 'hidden' });
      await u.page.locator('.toast', { hasText: 'Yeni rozet: Öncü' }).waitFor();
      assert.deepEqual(u.errors, []);
      await u.context.close();
    });
  });

  describe('Çevrimdışı söz', () => {
    let srv;
    before(async () => { srv = await startTestServer({ demo: true }); });
    after(async () => { await srv.close(); });

    test('bağlantı yokken yazılan söz cihazda bekler, bağlantı gelince gönderilir', async () => {
      const u = await newUser(browser, srv.base, KADIKOY);
      await loginAsGuest(u.page);
      await u.page.evaluate(() => window.overheard.app.teleport({ lat: 40.9925, lng: 29.0236 }));
      await u.page.locator('.toast', { hasText: 'Kadıköy İskelesi: buradasın' }).waitFor();

      // Tünele girildi.
      await u.context.setOffline(true);
      const chip = u.page.locator('#offline-chip');
      await chip.getByText('Çevrimdışısın').waitFor();
      await u.page.locator('[data-nav="post"]').click();
      await sheet(u.page).locator('.offline-note').waitFor();
      await sheet(u.page).locator('textarea[name="text"]').fill('Tünelde biri: "Sinyal yok ama dedikodu bol."');
      await sheet(u.page).getByText('Kadıköy İskelesi').waitFor();
      await sheet(u.page).getByRole('button', { name: /Bırak/ }).click();
      await u.page.locator('.toast', { hasText: 'sözün cihazında bekliyor' }).waitFor();
      await chip.getByText('1 söz gönderilmeyi bekliyor').waitFor();

      // İstasyona gelindi: sinyal var.
      await u.context.setOffline(false);
      await u.page.locator('.toast', { hasText: 'Çevrimdışı yazdığın söz gönderildi' }).waitFor();
      await chip.waitFor({ state: 'hidden' });
      const row = srv.db.prepare("SELECT offline, place_id FROM overheards WHERE text LIKE '%Sinyal yok ama dedikodu%'").get();
      assert.deepEqual({ ...row }, { offline: 1, place_id: 'ist-kadikoy-iskele' });
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
      await u.page.locator('.toast', { hasText: 'buradasın' }).first().waitFor();
      // Işınlanınca aynı balon açık hâliyle yeniden açılır; haritadaki balonlar da açılmıştır.
      await info.locator('.bubble-quote').waitFor();
      // Kadıköy'deki yerel balonlar açıldı (herkese açık balonlar zaten açıktı, onları sayma).
      const localOpen = u.page.locator('.oh-gmarker .oh-bubble.is-open:not(.is-public)').first();
      await localOpen.waitFor();
      // Balonu kapatıp haritadan yeniden aç (bilgi penceresi balonları örtmesin diye önce kapat).
      // Taklit bilgi penceresinin kapatma düğmesi sabit konumda; üstüne binen bildirimler tıklamayı
      // geciktirmesin diye doğrudan tetiklenir.
      await info.getByRole('button', { name: 'Close' }).dispatchEvent('click');
      await localOpen.click();
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
