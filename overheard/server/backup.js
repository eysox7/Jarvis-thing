// Çalışan veritabanının tutarlı bir kopyasını alır: node server/backup.js [hedef-klasör]
// SQLite'ın VACUUM INTO komutu, yazmalar sürerken bile tek dosyalık temiz bir yedek üretir.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from './config.js';

const config = loadConfig();
const dir = resolve(process.argv[2] || join(config.dbPath, '..', 'backups'));
mkdirSync(dir, { recursive: true });
const target = join(dir, `overheard-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);

const db = new DatabaseSync(config.dbPath, { readOnly: true });
db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
db.close();
console.log(target);
