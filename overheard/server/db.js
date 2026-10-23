import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Her sürüm bir öncekinin üzerine uygulanır; PRAGMA user_version hangisinde kaldığımızı tutar.
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
];

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

function migrate(db) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  if (current >= MIGRATIONS.length) return;
  // Tablo yeniden kurulurken DROP TABLE'ın bağlı satırları silmemesi için yabancı anahtarlar
  // geçici olarak kapatılır (bu PRAGMA işlem içinde değiştirilemez), sonunda bütünlük denetlenir.
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    for (let v = current; v < MIGRATIONS.length; v++) {
      transaction(db, () => {
        db.exec(MIGRATIONS[v]);
        db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
    const broken = db.prepare('PRAGMA foreign_key_check').all();
    if (broken.length) throw new Error(`foreign key check failed: ${JSON.stringify(broken.slice(0, 3))}`);
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
