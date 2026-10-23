import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startTestServer, client } from './helpers.js';
import { importLines, parseLines } from '../server/osm.js';

// Sentetik bir hat: T9, dört durak, doğu-batı (durak arası ~840 m).
const LINE = 'istanbul-line-subway-t9';
const STOP_B = { lat: 40.97, lng: 29.25 };
const STOP_C = { lat: 40.97, lng: 29.26 };

describe('Toplu taşıma hatları', () => {
  let srv;
  let overheardId;
  before(async () => {
    srv = await startTestServer({ antiSpoofing: true, admins: ['hat_mod'] });
    const json = JSON.parse(await readFile(new URL('./fixtures/overpass-lines.json', import.meta.url), 'utf8'));
    importLines(srv.db, parseLines(json, { cityId: 'istanbul' }));
    const author = client(srv.base);
    await author.register('hat_yazar');
    const boarded = await author.post('/api/checkins', { ...STOP_C, accuracy: 15 });
    assert.ok(boarded.data.places.some((p) => p.id === LINE && p.line));
    const r = await author.post('/api/overheards', { text: 'Vagonda biri: "Bu metro da benim kadar yorgun."', ...STOP_C, accuracy: 15, placeId: LINE });
    assert.equal(r.status, 200);
    overheardId = r.data.overheard.id;
  });
  after(async () => { await srv.close(); });

  const newUser = async (prefix) => {
    const c = client(srv.base);
    await c.register(`${prefix}_${Math.random().toString(36).slice(2, 7)}`);
    return c;
  };
  const locked = async (c) => (await c.get(`/api/overheards/${overheardId}`)).data.overheard.locked;

  test('hat sözü güzergâh üzerinde durur; haritada hat duraklarıyla gelir', async () => {
    const c = await newUser('bakan');
    const o = (await c.get(`/api/overheards/${overheardId}`)).data.overheard;
    assert.equal(o.locked, true);
    assert.equal(o.onLine, true);
    assert.ok(Math.abs(o.lat - 40.97) < 0.0001);
    assert.ok(o.lng >= 29.24 && o.lng <= 29.27);
    const line = (await c.get('/api/cities/istanbul/map')).data.places.find((p) => p.id === LINE);
    assert.equal(line.line, true);
    assert.equal(line.color, '#ef3e42');
    assert.equal(line.stops.length, 4);
    assert.equal(line.count, 1);
  });

  test('durakta biniş; tünelde belirsiz konumla ve duraklar arasında hatta kalınır', async () => {
    const c = await newUser('yolcu');
    const board = await c.post('/api/checkins', { ...STOP_B, accuracy: 15 });
    const line = board.data.places.find((p) => p.id === LINE);
    assert.equal(line.arrived, true);
    assert.equal(line.line, true);
    assert.equal(await locked(c), false);

    // Tünel: konum 450 m sapmış ve 900 m belirsiz.
    const tunnel = await c.post('/api/checkins', { lat: 40.974, lng: 29.255, accuracy: 900 });
    assert.equal(tunnel.data.blocked, undefined);
    assert.deepEqual(tunnel.data.left, []);
    assert.equal(tunnel.data.places.find((p) => p.id === LINE)?.held, true);
    // İki durak arasında, güzergâhın üstünde.
    assert.deepEqual((await c.post('/api/checkins', { lat: 40.9701, lng: 29.265, accuracy: 20 })).data.left, []);
    assert.equal(await locked(c), false);
    // Hat odası ve kişi sayısı.
    assert.equal((await c.get(`/api/places/${LINE}/room`)).status, 200);
    const map = await c.get('/api/cities/istanbul/map');
    assert.ok(map.data.places.find((p) => p.id === LINE).peopleHere >= 1);

    // İnip uzaklaştı.
    const off = await c.post('/api/checkins', { lat: 40.9835, lng: 29.265, accuracy: 20 });
    assert.deepEqual(off.data.left, [LINE]);
    assert.equal(await locked(c), true);
  });

  test('güzergâhın yakınında oturan ama binmeyen hatta sayılmaz', async () => {
    const c = await newUser('komsu');
    const r = await c.post('/api/checkins', { lat: 40.9727, lng: 29.255, accuracy: 15 });
    assert.ok(!r.data.places.some((p) => p.id === LINE));
    assert.equal(await locked(c), true);
  });

  test('istasyonun yanında yeni mekân açılabilir; hat kafe yapılamaz', async () => {
    const c = await newUser('simitci');
    const r = await c.post('/api/overheards', { text: 'Simitçi "son vagon boş" dedi', lat: 40.9701, lng: 29.2401, accuracy: 15, newPlaceName: 'İstasyon Önü Simitçi' });
    assert.equal(r.status, 200);
    assert.notEqual(r.data.overheard.placeId, LINE);

    const mod = client(srv.base);
    await mod.register('hat_mod');
    assert.equal((await mod.post(`/api/admin/venues/${LINE}`, {})).data.error, 'line_not_venue');
  });
});
