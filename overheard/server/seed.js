import { randomBytes } from 'node:crypto';
import { transaction } from './db.js';
import { hashPassword, newId } from './auth.js';
import { SEED_PLACES } from './data/places.js';
import { DEMO_USERS, SAMPLE_OVERHEARDS } from './data/samples.js';

export function seedPlaces(db) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO places (id, city_id, name, kind, lat, lng, radius_m, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const now = Date.now();
  transaction(db, () => {
    for (const p of SEED_PLACES) insert.run(p.id, p.city, p.name, p.kind, p.lat, p.lng, p.r, now);
  });
}

// Demo kullanıcıları ve örnek sözler. Yalnızca hiç söz yokken yüklenir.
export async function seedDemoContent(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM overheards').get();
  if (n > 0) return;

  const placeCity = new Map(SEED_PLACES.map((p) => [p.id, p.city]));
  // Demo hesaplarına kimse giriş yapamasın diye parolalar rastgele ve bilinmez.
  const hashes = await Promise.all(DEMO_USERS.map(() => hashPassword(randomBytes(24).toString('hex'))));

  const now = Date.now();
  transaction(db, () => {
    const userIds = new Map();
    const insertUser = db.prepare('INSERT OR IGNORE INTO users (handle, pass_hash, created_at) VALUES (?, ?, ?)');
    const findUser = db.prepare('SELECT id FROM users WHERE handle = ?');
    DEMO_USERS.forEach((u, i) => {
      insertUser.run(u.handle, hashes[i], now - 30 * 86400000);
      userIds.set(u.handle, findUser.get(u.handle).id);
    });

    const insertOverheard = db.prepare('INSERT INTO overheards (id, user_id, place_id, text, created_at) VALUES (?, ?, ?, ?, ?)');
    const insertCheckin = db.prepare('INSERT INTO checkins (user_id, place_id, at) VALUES (?, ?, ?)');
    SAMPLE_OVERHEARDS.forEach(([placeId, text], i) => {
      const city = placeCity.get(placeId);
      const authors = DEMO_USERS.filter((u) => u.city === city);
      const author = authors[i % authors.length];
      const userId = userIds.get(author.handle);
      // Son üç güne yayılmış zamanlar.
      const at = now - ((i * 7919) % (72 * 60)) * 60000 - 5 * 60000;
      insertCheckin.run(userId, placeId, at);
      insertOverheard.run(newId(), userId, placeId, text, at);
    });
  });
}
