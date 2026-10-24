// Pilot bölgeler. Türkiye'deki üç büyük şehir + Austin, ve "overheard" kültürünün
// en canlı olduğu iki ABD şehri: konseptin doğduğu New York ("Overheard in New York",
// 2003) ve bugün en büyük overheard topluluklarından birini barındıran Los Angeles.
export const CITIES = [
  { id: 'istanbul', name: 'İstanbul', country: 'TR', lang: 'tr', lat: 41.0255, lng: 28.99, zoom: 12, radiusKm: 80 },
  { id: 'ankara', name: 'Ankara', country: 'TR', lang: 'tr', lat: 39.915, lng: 32.84, zoom: 12, radiusKm: 40 },
  { id: 'izmir', name: 'İzmir', country: 'TR', lang: 'tr', lat: 38.43, lng: 27.14, zoom: 12, radiusKm: 40 },
  { id: 'austin', name: 'Austin', region: 'Texas', country: 'US', lang: 'en', lat: 30.2672, lng: -97.7431, zoom: 13, radiusKm: 40 },
  { id: 'new-york', name: 'New York', region: 'New York', country: 'US', lang: 'en', lat: 40.7484, lng: -73.9857, zoom: 12, radiusKm: 45 },
  { id: 'los-angeles', name: 'Los Angeles', region: 'California', country: 'US', lang: 'en', lat: 34.04, lng: -118.33, zoom: 11, radiusKm: 60 },
];

export const CITY_BY_ID = new Map(CITIES.map((c) => [c.id, c]));
