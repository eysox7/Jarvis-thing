import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

// Her sürüm bir öncekinin üzerine uygulanır; _schema_version tablosu hangisinde kaldığımızı tutar
// (eskiden PRAGMA user_version; Turso'da o salt okunur).
export const MIGRATIONS = [
  `
  CREATE TABLE users (
    id          INTEGER PRIMARY KEY,
    handle      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash   TEXT NOT NULL,
    is_guest    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE places (
    id          TEXT PRIMARY KEY,
    city_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'spot',
    lat         REAL NOT NULL,
    lng         REAL NOT NULL,
    radius_m    INTEGER NOT NULL,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX places_city ON places(city_id);
  CREATE INDEX places_geo ON places(lat, lng);

  -- Kullanıcının bir mekânda bulunduğu her an. "Ortak mekân" buradan türetilir.
  CREATE TABLE checkins (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    place_id    TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    at          INTEGER NOT NULL
  );
  CREATE INDEX checkins_user_place ON checkins(user_id, place_id, at);
  CREATE INDEX checkins_place ON checkins(place_id, at);

  CREATE TABLE overheards (
    id           TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    place_id     TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    text         TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    hidden       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX overheards_place ON overheards(place_id, created_at);
  CREATE INDEX overheards_user ON overheards(user_id);

  CREATE TABLE reactions (
    overheard_id TEXT NOT NULL REFERENCES overheards(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (overheard_id, user_id, kind)
  );

  CREATE TABLE reports (
    overheard_id TEXT NOT NULL REFERENCES overheards(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason       TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (overheard_id, user_id)
  );

  -- Bir söz üzerinden açılan, iki kişilik konuşma: sözün sahibi ve ona yazan kişi.
  CREATE TABLE conversations (
    id            TEXT PRIMARY KEY,
    overheard_id  TEXT NOT NULL REFERENCES overheards(id) ON DELETE CASCADE,
    owner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    starter_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    INTEGER NOT NULL,
    last_at       INTEGER NOT NULL,
    owner_read_at   INTEGER NOT NULL DEFAULT 0,
    starter_read_at INTEGER NOT NULL DEFAULT 0,
    UNIQUE (overheard_id, starter_id)
  );
  CREATE INDEX conversations_owner ON conversations(owner_id, last_at);
  CREATE INDEX conversations_starter ON conversations(starter_id, last_at);

  CREATE TABLE messages (
    id               INTEGER PRIMARY KEY,
    conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body             TEXT NOT NULL,
    created_at       INTEGER NOT NULL
  );
  CREATE INDEX messages_conversation ON messages(conversation_id, id);

  CREATE TABLE blocks (
    blocker_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  );
  `,
  // v2: Konuşmalar artık yalnızca söz sahibiyle değil, aynı sözün tanıkları arasında da açılabilir.
  // owner_id = yazılan kişi (söz sahibi ya da tanık), kind = 'author' | 'witness'.
  `
  CREATE TABLE conversations_v2 (
    id            TEXT PRIMARY KEY,
    overheard_id  TEXT NOT NULL REFERENCES overheards(id) ON DELETE CASCADE,
    owner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    starter_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL DEFAULT 'author',
    created_at    INTEGER NOT NULL,
    last_at       INTEGER NOT NULL,
    owner_read_at   INTEGER NOT NULL DEFAULT 0,
    starter_read_at INTEGER NOT NULL DEFAULT 0,
    UNIQUE (overheard_id, owner_id, starter_id)
  );
  INSERT INTO conversations_v2 (id, overheard_id, owner_id, starter_id, created_at, last_at, owner_read_at, starter_read_at)
    SELECT id, overheard_id, owner_id, starter_id, created_at, last_at, owner_read_at, starter_read_at FROM conversations;
  DROP TABLE conversations;
  ALTER TABLE conversations_v2 RENAME TO conversations;
  CREATE INDEX conversations_owner ON conversations(owner_id, last_at);
  CREATE INDEX conversations_starter ON conversations(starter_id, last_at);
  `,
  // v3: Anonim paylaşım. Anonim sözün sahibi, bir konuşmada kimliğini isterse açar.
  `
  ALTER TABLE overheards ADD COLUMN anonymous INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE conversations ADD COLUMN author_revealed INTEGER NOT NULL DEFAULT 0;
  `,
  // v4: Moderasyon: yasaklanan kullanıcılar yazamaz.
  `
  ALTER TABLE users ADD COLUMN banned_at INTEGER;
  `,
  // v5: Konum sahteciliğine karşı: son güvenilir konum ve şüpheli olay kayıtları.
  `
  CREATE TABLE location_reports (
    user_id  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    lat      REAL NOT NULL,
    lng      REAL NOT NULL,
    at       INTEGER NOT NULL
  );
  CREATE TABLE location_flags (
    id       INTEGER PRIMARY KEY,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason   TEXT NOT NULL,
    detail   TEXT,
    at       INTEGER NOT NULL
  );
  CREATE INDEX location_flags_user ON location_flags(user_id, at);
  `,
  // v6: Görünürlük. 'local' sözler yalnızca o mekândayken, 'public' sözler her yerden okunur.
  // "Şu an orada" bilgisi son bildirilen konumdan türetilir; konum doğruluğu da saklanır.
  `
  ALTER TABLE overheards ADD COLUMN visibility TEXT NOT NULL DEFAULT 'local';
  ALTER TABLE location_reports ADD COLUMN accuracy REAL NOT NULL DEFAULT 0;
  `,
  // v7: Kullanım koşulları ve gizlilik onayının zamanı (KVKK/GDPR kaydı).
  `
  ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER;
  `,
  // v8: Mekân odası: o an aynı mekânda bulunanların geçici grup sohbeti.
  `
  CREATE TABLE room_messages (
    id          INTEGER PRIMARY KEY,
    place_id    TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX room_messages_place ON room_messages(place_id, id);
  `,
  // v9: İsteğe bağlı 24 saatlik sözler.
  `
  ALTER TABLE overheards ADD COLUMN expires_at INTEGER;
  `,
  // v10: Mekân QR kodu. Sunucu sırrı (QR imzası) veritabanında kalıcıdır; kullanıcının son QR
  // okuttuğu mekân, kapalı alanda zayıf GPS'e rağmen "orada" sayılmasını sağlar.
  `
  CREATE TABLE app_secrets (
    name   TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
  CREATE TABLE qr_presence (
    user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    place_id  TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    at        INTEGER NOT NULL
  );
  `,
  // v11: Mekânda tutunma. Kapalı alanda GPS zayıflayınca da orada sayılmak için, mekâna giriş
  // kanıtı (iyi bir GPS konumu ya da QR) mekân başına saklanır. QR kayıtları buraya taşınır.
  `
  CREATE TABLE presence_anchors (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    place_id  TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    source    TEXT NOT NULL,
    at        INTEGER NOT NULL,
    PRIMARY KEY (user_id, place_id)
  );
  INSERT INTO presence_anchors (user_id, place_id, source, at) SELECT user_id, place_id, 'qr', at FROM qr_presence;
  DROP TABLE qr_presence;
  `,
  // v12: Overheard Kafe: personel, sözü isteyen masalar ve kafenin yazıcısına giden fişler.
  `
  CREATE TABLE venues (
    place_id    TEXT PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
    mode        TEXT NOT NULL DEFAULT 'inside',
    nearby_m    INTEGER NOT NULL DEFAULT 1500,
    every_min   INTEGER NOT NULL DEFAULT 15,
    per_table   INTEGER NOT NULL DEFAULT 4,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE venue_staff (
    place_id  TEXT NOT NULL REFERENCES venues(place_id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (place_id, user_id)
  );
  CREATE TABLE venue_tables (
    id         INTEGER PRIMARY KEY,
    place_id   TEXT NOT NULL REFERENCES venues(place_id) ON DELETE CASCADE,
    table_no   TEXT NOT NULL,
    opened_at  INTEGER NOT NULL,
    closed_at  INTEGER
  );
  CREATE INDEX venue_tables_open ON venue_tables(place_id, closed_at);
  CREATE TABLE print_jobs (
    id            INTEGER PRIMARY KEY,
    table_id      INTEGER NOT NULL REFERENCES venue_tables(id) ON DELETE CASCADE,
    place_id      TEXT NOT NULL REFERENCES venues(place_id) ON DELETE CASCADE,
    overheard_id  TEXT NOT NULL REFERENCES overheards(id) ON DELETE CASCADE,
    created_at    INTEGER NOT NULL,
    printed_at    INTEGER
  );
  CREATE INDEX print_jobs_place ON print_jobs(place_id, printed_at);
  CREATE INDEX print_jobs_table ON print_jobs(table_id);
  `,
  // v13: Toplu taşıma hatları (metro, Marmaray, tramvay, metrobüs) mekân olarak: duraklar sırayla
  // saklanır. Mekânın kökeni (ör. 'osm') ve hat rengi. Kafe başına kafe içi söz bekleme süresi.
  `
  CREATE TABLE line_stops (
    place_id  TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    seq       INTEGER NOT NULL,
    name      TEXT,
    lat       REAL NOT NULL,
    lng       REAL NOT NULL,
    PRIMARY KEY (place_id, seq)
  );
  CREATE INDEX line_stops_geo ON line_stops(lat, lng);
  ALTER TABLE places ADD COLUMN color TEXT;
  ALTER TABLE places ADD COLUMN origin TEXT;
  ALTER TABLE venues ADD COLUMN inside_delay_min INTEGER NOT NULL DEFAULT 20;
  `,
  // v14: Çevrimdışı ve kulaktan kulağa (eşten eşe) sözler. client_id cihazın verdiği kimliktir: aynı
  // söz iki kez gelirse bir kez kaydedilir. Kulaktan kulağa taşınan sözü sunucuya ulaştıran kişi
  // relayed_by'dır. Cihaz anahtarları, çevrimdışı imzalanan sözlerin yazarını kanıtlar.
  `
  ALTER TABLE overheards ADD COLUMN client_id TEXT;
  ALTER TABLE overheards ADD COLUMN offline INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE overheards ADD COLUMN relayed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
  CREATE UNIQUE INDEX overheards_client ON overheards(user_id, client_id) WHERE client_id IS NOT NULL;
  CREATE TABLE device_keys (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_jwk  TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX device_keys_user ON device_keys(user_id);
  `,
  // v15: Kulaktan kulağa sözün sunucuya varana dek kaç telefondan geçtiği (yazarın kendisi gönderdiyse
  // 0). Yalnızca çevrimdışı sözlerde dolu; internetsiz yazılmış sözler ileride oyunlaştırılacak.
  `
  ALTER TABLE overheards ADD COLUMN hops INTEGER;
  `,
  // v16: Google ile giriş. Yalnızca Google hesap kimliği (sub) tutulur. password_login: hesabın
  // bilinen bir parolası var mı (Google ile açılan ya da Google'a bağlanan misafir hesabında yok).
  `
  CREATE TABLE user_identities (
    provider    TEXT NOT NULL,
    subject     TEXT NOT NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (provider, subject)
  );
  CREATE INDEX user_identities_user ON user_identities(user_id);
  ALTER TABLE users ADD COLUMN password_login INTEGER NOT NULL DEFAULT 1;
  `,
];

