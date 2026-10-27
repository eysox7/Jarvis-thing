import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';

import '../core/api.dart';
import '../core/b64.dart';
import '../core/google_auth.dart';
import '../core/location.dart';
import '../core/models.dart';
import '../core/moderation.dart';
import '../core/storage.dart';
import '../mesh/auto_underground.dart';
import '../mesh/device_key.dart';
import '../mesh/packet.dart';
import '../mesh/underground.dart';

// Konum alınamadı (kapalı, izin yok ya da tünelde zamanında gelmedi).
class NoLocation implements Exception {}

// Cihaz anahtarı yok: internetsiz söz imzalanamaz (uygulama bir kez internetle açılmalı).
class NoDeviceKey implements Exception {}

// Söz bırakmanın sonucu: doğrudan haritaya düştü ya da yeraltı ağına bırakıldı.
class ComposeOutcome {
  const ComposeOutcome.posted(this.overheard) : packet = null;
  const ComposeOutcome.mesh(this.packet) : overheard = null;

  final Overheard? overheard;
  final MeshPacket? packet;

  bool get viaMesh => packet != null;
}

// Pilot şehirler (sunucuya hiç ulaşılamadıysa; asıl liste /api/config'ten gelir).
const fallbackCities = [
  City(id: 'istanbul', name: 'İstanbul', lat: 41.0255, lng: 28.99, zoom: 12, country: 'TR'),
  City(id: 'ankara', name: 'Ankara', lat: 39.915, lng: 32.84, zoom: 12, country: 'TR'),
  City(id: 'izmir', name: 'İzmir', lat: 38.43, lng: 27.14, zoom: 12, country: 'TR'),
  City(id: 'austin', name: 'Austin', lat: 30.2672, lng: -97.7431, zoom: 13, country: 'US'),
  City(id: 'new-york', name: 'New York', lat: 40.7484, lng: -73.9857, zoom: 12, country: 'US'),
  City(id: 'los-angeles', name: 'Los Angeles', lat: 34.04, lng: -118.33, zoom: 11, country: 'US'),
];

// Uygulamanın durumu: hesap, şehir haritası, son check-in, cihaz anahtarı ve yeraltı modu.
class AppController extends ChangeNotifier {
  AppController({
    required this.api,
    required this.vault,
    required this.files,
    required this.locator,
    required this.underground,
    this.google,
    this.defaultServer = '',
    this.connectUrl = '',
    this.connectivityUrl = 'https://connectivitycheck.gstatic.com/generate_204',
    int Function()? clock,
  }) : _clock = clock ?? (() => DateTime.now().millisecondsSinceEpoch) {
    // Yeraltı modundaki değişiklikler (yeni söz, yakındaki telefon) ekranları da yeniler.
    underground.addListener(notifyListeners);
    underground.onUserStop = auto.userStopped;
    api.onReachability = _reachable;
  }

  final Api api;
  final Vault vault;
  final Files files;
  final Locator locator;
  final Underground underground;
  final GoogleAuth? google;
  final String defaultServer;
  // Bağlantı dosyası (GitHub Pages): asıl sunucunun adresi buradan öğrenilir; sunucu taşınınca
  // uygulamayı yeniden kurmak gerekmez. Biçim: {"server": "https://...", "message": "..."}.
  final String connectUrl;
  // Sunucuya ulaşılamayınca genel internet bağlantısı buradan denetlenir: internet varsa sorun
  // sunucudadır (metro değil) ve yeraltı modu açılmaz.
  final String connectivityUrl;
  final int Function() _clock;

  // Yerinde kalma süreleri (sunucudaki stickyPresenceMs / linePresenceMs ile aynı).
  static const placeWindow = Duration(hours: 3);
  static const lineWindow = Duration(hours: 2);

