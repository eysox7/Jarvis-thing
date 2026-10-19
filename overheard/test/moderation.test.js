import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, client, SPOTS } from './helpers.js';
import { maskPersonalData, maskProfanity, containsSlur, normalizeWord } from '../server/moderation.js';

describe('İçerik denetimi (birim)', () => {
  test('kişisel veriler maskelenir', () => {
    assert.equal(maskPersonalData('Ara: 0532 123 45 67').text, 'Ara: [telefon]');
    assert.equal(maskPersonalData('+90 532 123 45 67 numaram').text, '[telefon] numaram');
    assert.equal(maskPersonalData('Call (512) 555-1234').text, 'Call [telefon]');
    assert.equal(maskPersonalData('yaz: ali.veli@example.com').text, 'yaz: [e-posta]');
    assert.equal(maskPersonalData('34 ABC 123 plakalı').text, '[plaka] plakalı');
    assert.equal(maskPersonalData('bak @ayse_k dedi').text, 'bak [kişi] dedi');
    assert.equal(maskPersonalData('https://spam.example/x tıkla').text, '[bağlantı] tıkla');
  });

  test('sıradan sayılar ve kelimeler dokunulmaz', () => {
    for (const s of ['Saat 14:30 da 3 kişi vardı', '2024 yılında 15 kez', 'Galata 1348 yılında', 'I got a pic of it', 'Sınav 21 06 2025']) {
      assert.equal(maskProfanity(maskPersonalData(s).text), s, s);
    }
  });

  test('küfür ilk harfi kalacak şekilde maskelenir, leetspeak ve uzatma dahil', () => {
    assert.equal(maskProfanity('Siktir git dedi'), 'S***** git dedi');
    assert.equal(maskProfanity('what the FUUUCK'), 'what the F*****');
    assert.equal(normalizeWord('S1KT1RRR'), 'siktir');
  });

  test('nefret söylemi algılanır', () => {
    assert.equal(containsSlur('sen bir İBNE'), true);
    assert.equal(containsSlur('what a f4gg0t'), true);
    assert.equal(containsSlur('İbrahim nereye gitti'), false);
  });
});

describe('İçerik denetimi ve moderasyon paneli (API)', () => {
  let srv;
  before(async () => { srv = await startTestServer({ admins: ['moderator'] }); });
  after(async () => { await srv.close(); });

  test('söz paylaşırken maskeleme ve ret', async () => {
    const c = client(srv.base);
    await c.register('maskeli');
    const r = await c.post('/api/overheards', { text: 'Biri telefonda 0532 123 45 67 diye bağırdı, siktir dedi.', ...SPOTS.modaSahil });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.overheard.text, 'Biri telefonda [telefon] diye bağırdı, s***** dedi.');
    assert.deepEqual(r.data.overheard.masked, ['phone']);
    const blocked = await c.post('/api/overheards', { text: 'Adam ona ibne dedi', ...SPOTS.modaSahil });
    assert.equal(blocked.status, 422);
    assert.equal(blocked.data.error, 'content_blocked');
  });

  test('mesajlarda iletişim bilgisi serbest, nefret söylemi değil', async () => {
    const a = client(srv.base);
    const b = client(srv.base);
    await a.register('mesaj_a');
    await b.register('mesaj_b');
    const { id } = (await a.post('/api/overheards', { text: 'Vapur yine dolu.', ...SPOTS.kadikoyIskele })).data.overheard;
    await b.post('/api/checkins', SPOTS.kadikoyIskele);
    const ok = await b.post(`/api/overheards/${id}/messages`, { body: 'Numaram 0532 123 45 67, yazarsan kahve içelim.' });
    assert.equal(ok.status, 200);
    assert.equal((await b.post(`/api/overheards/${id}/messages`, { body: 'sen ibne misin' })).data.error, 'content_blocked');
  });

  test('moderatör şikâyetleri görür, geri yükler, siler, yasaklar', async () => {
    const mod = client(srv.base);
    const author = client(srv.base);
    const user = client(srv.base);
    await mod.register('moderator');
    await author.register('sorunlu');
    await user.register('normal_kullanici');

    assert.equal((await user.get('/api/admin/reports')).status, 403);
    assert.equal((await mod.get('/api/me')).data.user.isAdmin, true);
    assert.equal((await user.get('/api/me')).data.user.isAdmin, false);

    const { id } = (await author.post('/api/overheards', { text: 'Şikâyet edilecek bir söz.', ...SPOTS.modaSahil })).data.overheard;
    for (let i = 0; i < srv.config.reportHideThreshold; i++) {
      const r = client(srv.base);
      await r.register(`raporcu_${i}`);
      await r.post('/api/checkins', SPOTS.modaSahil);
      await r.post(`/api/overheards/${id}/report`, { reason: 'spam' });
    }
    let list = (await mod.get('/api/admin/reports')).data.overheards;
    const item = list.find((o) => o.id === id);
    assert.equal(item.hidden, true);
    assert.equal(item.reports, srv.config.reportHideThreshold);
    assert.deepEqual(item.reasons, ['spam']);

    assert.equal((await mod.post(`/api/admin/overheards/${id}/restore`)).status, 200);
    await user.post('/api/checkins', SPOTS.modaSahil);
    assert.equal((await user.get(`/api/overheards/${id}`)).status, 200, 'geri yüklenen söz görünür');
    list = (await mod.get('/api/admin/reports')).data.overheards;
    assert.ok(!list.some((o) => o.id === id), 'şikâyetler temizlenir');

    // Yasak: okuyabilir ama yazamaz.
    assert.equal((await mod.post('/api/admin/users/sorunlu/ban', { banned: true })).status, 200);
    assert.equal((await author.get('/api/me')).data.user.banned, true);
    assert.equal((await author.post('/api/overheards', { text: 'Yasaklıyken deneme.', ...SPOTS.modaSahil })).data.error, 'banned');
    assert.equal((await author.get('/api/cities/istanbul/map')).status, 200);
    await mod.post('/api/admin/users/sorunlu/ban', { banned: false });
    assert.equal((await author.post('/api/overheards', { text: 'Yasak kalktı.', ...SPOTS.modaSahil })).status, 200);
    assert.equal((await mod.post('/api/admin/users/moderator/ban', {})).data.error, 'cannot_ban_self');

    assert.equal((await mod.del(`/api/admin/overheards/${id}`)).status, 200);
    assert.equal((await user.get(`/api/overheards/${id}`)).status, 404);
  });
});
