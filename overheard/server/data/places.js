// Başlangıç mekânları. Koordinatlar yaklaşık; yarıçap, "orada sayılma" alanıdır (metre).
export const SEED_PLACES = [
  // İstanbul
  { id: 'ist-kadikoy-iskele', city: 'istanbul', name: 'Kadıköy İskelesi', kind: 'pier', lat: 40.9925, lng: 29.0236, r: 150 },
  { id: 'ist-moda-sahil', city: 'istanbul', name: 'Moda Sahili', kind: 'park', lat: 40.981, lng: 29.027, r: 220 },
  { id: 'ist-bahariye', city: 'istanbul', name: 'Bahariye Caddesi', kind: 'street', lat: 40.9878, lng: 29.0288, r: 180 },
  { id: 'ist-istiklal', city: 'istanbul', name: 'İstiklal Caddesi', kind: 'street', lat: 41.0335, lng: 28.977, r: 300 },
  { id: 'ist-galata', city: 'istanbul', name: 'Galata Kulesi', kind: 'landmark', lat: 41.0256, lng: 28.9741, r: 140 },
  { id: 'ist-karakoy', city: 'istanbul', name: 'Karaköy', kind: 'neighborhood', lat: 41.0225, lng: 28.977, r: 200 },
  { id: 'ist-cihangir', city: 'istanbul', name: 'Cihangir', kind: 'neighborhood', lat: 41.0315, lng: 28.983, r: 200 },
  { id: 'ist-besiktas-carsi', city: 'istanbul', name: 'Beşiktaş Çarşı', kind: 'market', lat: 41.043, lng: 29.006, r: 200 },
  { id: 'ist-nisantasi', city: 'istanbul', name: 'Nişantaşı', kind: 'neighborhood', lat: 41.052, lng: 28.994, r: 220 },
  { id: 'ist-bogazici', city: 'istanbul', name: 'Boğaziçi Üniversitesi', kind: 'campus', lat: 41.084, lng: 29.051, r: 300 },
  { id: 'ist-bebek', city: 'istanbul', name: 'Bebek Sahili', kind: 'park', lat: 41.077, lng: 29.0435, r: 200 },
  { id: 'ist-uskudar', city: 'istanbul', name: 'Üsküdar Sahili', kind: 'pier', lat: 41.026, lng: 29.015, r: 200 },

  // Ankara
  { id: 'ank-kizilay', city: 'ankara', name: 'Kızılay Meydanı', kind: 'square', lat: 39.9208, lng: 32.8541, r: 200 },
  { id: 'ank-tunali', city: 'ankara', name: 'Tunalı Hilmi Caddesi', kind: 'street', lat: 39.904, lng: 32.86, r: 250 },
  { id: 'ank-kugulu', city: 'ankara', name: 'Kuğulu Park', kind: 'park', lat: 39.9017, lng: 32.8607, r: 120 },
  { id: 'ank-7cadde', city: 'ankara', name: 'Bahçelievler 7. Cadde', kind: 'street', lat: 39.922, lng: 32.824, r: 250 },
  { id: 'ank-hamamonu', city: 'ankara', name: 'Hamamönü', kind: 'neighborhood', lat: 39.937, lng: 32.864, r: 180 },
  { id: 'ank-odtu', city: 'ankara', name: 'ODTÜ Kampüsü', kind: 'campus', lat: 39.8914, lng: 32.7848, r: 450 },
  { id: 'ank-bilkent', city: 'ankara', name: 'Bilkent Üniversitesi', kind: 'campus', lat: 39.8687, lng: 32.7486, r: 450 },
  { id: 'ank-atakule', city: 'ankara', name: 'Atakule', kind: 'landmark', lat: 39.8857, lng: 32.8556, r: 150 },

  // İzmir
  { id: 'izm-kordon', city: 'izmir', name: 'Kordon', kind: 'park', lat: 38.438, lng: 27.142, r: 350 },
  { id: 'izm-saat-kulesi', city: 'izmir', name: 'Konak Saat Kulesi', kind: 'landmark', lat: 38.4189, lng: 27.1287, r: 150 },
  { id: 'izm-kemeralti', city: 'izmir', name: 'Kemeraltı Çarşısı', kind: 'market', lat: 38.419, lng: 27.133, r: 250 },
  { id: 'izm-kibris-sehitleri', city: 'izmir', name: 'Kıbrıs Şehitleri Caddesi', kind: 'street', lat: 38.437, lng: 27.145, r: 200 },
  { id: 'izm-karsiyaka', city: 'izmir', name: 'Karşıyaka Çarşı', kind: 'market', lat: 38.456, lng: 27.11, r: 250 },
  { id: 'izm-bostanli', city: 'izmir', name: 'Bostanlı Sahili', kind: 'park', lat: 38.455, lng: 27.095, r: 300 },
  { id: 'izm-ege-uni', city: 'izmir', name: 'Ege Üniversitesi', kind: 'campus', lat: 38.456, lng: 27.225, r: 450 },
  { id: 'izm-goztepe', city: 'izmir', name: 'Göztepe Sahili', kind: 'park', lat: 38.399, lng: 27.085, r: 250 },

  // Austin, Texas
  { id: 'aus-6th', city: 'austin', name: '6th Street', kind: 'street', lat: 30.2672, lng: -97.739, r: 250 },
  { id: 'aus-soco', city: 'austin', name: 'South Congress', kind: 'street', lat: 30.25, lng: -97.7495, r: 300 },
  { id: 'aus-drag', city: 'austin', name: 'The Drag (UT Austin)', kind: 'campus', lat: 30.286, lng: -97.742, r: 300 },
  { id: 'aus-zilker', city: 'austin', name: 'Zilker Park', kind: 'park', lat: 30.2669, lng: -97.7729, r: 400 },
  { id: 'aus-rainey', city: 'austin', name: 'Rainey Street', kind: 'street', lat: 30.2585, lng: -97.7385, r: 180 },
  { id: 'aus-barton', city: 'austin', name: 'Barton Springs Pool', kind: 'park', lat: 30.264, lng: -97.7713, r: 150 },
  { id: 'aus-bat-bridge', city: 'austin', name: 'Congress Ave Bridge', kind: 'landmark', lat: 30.2615, lng: -97.7451, r: 150 },
  { id: 'aus-east6', city: 'austin', name: 'East 6th', kind: 'street', lat: 30.262, lng: -97.727, r: 250 },
  { id: 'aus-capitol', city: 'austin', name: 'Texas State Capitol', kind: 'landmark', lat: 30.2747, lng: -97.7404, r: 220 },

  // New York
  { id: 'nyc-wsp', city: 'new-york', name: 'Washington Square Park', kind: 'park', lat: 40.7308, lng: -73.9973, r: 180 },
  { id: 'nyc-times-sq', city: 'new-york', name: 'Times Square', kind: 'square', lat: 40.758, lng: -73.9855, r: 200 },
  { id: 'nyc-union-sq', city: 'new-york', name: 'Union Square', kind: 'square', lat: 40.7359, lng: -73.9911, r: 160 },
  { id: 'nyc-bethesda', city: 'new-york', name: 'Bethesda Terrace', kind: 'park', lat: 40.774, lng: -73.9708, r: 150 },
  { id: 'nyc-bedford', city: 'new-york', name: 'Bedford Ave (Williamsburg)', kind: 'street', lat: 40.7171, lng: -73.9566, r: 250 },
  { id: 'nyc-grand-central', city: 'new-york', name: 'Grand Central Terminal', kind: 'station', lat: 40.7527, lng: -73.9772, r: 150 },
  { id: 'nyc-bryant', city: 'new-york', name: 'Bryant Park', kind: 'park', lat: 40.7536, lng: -73.9832, r: 140 },
  { id: 'nyc-high-line', city: 'new-york', name: 'The High Line', kind: 'park', lat: 40.748, lng: -74.0048, r: 300 },
  { id: 'nyc-columbia', city: 'new-york', name: 'Columbia University', kind: 'campus', lat: 40.8075, lng: -73.9626, r: 250 },

  // Los Angeles
  { id: 'la-venice', city: 'los-angeles', name: 'Venice Beach Boardwalk', kind: 'park', lat: 33.985, lng: -118.4695, r: 300 },
  { id: 'la-sm-pier', city: 'los-angeles', name: 'Santa Monica Pier', kind: 'pier', lat: 34.0094, lng: -118.4973, r: 200 },
  { id: 'la-abbot-kinney', city: 'los-angeles', name: 'Abbot Kinney Blvd', kind: 'street', lat: 33.9915, lng: -118.466, r: 250 },
  { id: 'la-silver-lake', city: 'los-angeles', name: 'Silver Lake', kind: 'neighborhood', lat: 34.091, lng: -118.278, r: 300 },
  { id: 'la-echo-park', city: 'los-angeles', name: 'Echo Park Lake', kind: 'park', lat: 34.073, lng: -118.2606, r: 220 },
  { id: 'la-hollywood', city: 'los-angeles', name: 'Hollywood Walk of Fame', kind: 'street', lat: 34.1016, lng: -118.3267, r: 300 },
  { id: 'la-gcm', city: 'los-angeles', name: 'Grand Central Market', kind: 'market', lat: 34.0508, lng: -118.249, r: 120 },
  { id: 'la-grove', city: 'los-angeles', name: 'The Grove', kind: 'market', lat: 34.072, lng: -118.357, r: 200 },
  { id: 'la-ucla', city: 'los-angeles', name: 'UCLA', kind: 'campus', lat: 34.0689, lng: -118.4452, r: 450 },
];