  bool booted = false;
  Me? me;
  Profile profile = const Profile();
  List<City> cities = fallbackCities;
  bool demoMode = false;
  // Sunucuda Google ile giriş açıksa web istemci kimliği.
  String? googleClientId;
  // Sunucu adresi bağlantı dosyasından mı geldi; dosyadaki duyuru (ör. "sunucu bakımda").
  bool serverDiscovered = false;
  String? serverMessage;
  String cityId = 'istanbul';
  CityMap? map;
  bool mapStale = false;
  Presence? presence;
  Fix? lastFix;
  DeviceKey? _key;
  String? keyId;
  String? _keyOwner;
  Future<void>? _keying;
  Timer? _flushTimer;
  Timer? _autoTimer;
  // Otomatik yeraltı modu: hatta binince ya da bağlantı kopunca açılır, çıkınca kapanır.
  final auto = AutoUnderground();
  // Uygulama ekranda mı (Android arka plandan ön plan hizmeti başlatmaya izin vermez).
  bool foreground = true;
  // Sunucudan en son ne zaman haber alındı (yanıt ya da bağlantı hatası).
  int _lastHeard = 0;
  int _lastInternetCheck = -1 << 52;
  Future<void>? _internetCheck;
  bool _disposed = false;

  String get server => api.baseUrl;
  bool get hasKey => _key != null && keyId != null && _keyOwner == me?.handle;
  City get city => cities.firstWhere((c) => c.id == cityId, orElse: () => cities.first);

  Future<void> boot() async {
    api
      ..baseUrl = await vault.read('server') ?? defaultServer
      ..session = await vault.read('session')
      ..onSession = (session) => vault.write('session', session);
    me = _decode(await vault.read('me'), Me.fromJson);
    presence = _decode(await vault.read('presence'), (j) => Presence.fromJson(j, (j['at'] as num?)?.toInt() ?? 0));
    lastFix = Fix.fromJson(_json(await vault.read('fix')));
    cityId = await vault.read('city') ?? cityId;
    final privateKey = await vault.read('device_key');
    if (privateKey != null) {
      _key = DeviceKey.fromPrivate(privateKey);
      keyId = await vault.read('device_key_id');
      _keyOwner = await vault.read('device_key_owner');
    }
    final config = await files.load('config');
    if (config != null) _applyConfig(config);
    await underground.load();
    serverDiscovered = await vault.read('server_manual') != '1' && server.isNotEmpty && server != defaultServer;
    // İlk açılışta sunucu bilinmiyorsa bağlantı dosyası beklenir; biliniyorsa arka planda tazelenir.
    if (server.isEmpty) {
      await discover();
    } else {
      unawaited(discover());
    }
    booted = true;
    notifyListeners();
    // Bekleyen sözler bağlantı bulununca gitsin (metrodan çıkınca).
    _flushTimer = Timer.periodic(const Duration(seconds: 45), (_) {
      if (underground.waiting > 0 || underground.carried > 0) unawaited(underground.flush());
    });
    auto.enabled = await vault.read('auto_underground') != '0';
    _autoTimer = Timer.periodic(const Duration(seconds: 20), (_) => autoTick(probe: true));
    if (me != null) unawaited(refresh());
  }

  // --- Kesintisiz yeraltı ---

  // Sunucuya ulaşılabilirlik bildirimi. Ulaşılamadıysa genel internet denetlenir.
  void _reachable(bool online) {
    _lastHeard = _clock();
    if (online) {
      _setOnline(true);
    } else {
      _internetCheck ??= _checkInternet().whenComplete(() => _internetCheck = null);
    }
  }

  // Sunucu yanıt vermiyor: internet de yoksa (metro, tünel) bağlantı yok sayılır; internet varsa
  // sorun sunucudadır. En fazla 15 sn'de bir denetlenir.
  Future<void> _checkInternet() async {
    final now = _clock();
    if (now - _lastInternetCheck < 15000) return;
    _lastInternetCheck = now;
    _setOnline(connectivityUrl.isNotEmpty && await api.reachable(connectivityUrl));
  }

  // Bağlantı durumu değişti. Geri geldiği an bekleyen sözler yola çıkar.
  void _setOnline(bool online) {
    final was = auto.online;
    auto.reachability(online, _clock());
    if (online && !was) {
      if (underground.waiting > 0 || underground.carried > 0) unawaited(underground.flush());
      notifyListeners();
    } else if (!online && was) {
      notifyListeners();
    }
  }

  bool get online => auto.online;

  // Son check-in'e göre bir hattasın (biniş; içeride kalma süresi dolmadı).
  bool get onLine => composePlaces().any((p) => p.line);

