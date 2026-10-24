import 'dart:async';
import 'dart:math';
import 'dart:typed_data';

import 'package:nearby_connections/nearby_connections.dart';

import 'gossip.dart';

// Android: Google Nearby Connections. Bluetooth, BLE ve Wi-Fi arasından uygun olanı kendisi seçer;
// internet istemez. Her telefon aynı anda hem görünür (advertise) hem arar (discover) ve bulduğuna
// bağlanır (P2P_CLUSTER: çoktan çoğa). Bağlantı onayı otomatiktir; sözler imzalıdır ve zaten
// yanındakilerin okuyacağı metinlerdir. Kullanıcı adı yerine her açılışta değişen rastgele bir ad
// duyurulur. Kalabalıkta bağlantı yuvası sınırlı olduğundan, alışverişi biten telefondan kopulur ve
// bir süre ona yeniden bağlanılmaz; böylece sırayla herkese ulaşılır.
class NearbyLink implements MeshLink {
  NearbyLink({Nearby? nearby, Random? random, this.onLog}) : _nearby = nearby ?? Nearby() {
    final source = random ?? Random.secure();
    _name = 'oh-${List.generate(6, (_) => source.nextInt(36).toRadixString(36)).join()}';
  }

  static const serviceId = 'app.overheard.mesh';
  static const strategy = Strategy.P2P_CLUSTER;
  static const cooldown = Duration(seconds: 60);

  final Nearby _nearby;
  final void Function(String message)? onLog;
  late final String _name;
  final _events = StreamController<LinkEvent>.broadcast();
  final Set<String> _connected = {};
  final Set<String> _pending = {};
  final Map<String, String> _names = {};
  final Map<String, DateTime> _rested = {};
  bool _running = false;

  @override
  Stream<LinkEvent> get events => _events.stream;

  @override
  Future<bool> start() async {
    if (_running) return true;
    var advertising = false, discovering = false;
    try {
      advertising = await _nearby.startAdvertising(
        _name,
        strategy,
        onConnectionInitiated: _initiated,
        onConnectionResult: _result,
        onDisconnected: _lost,
        serviceId: serviceId,
      );
    } catch (e) {
      onLog?.call('Görünür olunamadı: $e');
    }
    try {
      discovering = await _nearby.startDiscovery(
        _name,
        strategy,
        onEndpointFound: _found,
        onEndpointLost: (_) {},
        serviceId: serviceId,
      );
    } catch (e) {
      onLog?.call('Arama başlatılamadı: $e');
    }
    _running = advertising || discovering;
    onLog?.call(
      'Bu telefon $_name olarak görünür: ${advertising ? 'evet' : 'hayır'}, arıyor: ${discovering ? 'evet' : 'hayır'}',
    );
    return _running;
  }

  @override
  Future<void> stop() async {
    _running = false;
    for (final call in [_nearby.stopAdvertising, _nearby.stopDiscovery, _nearby.stopAllEndpoints]) {
      try {
        await call();
      } catch (_) {}
    }
    for (final peer in _connected) {
      _events.add(PeerDisconnected(peer));
    }
    _connected.clear();
    _pending.clear();
  }

  void _found(String id, String name, String service) {
    if (!_running || _connected.contains(id) || _pending.contains(id)) return;
    final rested = _rested[name];
    if (rested != null && DateTime.now().difference(rested) < cooldown) return;
    // İki telefon birbirini aynı anda bulursa ikisi birden istemesin: adı küçük olan ister, öbürü
    // biraz bekler (karşı taraf onu göremiyorsa yine de bağlansın diye).
    _names[id] = name;
    onLog?.call('Telefon bulundu: $name');
    final delay = _name.compareTo(name) < 0 ? Duration.zero : const Duration(seconds: 4);
    Timer(delay, () => _request(id));
  }

  Future<void> _request(String id) async {
    if (!_running || _connected.contains(id) || _pending.contains(id)) return;
    _pending.add(id);
    try {
      await _nearby.requestConnection(
        _name,
        id,
        onConnectionInitiated: _initiated,
        onConnectionResult: _result,
        onDisconnected: _lost,
      );
    } catch (e) {
      _pending.remove(id);
      onLog?.call('Bağlantı isteği olmadı (${_names[id] ?? id}): $e');
    }
  }

  void _initiated(String id, ConnectionInfo info) {
    _pending.add(id);
    _names[id] = info.endpointName;
    _nearby.acceptConnection(id, onPayLoadRecieved: _payload).catchError((Object e) {
      onLog?.call('Bağlantı kabul edilemedi (${info.endpointName}): $e');
      return false;
    });
  }

  void _result(String id, Status status) {
    _pending.remove(id);
    if (status != Status.CONNECTED) onLog?.call('Bağlanılamadı (${_names[id] ?? id}): ${status.name}');
    if (status == Status.CONNECTED && _connected.add(id)) {
      onLog?.call('Bağlandı: ${_names[id] ?? id}');
      _events.add(PeerConnected(id));
    }
  }

  void _lost(String id) {
    _pending.remove(id);
    if (_connected.remove(id)) _events.add(PeerDisconnected(id));
  }

  void _payload(String id, Payload payload) {
    final bytes = payload.bytes;
    if (payload.type == PayloadType.BYTES && bytes != null) _events.add(PeerMessage(id, bytes));
  }

  @override
  Future<void> send(String peer, Uint8List bytes) => _nearby.sendBytesPayload(peer, bytes);

  // Alışverişi biten telefondan kopulur; bir süre ona yeniden bağlanılmaz.
  @override
  Future<void> disconnect(String peer) async {
    final name = _names[peer];
    if (name != null) _rested[name] = DateTime.now();
    try {
      await _nearby.disconnectFromEndpoint(peer);
    } catch (_) {}
    _lost(peer);
  }
}
