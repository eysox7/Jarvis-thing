import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Her sürüm bir öncekinin üzerine uygulanır; PRAGMA user_version hangisinde kaldığımızı tutar.
const MIGRATIONS = [
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
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
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