  // Otomatik modun kararını uygular. [probe]: bağlantı yoksa ya da bir dakikadır sunucudan haber
  // alınmadıysa sunucu yoklanır (metroya girildiğini başka bir istek beklemeden fark etmek için).
  Future<void> autoTick({bool probe = false}) async {
    if (me == null) return;
    if (probe && server.isNotEmpty && (!auto.online || _clock() - _lastHeard > 60000)) {
      try {
        await api.get('/healthz');
      } on ApiException {
        // Sunucu yanıt vermedi; internet denetimi bitsin.
        await _internetCheck;
      }
    }
    auto.onLine = onLine;
    switch (auto.decide(running: underground.running, startedByAuto: underground.startedByAuto, now: _clock())) {
      case AutoAction.start:
        if (foreground) await startUnderground(auto: true);
      case AutoAction.stop:
        await underground.stop();
      case AutoAction.none:
        break;
    }
  }

  Future<void> setAutoUnderground(bool on) async {
    auto.enabled = on;
    await vault.write('auto_underground', on ? null : '0');
    notifyListeners();
    if (on) unawaited(autoTick());
  }

  // Yeraltı modunu açar ve (bağlantı varsa) konumu tazeler: binilen hat söz kanıtı olur.
  Future<UndergroundStart> startUnderground({bool auto = false}) async {
    final result = await underground.start(auto: auto);
    if (result == UndergroundStart.ok && this.auto.online) {
      unawaited(checkIn(timeout: const Duration(seconds: 8)).then((_) {}, onError: (_) {}));
    }
    return result;
  }

  // Elle kapatma: otomatik mod bu yolculukta yeniden açmaz.
  Future<void> stopUnderground() async {
    auto.userStopped();
    await underground.stop();
  }

  // Ekran öne geldi (true) ya da arkaya gitti (false).
  void setForeground(bool value) {
    foreground = value;
    if (value) unawaited(autoTick(probe: true));
  }

  // Bağlıyken: hesap, şehir listesi, cihaz anahtarı, harita ve bekleyen sözler.
  Future<void> refresh() async {
    try {
      final result = await api.get('/api/me');
      final user = result['user'];
      if (user == null) {
        await _signedOut();
        return;
      }
      await _setMe(Me.fromJson(user as Map<String, dynamic>));
      profile = Profile.fromJson(result);
      final config = await api.get('/api/config');
      _applyConfig(config);
      await files.save('config', config);
      await ensureKey();
      await underground.flush();
    } on ApiException catch (e) {
      if (!e.offline) rethrow;
    }
    await loadCity(cityId);
  }

  // Elle girilen adres bağlantı dosyasından önce gelir (yerel sunucuyla deneme için).
  Future<void> setServer(String url, {bool manual = true}) async {
    final clean = url.trim().replaceAll(RegExp(r'/+$'), '');
    // Aynı adres elle yeniden yazıldıysa da sabitlenir (bağlantı dosyası artık değiştirmez).
    if (manual && clean == api.baseUrl) {
      serverDiscovered = false;
      await vault.write('server_manual', '1');
      notifyListeners();
      return;
    }
    api.baseUrl = clean;
    serverDiscovered = !manual;
    await vault.write('server', clean);
    await vault.write('server_manual', manual ? '1' : null);
    notifyListeners();
  }

  // Elle girilen adresi bırakıp bağlantı dosyasına döner.
  Future<void> useDiscoveredServer() async {
    await vault.write('server_manual', null);
    await discover();
  }

  // Bağlantı dosyasını okur (virgülle birden çok adres verilebilir; ilk yanıt veren kullanılır).
  // Adres elle girilmediyse sunucu oradaki adrese ayarlanır.
  Future<void> discover() async {
    if (connectUrl.isEmpty || await vault.read('server_manual') == '1') return;
    for (final source in connectUrl.split(',').map((u) => u.trim()).where((u) => u.isNotEmpty)) {
      try {
        final json = await api.getUrl(source);
        final url = json['server'];
        final message = json['message'];
        serverMessage = message is String && message.isNotEmpty ? message : null;
        if (url is String && RegExp(r'^https?://').hasMatch(url)) {
          await setServer(url, manual: false);
          await loadConfig().catchError((_) {});
        }
        notifyListeners();
        return;
      } on ApiException {
        // Bu adres yanıt vermedi; sıradakine bakılır. Hiçbiri yoksa son bilinen adres kalır.
      }
    }
  }

