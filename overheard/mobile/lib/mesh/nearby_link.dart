import 'dart:async';
import 'dart:math';
import 'dart:typed_data';

import 'gossip.dart';
import 'mesh_channel.dart';

// Android: Google Nearby Connections (uygulamanın kendi katmanı, MeshPlugin.kt). Bluetooth, BLE ve
// Wi-Fi arasından uygun olanı Nearby seçer; internet istemez. Her telefon aynı anda hem görünür hem
// arar ve bulduğuna bağlanır (P2P_CLUSTER: çoktan çoğa). Gelen bağlantılar Android tarafında
// kendiliğinden kabul edilir. Kullanıcı adı yerine her açılışta değişen rastgele bir ad duyurulur.
// Kalabalıkta bağlantı yuvası sınırlı olduğundan, alışverişi biten telefondan kopulur ve bir süre ona
// yeniden bağlanılmaz; böylece sırayla herkese ulaşılır.
class NearbyLink implements MeshLink {
  NearbyLink({MeshChannel? channel, Random? random, this.onLog, this.cooldown = const Duration(seconds: 60)})
    : _channel = channel ?? MeshChannel.shared {
    final source = random ?? Random.secure();
    name = 'oh-${List.generate(6, (_) => source.nextInt(36).toRadixString(36)).join()}';
  }

  static const serviceId = 'app.overheard.mesh';

  late final String name;
  final void Function(String message)? onLog;
  final Duration cooldown;
  final MeshChannel _channel;
  final _events = StreamController<LinkEvent>.broadcast();
  final Set<String> _connected = {};
  final Set<String> _pending = {};
  final Map<String, String> _names = {};
  final Map<String, DateTime> _rested = {};
  StreamSubscription<Map<Object?, Object?>>? _subscription;
  bool _running = false;

  @override
  Stream<LinkEvent> get events => _events.stream;

  @override
  Future<bool> start() async {
    if (_running) return true;
    _subscription ??= _channel.events.listen(_handle);
    try {
      final result = await _channel.call<Map<Object?, Object?>>('start', {'name': name, 'serviceId': serviceId});
      final advertising = result?['advertising'] == true, discovering = result?['discovering'] == true;
      onLog?.call(
        'Bu telefon $name olarak görünür: ${advertising ? 'evet' : 'hayır'}, arıyor: ${discovering ? 'evet' : 'hayır'}',
      );
      _running = advertising || discovering;
    } catch (e) {
      onLog?.call('Yakındaki cihaz bağlantısı başlatılamadı: $e');
      _running = false;
    }
    return _running;
  }

  @override
  Future<void> stop() async {
    _running = false;
    await _subscription?.cancel();
    _subscription = null;
    try {
      await _channel.call<void>('stop');
    } catch (_) {}
    for (final peer in _connected) {
      _events.add(PeerDisconnected(peer));
    }
    _connected.clear();
    _pending.clear();
  }

  void _handle(Map<Object?, Object?> event) {
    final id = event['id'] as String?;
    switch (event['type']) {
      case 'found':
        _found(id!, event['name'] as String? ?? '');
      case 'initiated':
        _pending.add(id!);
        _names[id] = event['name'] as String? ?? id;
      case 'connected':
        _pending.remove(id);
        if (_connected.add(id!)) {
          onLog?.call('Bağlandı: ${_names[id] ?? id}');
          _events.add(PeerConnected(id));
        }
      case 'failed':
        _pending.remove(id);
        onLog?.call('Bağlanılamadı (${_names[id] ?? id}): ${event['code']}');
      case 'disconnected':
        _lost(id!);
      case 'payload':
        final bytes = event['bytes'];
        if (bytes is Uint8List) _events.add(PeerMessage(id!, bytes));
      case 'log':
        onLog?.call(event['message'] as String? ?? '');
    }
  }

  void _found(String id, String peerName) {
    if (!_running || _connected.contains(id) || _pending.contains(id)) return;
    final rested = _rested[peerName];
    if (rested != null && DateTime.now().difference(rested) < cooldown) return;
    _names[id] = peerName;
    onLog?.call('Telefon bulundu: $peerName');
    // İki telefon birbirini aynı anda bulursa ikisi birden istemesin: adı küçük olan ister, öbürü
    // biraz bekler (karşı taraf onu göremiyorsa yine de bağlansın diye).
    final delay = name.compareTo(peerName) < 0 ? Duration.zero : const Duration(seconds: 4);
    Timer(delay, () => _request(id));
  }

  Future<void> _request(String id) async {
    if (!_running || _connected.contains(id) || _pending.contains(id)) return;
    _pending.add(id);
    final ok = await _channel.call<bool>('connect', {'id': id}).catchError((Object _) => false);
    if (ok != true) _pending.remove(id);
  }

  void _lost(String id) {
    _pending.remove(id);
    if (_connected.remove(id)) {
      onLog?.call('Bağlantı bitti: ${_names[id] ?? id}');
      _events.add(PeerDisconnected(id));
    }
  }

  @override
  Future<void> send(String peer, Uint8List bytes) async {
    final ok = await _channel.call<bool>('send', {'id': peer, 'bytes': bytes});
    if (ok != true) throw StateError('gönderilemedi');
  }

  // Alışverişi biten telefondan kopulur; bir süre ona yeniden bağlanılmaz.
  @override
  Future<void> disconnect(String peer) async {
    final peerName = _names[peer];
    if (peerName != null) _rested[peerName] = DateTime.now();
    try {
      await _channel.call<void>('disconnect', {'id': peer});
    } catch (_) {}
    _lost(peer);
  }
}