// Veritabanı ya bu makinedeki tek bir dosyadır (node:sqlite) ya da Turso'daki merkezi veritabanı.
// Turso'da sunucunun yanında gömülü bir kopya (embedded replica) durur: okumalar kopyadan yapılır,
// yazmalar merkeze gider ve hemen kopyaya da yansır; başka sunucuların yazdıkları birkaç saniyede bir
// eşitlenir. Böylece Codespaces'te, bilgisayarında ya da başka bir yerde açılan sunucular aynı veriyi
// görür. Turso sürücüsü (libsql) isteğe bağlı pakettir; yalnızca seçilince yüklenir.
const info = new WeakMap();

export function openDb(path, { dbDriver = 'sqlite', dbUrl = '', dbToken = '', dbSyncSeconds = 5 } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const central = Boolean(dbUrl);
  let db;
  if (dbDriver === 'libsql' || central) {
    const Database = loadLibsql();
    try {
      db = central ? new Database(path, { syncUrl: dbUrl, authToken: dbToken, syncPeriod: dbSyncSeconds }) : new Database(path);
      // Açılışta merkezdeki son hâl alınır (göçler ve tohum verisi ona göre karar verir).
      if (central) db.sync();
    } catch (err) {
      if (!central) throw err;
      throw new Error(`Merkezi veritabanına bağlanılamadı (${new URL(dbUrl).host}): ${err.message}`, { cause: err });
    }
  } else {
    db = new DatabaseSync(path);
  }
  info.set(db, { driver: central ? 'libsql' : dbDriver, central, depth: 0 });
  pragma(db, 'foreign_keys = ON');
  if (path !== ':memory:' && !central) db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

// { driver: 'sqlite' | 'libsql', central: Turso'ya bağlı mı }
export const dbInfo = (db) => {
  const { driver, central } = info.get(db) ?? { driver: 'sqlite', central: false };
  return { driver, central };
};

function loadLibsql() {
  try {
    return createRequire(import.meta.url)('libsql');
  } catch (err) {
    throw new Error(`Turso sürücüsü (libsql) yüklenemedi: npm install libsql (${err.message})`);
  }
}

// Turso'da bazı PRAGMA'lar desteklenmez ya da merkeze iletilmez; yerel dosyada her zaman çalışır.
function pragma(db, statement) {
  try {
    db.exec(`PRAGMA ${statement};`);
  } catch (err) {
    if (!info.get(db)?.central) throw err;
  }
}

function migrate(db) {
  // Tek satırlık sürüm tablosu; ilk kez kurulurken eski PRAGMA user_version değeri taşınır.
  db.exec('CREATE TABLE IF NOT EXISTS _schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)');
  const legacy = db.prepare('PRAGMA user_version').get().user_version;
  db.prepare('INSERT OR IGNORE INTO _schema_version (id, version) VALUES (1, ?)').run(legacy);
  const version = () => db.prepare('SELECT version FROM _schema_version WHERE id = 1').get().version;
  if (version() >= MIGRATIONS.length) return;
  // Tablo yeniden kurulurken DROP TABLE'ın bağlı satırları silmemesi için yabancı anahtarlar
  // geçici olarak kapatılır (bu PRAGMA işlem içinde değiştirilemez), sonunda bütünlük denetlenir.
  pragma(db, 'foreign_keys = OFF');
  try {
    for (let v = version(); v < MIGRATIONS.length; v++) {
      const applied = transaction(db, () => {
        // Aynı merkeze bağlı başka bir sunucu bu sürümü az önce uyguladıysa atlanır.
        if (!db.prepare('UPDATE _schema_version SET version = ? WHERE id = 1 AND version = ?').run(v + 1, v).changes) return false;
        db.exec(MIGRATIONS[v]);
        return true;
      });
      if (!applied) v = version() - 1;
    }
    const broken = db.prepare('PRAGMA foreign_key_check').all();
    if (broken.length) throw new Error(`foreign key check failed: ${JSON.stringify(broken.slice(0, 3))}`);
  } finally {
    pragma(db, 'foreign_keys = ON');
  }
}

// İç içe çağrılabilir: dıştaki işlem hepsini kapsar.
export function transaction(db, fn) {
  const state = info.get(db) ?? { depth: 0 };
  if (state.depth > 0) return fn();
  db.exec('BEGIN');
  state.depth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    state.depth--;
  }
}