  Future<void> signIn(String handle, String password) =>
      _auth('/api/auth/login', {'handle': handle, 'password': password});

  Future<void> register(String handle, String password) =>
      _auth('/api/auth/register', {'handle': handle, 'password': password, 'acceptTerms': true});

  Future<void> guest() => _auth('/api/auth/guest', {});

  // Google ile devam: hesap varsa girilir, yoksa açılır (düğmenin altındaki not: koşulları kabul).
  Future<void> signInWithGoogle() async =>
      _auth('/api/auth/google', {'idToken': await _googleToken(), 'acceptTerms': true});

  // Açık hesaba Google bağlanır (misafir hesabı kalıcı olur); sonra Google ile de girilebilir.
  Future<void> linkGoogle() async {
    final result = await api.post('/api/auth/google', {'idToken': await _googleToken()});
    await _setMe(Me.fromJson(result['user'] as Map<String, dynamic>));
    await refreshProfile();
  }

  Future<String> _googleToken() async {
    final clientId = googleClientId, auth = google;
    if (clientId == null || auth == null) throw ApiException(404, 'google_disabled');
    return auth.idToken(clientId);
  }

  Future<void> loadConfig() async {
    final config = await api.get('/api/config');
    _applyConfig(config);
    await files.save('config', config);
    notifyListeners();
  }

  Future<void> _auth(String path, Map<String, Object?> body) async {
    final result = await api.post(path, body);
    await _setMe(Me.fromJson(result['user'] as Map<String, dynamic>));
    unawaited(refresh().catchError((_) {}));
  }

  Future<void> signOut() async {
    try {
      await api.post('/api/auth/logout');
    } on ApiException {
      // Bağlantı yoksa da yerel oturum kapanır.
    }
    await _signedOut();
  }

  Future<void> _signedOut() async {
    if (underground.running) await underground.stop();
    api.session = null;
    await vault.write('session', null);
    await vault.write('me', null);
    await vault.write('presence', null);
    me = null;
    presence = null;
    notifyListeners();
  }

  Future<void> _setMe(Me value) async {
    me = value;
    await vault.write('me', jsonEncode({'handle': value.handle, 'isGuest': value.isGuest, 'isAdmin': value.isAdmin}));
    notifyListeners();
  }

  void _applyConfig(Map<String, dynamic> config) {
    final list = config['cities'];
    if (list is List && list.isNotEmpty) cities = [for (final c in list) City.fromJson(c as Map<String, dynamic>)];
    demoMode = config['demoMode'] == true;
    googleClientId = config['googleClientId'] as String?;
  }

  // Bağlıyken bir kez: cihaz anahtarı üretilir, açık yarısı sunucuya kaydedilir. Özel yarı yalnızca
  // bu telefonda (şifreli depoda) kalır; metroda yazılan sözler onunla imzalanır.
  Future<void> ensureKey() {
    if (me == null || hasKey) return Future.value();
    // Aynı anda iki yenileme iki anahtar üretmesin.
    return _keying ??= _createKey().whenComplete(() => _keying = null);
  }

  Future<void> _createKey() async {
    final handle = me!.handle;
    final key = DeviceKey.generate();
    final result = await api.post('/api/me/device-keys', {'jwk': key.publicJwk});
    _key = key;
    keyId = result['keyId'] as String;
    _keyOwner = handle;
    await vault.write('device_key', key.privateEncoded);
    await vault.write('device_key_id', keyId);
    await vault.write('device_key_owner', handle);
    notifyListeners();
  }

  Future<void> loadCity(String id) async {
    cityId = id;
    await vault.write('city', id);
    try {
      final json = await api.get('/api/cities/$id/map');
      map = CityMap.fromJson(json);
      mapStale = false;
      await files.save('map_$id', json);
    } on ApiException catch (e) {
      if (!e.offline) rethrow;
      final cached = await files.load('map_$id');
      map = cached == null ? null : CityMap.fromJson(cached);
      mapStale = true;
    }
    notifyListeners();
  }

