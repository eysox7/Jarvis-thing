import { fileURLToPath } from 'node:url';

const env = process.env;
const flag = (value, fallback) => (value === undefined ? fallback : value === '1' || value === 'true');

export function loadConfig(overrides = {}) {
  return {
    port: Number(env.PORT) || 8787,
    host: env.HOST || '0.0.0.0',
    dbPath: env.OVERHEARD_DB || fileURLToPath(new URL('../data/overheard.db', import.meta.url)),
    publicDir: fileURLToPath(new URL('../public', import.meta.url)),
    // Demo modu: misafir hesabı, konum simülasyonu ve örnek sözler.
    demoMode: flag(env.OVERHEARD_DEMO, true),
    secureCookies: flag(env.OVERHEARD_SECURE_COOKIES, false),
    sessionDays: 30,
    // Konum doğruluğu (accuracy) toleransının üst sınırı, metre.
    maxAccuracyBonusM: 75,
    // Aynı mekâna art arda check-in'ler arasında en az bu kadar süre olmalı.
    checkinCooldownMs: 10 * 60 * 1000,
    // "Aynı anda oradaydınız" rozeti için zaman penceresi.
    sameTimeWindowMs: 2 * 60 * 60 * 1000,
    // Bu kadar şikâyet alan söz otomatik gizlenir.
    reportHideThreshold: 3,
    newPlaceRadiusM: 120,
    // Hız sınırlarının çarpanı (testlerde büyütülür).
    rateLimitScale: Number(env.OVERHEARD_RATE_SCALE) || 1,
    googleMapsKey: env.GOOGLE_MAPS_API_KEY || '',
    ...overrides,
  };
}