// Benzersizlik ihlali (UNIQUE / PRIMARY KEY); iki sürücü de SQLite'ın genişletilmiş hata kodunu verir.
// Merkeze iletilen yazmalarda kod gelmeyebilir; o zaman SQLite'ın iletisine bakılır.
export function isUniqueViolation(err) {
  const code = err?.errcode ?? err?.rawCode;
  return code === 2067 || code === 1555 || /UNIQUE constraint failed/.test(err?.message ?? '');
}

// Bir satırı ona bağlı her şeyle birlikte siler; yabancı anahtar denetimine güvenmez. Turso'da
// yabancı anahtar denetimi bağlantı başına açılır ve gömülü kopyanın merkeze ilettiği yazmalarda
// açık olduğu garanti değil; hesap silindiğinde verisinin gerçekten gitmesi (KVKK/GDPR) buna
// bırakılamaz. Şemadaki ON DELETE CASCADE / SET NULL tanımları okunur, en alttaki satırlar önce
// silinir. [where] yalnızca sabit SQL'dir; değerler [params] ile bağlanır. Silinen satır sayısı döner.
//
// Yerel dosyada hepsi tek işlemdir. Merkezde her yazma bir gidiş-dönüştür ve Turso açık bir yazma
// işlemini birkaç saniyede keser; bu yüzden işlem açılmaz, satırı olmayan tablolar (yerel kopyadan
// okunarak) atlanır. Yarıda kesilirse üstteki satır (ör. hesap) en son silindiği için yeniden
// denemek işi tamamlar.
export function cascadeDelete(db, table, where, params = [], depth = 0) {
  if (depth > 10) throw new Error(`cascade too deep at ${table}`);
  const run = () => {
    if (!db.prepare(`SELECT EXISTS (SELECT 1 FROM "${table}" WHERE ${where}) AS found`).get(...params).found) return 0;
    for (const fk of foreignKeys(db).get(table) ?? []) {
      const match = `"${fk.from}" IN (SELECT "${fk.to}" FROM "${table}" WHERE ${where})`;
      if (fk.onDelete === 'CASCADE') cascadeDelete(db, fk.table, match, params, depth + 1);
      else if (fk.onDelete === 'SET NULL') db.prepare(`UPDATE "${fk.table}" SET "${fk.from}" = NULL WHERE ${match}`).run(...params);
    }
    return Number(db.prepare(`DELETE FROM "${table}" WHERE ${where}`).run(...params).changes);
  };
  return info.get(db)?.central ? run() : transaction(db, run);
}

// Üst tablo → ona bağlı (tablo, sütun, hedef sütun, silinince ne olur) listesi; şemadan bir kez okunur.
const fkGraphs = new WeakMap();
function foreignKeys(db) {
  let graph = fkGraphs.get(db);
  if (graph) return graph;
  graph = new Map();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  for (const { name } of tables) {
    for (const fk of db.prepare('SELECT * FROM pragma_foreign_key_list(?)').all(name)) {
      const to = fk.to ?? db.prepare('SELECT name FROM pragma_table_info(?) WHERE pk = 1').get(fk.table).name;
      if (!graph.has(fk.table)) graph.set(fk.table, []);
      graph.get(fk.table).push({ table: name, from: fk.from, to, onDelete: fk.on_delete });
    }
  }
  fkGraphs.set(db, graph);
  return graph;
}