  // "Buradayım": konum sunucuya gider, içinde olduğun mekânlar ve bindiğin hat döner.
  Future<Presence> checkIn({Duration timeout = const Duration(seconds: 15)}) async {
    final fix = await locator.current(timeout: timeout);
    if (fix == null) throw NoLocation();
    await _rememberFix(fix);
    final result = await api.post('/api/checkins', fix.toCoords());
    final next = Presence.fromJson(result, _clock());
    presence = next;
    await vault.write('presence', jsonEncode(next.toJson()));
    notifyListeners();
    if (next.places.any((p) => p.arrived) || next.left.isNotEmpty) unawaited(loadCity(cityId).catchError((_) {}));
    return next;
  }

  // Söz bırakılabilecek yerler: son check-in'de içinde olduğun mekânlar ve hatlar (içeride kalma
  // süresi dolmadıysa). Sunucu yine de "o sırada oradaydın" diye denetler.
  List<Place> composePlaces() {
    final current = presence;
    if (current == null) return const [];
    final age = _clock() - current.at;
    return current.places.where((p) => age <= (p.line ? lineWindow : placeWindow).inMilliseconds).toList();
  }

  // Bağlantı ve konum varsa söz doğrudan haritaya düşer. Yoksa (metroda) cihaz anahtarıyla imzalanıp
  // yeraltı ağına bırakılır: yanındaki telefonlara geçer, biri sinyal bulunca sunucuya ulaşır.
  Future<ComposeOutcome> compose({
    required String text,
    required Place place,
    bool public = false,
    bool anonymous = false,
  }) async {
    final visibility = public ? 'public' : 'local';
    // Az önce (söz penceresi açılırken) alınmış konum yeterli; tünelde yeniden beklenmez.
    final recent = lastFix != null && _clock() - lastFix!.at <= 60000 ? lastFix : null;
    final fix = recent ?? await locator.current(timeout: const Duration(seconds: 5));
    if (fix != null) {
      await _rememberFix(fix);
      try {
        final result = await api.post('/api/overheards', {
          'text': text,
          ...fix.toCoords(),
          'placeId': place.id,
          'visibility': visibility,
          'anonymous': anonymous,
        });
        unawaited(loadCity(cityId).catchError((_) {}));
        return ComposeOutcome.posted(Overheard.fromJson(result['overheard'] as Map<String, dynamic>));
      } on ApiException catch (e) {
        if (!e.offline) rethrow;
      }
    }
    final key = _key, id = keyId;
    if (key == null || id == null || !hasKey) throw NoDeviceKey();
    // Söz telefondan telefona sunucudan önce okunur: nefret söylemi yazılmaz, kişisel veri ve küfür
    // imzalanmadan önce maskelenir (sunucunun kuralları).
    final clean = moderatePublicText(text);
    final now = _clock();
    // Kanıt: şimdiki iyi konum ya da (tünelde) binerken alınmış son konum.
    final proof = [
      fix,
      lastFix,
    ].whereType<Fix>().where((f) => f.accuracy <= 100 && now - f.at <= lineWindow.inMilliseconds).firstOrNull;
    final note = MeshNote(
      clientId: _newClientId(),
      placeId: place.id,
      placeName: place.name,
      text: clean,
      heardAt: now,
      public: public,
      anonymous: anonymous,
      fix: proof?.toProof(),
      author: me?.handle,
    );
    final packet = MeshPacket.parse(MeshPacket.sign(note, key, id), receivedAt: now, own: true)!;
    await underground.publish(packet);
    await underground.flush();
    final delivered = packet.overheardId;
    if (packet.state == PacketState.delivered && delivered != null) {
      unawaited(loadCity(cityId).catchError((_) {}));
      try {
        final result = await api.get('/api/overheards/$delivered');
        return ComposeOutcome.posted(Overheard.fromJson(result['overheard'] as Map<String, dynamic>));
      } on ApiException {
        return ComposeOutcome.mesh(packet);
      }
    }
    if (packet.state == PacketState.failed) {
      throw ApiException(400, packet.error ?? 'default', {'placeName': place.name});
    }
    return ComposeOutcome.mesh(packet);
  }

