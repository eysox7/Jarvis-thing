// Sunucu yanıtlarının uygulamadaki karşılıkları (alan adları web API'siyle aynı).

double _d(Object? v) => (v as num?)?.toDouble() ?? 0;
int _i(Object? v) => (v as num?)?.toInt() ?? 0;
bool _b(Object? v) => v == true;

class City {
  const City({
    required this.id,
    required this.name,
    required this.lat,
    required this.lng,
    required this.zoom,
    this.country = '',
  });

  final String id;
  final String name;
  final double lat;
  final double lng;
  final double zoom;
  final String country;

  factory City.fromJson(Map<String, dynamic> j) => City(
    id: j['id'] as String,
    name: j['name'] as String,
    lat: _d(j['lat']),
    lng: _d(j['lng']),
    zoom: _d(j['zoom'] ?? 12),
    country: j['country'] as String? ?? '',
  );
}

class Me {
  const Me({required this.handle, this.isGuest = false, this.isAdmin = false});

  final String handle;
  final bool isGuest;
  final bool isAdmin;

  factory Me.fromJson(Map<String, dynamic> j) =>
      Me(handle: j['handle'] as String, isGuest: _b(j['isGuest']), isAdmin: _b(j['isAdmin']));
}

class Place {
  const Place({
    required this.id,
    required this.name,
    required this.lat,
    required this.lng,
    this.cityId = '',
    this.kind = 'spot',
    this.radius = 60,
    this.line = false,
    this.color,
    this.stops = const [],
    this.count = 0,
    this.peopleHere = 0,
    this.here = false,
    this.visited = false,
    this.cafe = false,
    this.arrived = false,
    this.held = false,
  });

  final String id;
  final String cityId;
  final String name;
  final String kind;
  final double lat;
  final double lng;
  final double radius;
  // Toplu taşıma hattı (metro, tramvay, metrobüs): duraklarıyla bir güzergâh.
  final bool line;
  final String? color;
  final List<List<double>> stops;
  final int count;
  final int peopleHere;
  final bool here;
  final bool visited;
  final bool cafe;
  final bool arrived;
  final bool held;

  factory Place.fromJson(Map<String, dynamic> j) => Place(
    id: j['id'] as String,
    cityId: j['cityId'] as String? ?? '',
    name: j['name'] as String? ?? '',
    kind: j['kind'] as String? ?? 'spot',
    lat: _d(j['lat']),
    lng: _d(j['lng']),
    radius: _d(j['radius'] ?? 60),
    line: _b(j['line']),
    color: j['color'] as String?,
    stops: [
      for (final s in (j['stops'] as List? ?? const [])) [_d((s as List)[0]), _d(s[1])],
    ],
    count: _i(j['count']),
    peopleHere: _i(j['peopleHere']),
    here: _b(j['here']),
    visited: _b(j['visited']),
    cafe: _b(j['cafe']),
    arrived: _b(j['arrived']),
    held: _b(j['held']),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'cityId': cityId,
    'name': name,
    'kind': kind,
    'lat': lat,
    'lng': lng,
    'radius': radius,
    'line': line,
    'color': color,
  };
}

class Overheard {
  const Overheard({
    required this.id,
    required this.placeId,
    required this.placeName,
    required this.lat,
    required this.lng,
    required this.createdAt,
    required this.locked,
    this.length = 0,
    this.text,
    this.author,
    this.anonymous = false,
    this.mine = false,
    this.visibility = 'local',
    this.onLine = false,
    this.offline = false,
    this.hops,
    this.reactions = const {},
    this.myReactions = const [],
    this.here = false,
  });

  final String id;
  final String placeId;
  final String placeName;
  final double lat;
  final double lng;
  final int createdAt;
  // Yerel söz ve sen orada değilsin: metin sunucudan hiç gelmez, yalnızca uzunluğu.
  final bool locked;
  final int length;
  final String? text;
  final String? author;
  final bool anonymous;
  final bool mine;
  final String visibility;
  final bool onLine;
  // İnternetsiz yazıldı (metroda); kulaktan kulağa geldiyse kaç telefondan geçtiği.
  final bool offline;
  final int? hops;
  final Map<String, int> reactions;
  final List<String> myReactions;
  final bool here;

  bool get public => visibility == 'public';

  factory Overheard.fromJson(Map<String, dynamic> j) => Overheard(
    id: j['id'] as String,
    placeId: j['placeId'] as String? ?? '',
    placeName: j['placeName'] as String? ?? '',
    lat: _d(j['lat']),
    lng: _d(j['lng']),
    createdAt: _i(j['createdAt']),
    locked: _b(j['locked']),
    length: _i(j['length']),
    text: j['text'] as String?,
    author: j['author'] as String?,
    anonymous: _b(j['anonymous']),
    mine: _b(j['mine']),
    visibility: j['visibility'] as String? ?? 'local',
    onLine: _b(j['onLine']),
    offline: _b(j['offline']),
    hops: (j['hops'] as num?)?.toInt(),
    reactions: {for (final e in ((j['reactions'] as Map?) ?? const {}).entries) e.key as String: _i(e.value)},
    myReactions: [...((j['myReactions'] as List?) ?? const []).whereType<String>()],
    here: _b(j['here']),
  );
}

class CityMap {
  const CityMap({required this.places, required this.overheards});

  final List<Place> places;
  final List<Overheard> overheards;

  factory CityMap.fromJson(Map<String, dynamic> j) => CityMap(
    places: [for (final p in (j['places'] as List? ?? const [])) Place.fromJson(p as Map<String, dynamic>)],
    overheards: [for (final o in (j['overheards'] as List? ?? const [])) Overheard.fromJson(o as Map<String, dynamic>)],
  );
}

// Check-in sonucu: şu an içinde olduğun mekânlar/hatlar ve az önce ayrıldıkların.
class Presence {
  const Presence({required this.places, required this.at, this.left = const [], this.blocked});

  final List<Place> places;
  final int at;
  final List<String> left;
  final String? blocked;

  factory Presence.fromJson(Map<String, dynamic> j, int at) => Presence(
    places: [for (final p in (j['places'] as List? ?? const [])) Place.fromJson(p as Map<String, dynamic>)],
    left: [...((j['left'] as List?) ?? const []).whereType<String>()],
    blocked: j['blocked'] as String?,
    at: at,
  );

  Map<String, dynamic> toJson() => {'places': places.map((p) => p.toJson()).toList(), 'at': at};
}
