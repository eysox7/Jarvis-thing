import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'mesh_store.dart';
import 'packet.dart';

// Bağlantı katmanı: Android'de Nearby Connections (nearby_link.dart), testlerde bellek içi ağ.
sealed class LinkEvent {
  const LinkEvent(this.peer);
  final String peer;
}

class PeerConnected extends LinkEvent {
  const PeerConnected(super.peer);
}

class PeerDisconnected extends LinkEvent {
  const PeerDisconnected(super.peer);
}

class PeerMessage extends LinkEvent {
  const PeerMessage(super.peer, this.bytes);
  final Uint8List bytes;
}

abstract class MeshLink {
  Stream<LinkEvent> get events;
  Future<bool> start();
  Future<void> stop();
  Future<void> send(String peer, Uint8List bytes);
  Future<void> disconnect(String peer);
}

// Telefondan telefona yayılma (dedikodu protokolü). Bağlanan iki telefon ellerindeki sözlerin
// kimliklerini söyler (inv), karşı tarafta olmayanları ister (want) ve alır (pkt). Yeni bir söz
// (kendi yazdığın ya da az önce gelen) bağlı olup onu bilmeyen herkese hemen gönderilir. Bir söz en
// fazla [maxHops] telefondan geçer; süresi dolan söz kimseye sunulmaz. Böylece vagonda tek bir kişi
// sinyal bulduğunda herkesin sözü sunucuya ulaşır.
class Gossip {
  Gossip({
    required this.store,
    required this.link,
    this.maxHops = 8,
    int Function()? clock,
    this.onReceived,
    this.accept,
    this.onLog,
  }) : _clock = clock ?? (() => DateTime.now().millisecondsSinceEpoch);

  static const version = 1;
  static const _batch = 50;

  final MeshStore store;
  final MeshLink link;
  final int maxHops;
  final int Function() _clock;
  final void Function(MeshPacket packet)? onReceived;
  // Gelen söz kabul edilsin mi (ör. nefret söylemi içeren söz alınmaz ve yayılmaz).
  final bool Function(MeshPacket packet)? accept;
  // Saha denemeleri için olay günlüğü.
  final void Function(String message)? onLog;

  // Bağlı telefonlar ve onların bildiği sözler (söyledikleri ya da bizim gönderdiklerimiz).
  final Map<String, Set<String>> _peers = {};
  // Telefonla en son ne zaman yeni bir söz alışverişi oldu (boşta kalan bağlantı bırakılır).
  final Map<String, int> _activeAt = {};
  StreamSubscription<LinkEvent>? _subscription;

  Set<String> get peers => _peers.keys.toSet();

  void start() => _subscription ??= link.events.listen(_handle);

  Future<void> stop() async {
    await _subscription?.cancel();
    _subscription = null;
    _peers.clear();
    _activeAt.clear();
  }

  // Kendi yeni sözün: depoya girer ve bağlı herkese gider.
  Future<bool> publish(MeshPacket packet) async {
    if (!store.add(packet, now: _clock())) return false;
    await _spread(packet);
    return true;
  }

  // [after] süredir yeni söz alışverişi olmayan bağlantılar (yer açmak için bırakılabilir).
  List<String> idlePeers(Duration after) {
    final now = _clock();
    return _peers.keys.where((peer) => now - (_activeAt[peer] ?? now) >= after.inMilliseconds).toList();
  }

  Future<void> _handle(LinkEvent event) async {
    switch (event) {
      case PeerConnected(:final peer):
        _peers[peer] = {};
        _activeAt[peer] = _clock();
        final offer = store.offer(_clock(), maxHops: maxHops);
        onLog?.call('Bağlandı: $peer (elimizde ${offer.length} söz)');
        await _send(peer, {'t': 'inv', 'ids': offer});
      case PeerDisconnected(:final peer):
        _peers.remove(peer);
        _activeAt.remove(peer);
        onLog?.call('Bağlantı bitti: $peer');
      case PeerMessage(:final peer, :final bytes):
        await _message(peer, bytes);
    }
  }

  Future<void> _message(String peer, Uint8List bytes) async {
    Object? message;
    try {
      message = jsonDecode(utf8.decode(bytes));
    } catch (_) {
      return;
    }
    if (message is! Map) return;
    final known = _peers.putIfAbsent(peer, () => {});
    final now = _clock();
    switch (message['t']) {
      case 'inv':
        final ids = _ids(message['ids']);
        known.addAll(ids);
        final want = ids.where((id) => !store.knows(id)).take(_batch).toList();
        if (want.isNotEmpty) {
          onLog?.call('$peer ${ids.length} söz biliyor, ${want.length} tanesi bizde yok: isteniyor');
          await _send(peer, {'t': 'want', 'ids': want});
        }
      case 'want':
        for (final id in _ids(message['ids']).take(_batch)) {
          final packet = store[id];
          if (packet == null || !store.fresh(packet, now) || packet.hops >= maxHops) continue;
          known.add(id);
          _activeAt[peer] = now;
          await _send(peer, {'t': 'pkt', 'p': packet.payload, 'h': packet.hops});
        }
      case 'pkt':
        final payload = message['p'], hops = message['h'];
        if (payload is! String || hops is! int || hops < 0) return;
        final packet = MeshPacket.parse(payload, hops: hops + 1, receivedAt: now);
        if (packet == null) return;
        known.add(packet.id);
        if (store.knows(packet.id)) return;
        if (accept?.call(packet) == false) {
          store.forget(packet.id, now: now);
          onLog?.call('Söz geri çevrildi (denetim): ${packet.id}');
          return;
        }
        if (!store.add(packet, now: now)) return;
        onLog?.call('Söz alındı: ${packet.note.placeName} (${packet.hops}. telefon)');
        _activeAt[peer] = now;
        onReceived?.call(packet);
        await _spread(packet, except: peer);
    }
  }

  Future<void> _spread(MeshPacket packet, {String? except}) async {
    if (packet.hops >= maxHops) return;
    for (final MapEntry(key: peer, value: known) in _peers.entries.toList()) {
      if (peer == except || known.contains(packet.id)) continue;
      known.add(packet.id);
      _activeAt[peer] = _clock();
      await _send(peer, {'t': 'pkt', 'p': packet.payload, 'h': packet.hops});
    }
  }

  Future<void> _send(String peer, Map<String, Object?> message) async {
    try {
      await link.send(peer, Uint8List.fromList(utf8.encode(jsonEncode({'v': version, ...message}))));
    } catch (e) {
      // Telefon uzaklaştı; bağlantı kopunca PeerDisconnected gelir.
      onLog?.call('Gönderilemedi ($peer): $e');
    }
  }

  static List<String> _ids(Object? value) =>
      value is List ? value.whereType<String>().where((id) => id.length <= 100).toList() : const [];
}