  // Okunmamış mesaj sayısı ve profil sayıları (sekme rozeti için ara ara).
  Future<void> refreshProfile() async {
    try {
      final result = await api.get('/api/me');
      if (result['user'] == null) return;
      profile = Profile.fromJson(result);
      notifyListeners();
    } on ApiException {
      // Bağlantı yoksa eski sayılar kalır.
    }
  }

  // --- Söz üzerinde eylemler ---

  Future<Overheard> react(String id, String kind) async {
    final result = await api.post('/api/overheards/$id/reactions', {'kind': kind});
    return Overheard.fromJson(result['overheard'] as Map<String, dynamic>);
  }

  Future<void> report(String id) => api.post('/api/overheards/$id/report', {'reason': 'inappropriate'});

  // Yazar engellenir (anonimse kimliği açılmadan); sözleri haritadan kalkar, birbirinize yazamazsınız.
  Future<void> blockAuthor(String id) async {
    await api.post('/api/overheards/$id/block-author');
    unawaited(loadCity(cityId).catchError((_) {}));
  }

  // --- Mesajlar ---

  Future<List<ConversationSummary>> conversations() async {
    final result = await api.get('/api/conversations');
    final list = [
      for (final c in (result['conversations'] as List? ?? const []))
        ConversationSummary.fromJson(c as Map<String, dynamic>),
    ];
    final unread = list.where((c) => c.unread).length;
    if (unread != profile.unread) {
      profile = profile.copyWith(unread: unread);
      notifyListeners();
    }
    return list;
  }

  Future<Conversation> conversation(String id) async =>
      Conversation.fromJson((await api.get('/api/conversations/$id'))['conversation'] as Map<String, dynamic>);

  Future<void> sendMessage(String conversationId, String body) =>
      api.post('/api/conversations/$conversationId/messages', {'body': body});

  // Sözün sahibine ilk mesaj; konuşmanın kimliği döner.
  Future<String> messageAbout(String overheardId, String body) async =>
      (await api.post('/api/overheards/$overheardId/messages', {'body': body}))['conversationId'] as String;

  Future<Conversation> reveal(String conversationId) async => Conversation.fromJson(
    (await api.post('/api/conversations/$conversationId/reveal'))['conversation'] as Map<String, dynamic>,
  );

  // --- Hesap ---

  String get termsUrl => '$server/terms.html';
  String get privacyUrl => '$server/privacy.html';

  // Hesap ve sunucudaki tüm veriler kalıcı olarak silinir; telefondaki her şey (anahtar, yeraltı
  // deposu, önbellekler) de temizlenir.
  // Parolası olmayan (Google ile açılmış) hesapta silme, taze bir Google girişiyle onaylanır.
  Future<void> deleteAccount(String password) async {
    final viaGoogle = !(me?.isGuest ?? false) && !profile.passwordLogin && profile.googleLinked;
    await api.post('/api/me/delete', viaGoogle ? {'googleIdToken': await _googleToken()} : {'password': password});
    if (underground.running) await underground.stop();
    underground.clear();
    await files.clear();
    for (final key in ['device_key', 'device_key_id', 'device_key_owner', 'fix', 'city']) {
      await vault.write(key, null);
    }
    _key = null;
    keyId = null;
    _keyOwner = null;
    lastFix = null;
    map = null;
    await _signedOut();
  }

  Future<Overheard> overheard(String id) async =>
      Overheard.fromJson((await api.get('/api/overheards/$id'))['overheard'] as Map<String, dynamic>);

  Future<void> _rememberFix(Fix fix) async {
    lastFix = fix;
    await vault.write('fix', jsonEncode(fix.toJson()));
  }

  static String _newClientId() {
    final random = Random.secure();
    return b64url(List.generate(16, (_) => random.nextInt(256)));
  }

  static Map<String, dynamic>? _json(String? raw) {
    if (raw == null) return null;
    try {
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  static T? _decode<T>(String? raw, T Function(Map<String, dynamic>) parse) {
    final json = _json(raw);
    if (json == null) return null;
    try {
      return parse(json);
    } catch (_) {
      return null;
    }
  }

  // Kapatıldıktan sonra biten istekler (açılıştaki yenileme, internet denetimi) sessizce düşer.
  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _flushTimer?.cancel();
    _autoTimer?.cancel();
    underground.removeListener(notifyListeners);
    super.dispose();
  }
}
