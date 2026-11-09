// Merkezi veritabanı (Turso) bağlantısını denetler: npm run db:check
// OVERHEARD_DB_URL ve OVERHEARD_DB_TOKEN tanımlı olmalı. Kopyayı merkezle eşitler, şemayı günceller,
// birkaç sayı yazar ve merkeze bir yazma gönderip ne kadar sürdüğünü ölçer.
import { loadConfig } from '../server/config.js';
import { dbInfo, openDb, transaction } from '../server/db.js';

const config = loadConfig();
if (!config.dbUrl) {
  console.log(`OVERHEARD_DB_URL tanımlı değil: veri yalnızca bu makinede (${config.dbPath}).`);
  process.exit(1);
}
if (!config.dbToken) console.warn('Uyarı: OVERHEARD_DB_TOKEN tanımlı değil; Turso anahtarsız bağlantıyı kabul etmez.');

const ms = (since) => `${Math.round(performance.now() - since)} ms`;
let started = performance.now();
const db = openDb(config.dbPath, config);
console.log(`Merkez: ${new URL(config.dbUrl).host} (${dbInfo(db).driver})`);
console.log(`Kopya: ${config.dbPath} (açılış, eşitleme ve şema: ${ms(started)})`);
const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
console.log(`Şema sürümü: ${db.prepare('SELECT version FROM _schema_version WHERE id = 1').get().version}`);
console.log(`Kullanıcı: ${count('users')} · söz: ${count('overheards')} · mekân: ${count('places')}`);

// Değeri değiştirmeyen bir yazma: merkeze gider, işlem içinde onaylanır, kopyaya geri yansır.
started = performance.now();
transaction(db, () => db.prepare('UPDATE _schema_version SET version = version WHERE id = 1').run());
console.log(`Merkeze yazma: ${ms(started)}`);
started = performance.now();
db.sync();
console.log(`Eşitleme: ${ms(started)}`);
db.close();
console.log('Tamam: sunucu bu ayarlarla merkezi veritabanını kullanır.');
