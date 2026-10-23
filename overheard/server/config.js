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
    // Ters vekil (Caddy, nginx) arkasında X-Forwarded-For'a güven.
    trustProxy: flag(env.OVERHEARD_TRUST_PROXY, false),
    sessionDays: 30,
    // Konum doğruluğu (accuracy) toleransının üst sınırı, metre.
    maxAccuracyBonusM: 75,
    // Konum sahteciliği denetimleri. Demo modunda (ışınlanma serbest) varsayılan olarak kapalı.
    antiSpoofing: flag(env.OVERHEARD_ANTI_SPOOF, !flag(env.OVERHEARD_DEMO, true)),
    // Bundan daha belirsiz konumlar (metre) mekân açmaz.
    maxAccuracyM: 200,
    // Bu hızın (km/sa) üstündeki sıçramalar imkânsız seyahat sayılır (yolcu uçağı ~900).
    maxSpeedKmh: 1000,
    // Kısa sıçramalar (GPS oynaması) hız denetimine girmez.
    minJumpM: 5000,
    // 24 saatte bu kadar şüpheli olaydan sonra check-in'ler 24 saat mekân açmaz.
    flagLimitPerDay: 3,
    // Saatte en fazla bu kadar yeni mekân açılabilir (bot/otomasyon frenleme).
    maxUnlocksPerHour: 30,
    // Son konum bildiriminden bu kadar süre sonra "orada" sayılmaz; yerel sözler yeniden kilitlenir.
    presenceTtlMs: 30 * 60 * 1000,
    // Kesin konum (son konum bildirimi) en fazla bu kadar saklanır; mekân düzeyindeki check-in'ler kalır.
    locationRetentionMs: 24 * 60 * 60 * 1000,
    // "24 saat sonra kaybolsun" seçilen sözlerin ömrü.
    ephemeralMs: 24 * 60 * 60 * 1000,
    // Mekân odası mesajları bu kadar süre sonra silinir.
    roomRetentionMs: 12 * 60 * 60 * 1000,
    // Şüpheli konum kayıtlarının saklama süresi.
    flagRetentionMs: 90 * 24 * 60 * 60 * 1000,
    // Aynı mekâna art arda check-in'ler arasında en az bu kadar süre olmalı.
    checkinCooldownMs: 10 * 60 * 1000,
    // "Aynı anda oradaydınız" rozeti için zaman penceresi.
    sameTimeWindowMs: 2 * 60 * 60 * 1000,
    // Bu kadar şikâyet alan söz otomatik gizlenir.
    reportHideThreshold: 3,
    newPlaceRadiusM: 120,
    // Mekânda tutunma: iyi bir konumla (maxAccuracyM) mekâna giren, içeride GPS zayıflasa da
    // bu kadar süre orada sayılır; yeter ki yeni konumlar "hâlâ orada olabilir" desin: mekân
    // dairesi + stickyMarginM + konum belirsizliği (en fazla stickyMaxAccuracyM). Net biçimde
    // dışarıda gösteren bir konum (ör. 20 m doğrulukla 500 m ötede) mekândan çıkarır.
    stickyPresenceMs: 3 * 60 * 60 * 1000,
    stickyMarginM: 100,
    stickyMaxAccuracyM: 1000,
    // Mekân QR kodu: okutulduğunda kaba konum mekâna bu kadar yakın olmalı (metre)...
    qrMaxDistanceM: 1000,
    // ...ve konum doğruluğu bundan kötü olmamalı (kapalı alanda GPS zayıf; Wi-Fi/baz konumu yeter).
    qrMaxAccuracyM: 3000,
    // QR ile girilen mekânda, konum taze ve mekâna yakın kaldıkça en fazla bu kadar "orada" sayılır.
    qrPresenceMs: 2 * 60 * 60 * 1000,
    // QR imza sırrı; boşsa ilk kullanımda üretilip veritabanında saklanır. Değiştirmek basılı kodları geçersiz kılar.
    qrSecret: env.OVERHEARD_QR_SECRET || '',
    // QR bağlantılarının kökü (ör. https://overheard.example.com); boşsa isteğin adresinden türetilir.
    publicUrl: (env.OVERHEARD_PUBLIC_URL || '').replace(/\/+$/, ''),
    // Hız sınırlarının çarpanı (testlerde büyütülür).
    rateLimitScale: Number(env.OVERHEARD_RATE_SCALE) || 1,
    googleMapsKey: env.GOOGLE_MAPS_API_KEY || '',
    // Bağlamı anlayan içerik denetimi (Claude). ANTHROPIC_API_KEY tanımlıysa varsayılan olarak açık;
    // anahtar SDK tarafından doğrudan ortamdan okunur.
    aiModeration: flag(env.OVERHEARD_AI_MODERATION, Boolean(env.ANTHROPIC_API_KEY)),
    aiModel: env.OVERHEARD_AI_MODEL || 'claude-opus-5-5',
    // Denetim yanıtı bu süreyi aşarsa metin yalnızca kelime listesiyle denetlenip yayımlanır (ms).
    aiTimeoutMs: Number(env.OVERHEARD_AI_TIMEOUT_MS) || 8000,
    // Sunucu taraflı yedek model: bir istek reddedilirse aynı çağrıda önerilen modelde yeniden denenir.
    // Yedeği desteklemeyen bir model seçilirse 0 yapılmalı.
    aiFallbacks: flag(env.OVERHEARD_AI_FALLBACKS, true),
    // Moderasyon paneline erişebilecek kullanıcı adları (virgülle ayrılmış).
    admins: (env.OVERHEARD_ADMINS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    ...overrides,
  };
}
