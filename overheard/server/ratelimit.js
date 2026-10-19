// Bellek içi kayan pencere sınırlayıcı. Tek süreçlik kurulum için yeterli;
// yatay ölçeklemede Redis gibi paylaşılan bir depoya taşınmalı.
export function createRateLimiter() {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.last > entry.windowMs) hits.delete(key);
    }
  }, 60 * 1000);
  sweep.unref();

  return function allow(key, limit, windowMs) {
    const now = Date.now();
    const entry = hits.get(key) || { times: [], last: now, windowMs };
    entry.times = entry.times.filter((t) => now - t < windowMs);
    entry.last = now;
    entry.windowMs = windowMs;
    hits.set(key, entry);
    if (entry.times.length >= limit) return false;
    entry.times.push(now);
    return true;
  };
}
