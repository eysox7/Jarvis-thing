import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'mesh_store.dart';
import 'packet.dart';
import 'receipt.dart';

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
//
// Sunucunun teslim makbuzları (ack) da aynı yoldan yayılır: karşı taraf elindeki bir sözü söylediğinde
// (inv) o sözün makbuzu bizdeyse gönderilir; söz gönderilirken makbuzu da yanında gider (pkt "k").
// Makbuzu alan telefon sözü artık sunucuya taşımaz ve makbuzu sözü bilen öbür telefonlara iletir.
class Gossip {
  Gossip({
    required this.store,
    required this.link,
    this.maxHops = 8,
    int Function()? clock,
    this.onReceived,
    this.accept,
    this.verifyReceipt,
    this.onSettled,
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
  // Makbuz sunucunun imzası mı ve o söz için mi (receipt.dart); verilmezse makbuzlar yok sayılır.
  final bool Function(String receipt, String id)? verifyReceipt;
  // Makbuzla "ulaştı" sayılan sözler.
  final void Function(List<String> ids)? onSettled;
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

  // Bu telefonun az önce ulaştırdığı sözlerin makbuzları, o sözü bilen bağlı telefonlara gider.
  Future<void> announce(Iterable<MeshPacket> delivered) => _spreadAcks([
    for (final packet in delivered)
      if (packet.receipt != null) packet,
  ]);

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
        // Bildiği sözlerden ulaşmış olanların makbuzları.
        final acks = ids.map((id) => store[id]?.receipt).whereType<String>().take(_batch).toList();
        if (acks.isNotEmpty) await _send(peer, {'t': 'ack', 'r': acks});
      case 'want':
        for (final id in _ids(message['ids']).take(_batch)) {
          final packet = store[id];
          if (packet == null || !store.fresh(packet, now) || packet.hops >= maxHops) continue;
          known.add(id);
          _activeAt[peer] = now;
          await _send(peer, _pkt(packet));
        }
      case 'ack':
        final receipts = message['r'];
        if (receipts is! List) return;
        final settled = _settle(receipts.whereType<String>().take(_batch));
        if (settled.isEmpty) return;
        onLog?.call('$peer makbuz getirdi: ${settled.length} söz zaten sunucuya ulaşmış');
        _activeAt[peer] = now;
        onSettled?.call(settled.map((p) => p.id).toList());
        await _spreadAcks(settled, except: peer);
      case 'pkt':
        final payload = message['p'], hops = message['h'];
        if (payload is! String || hops is! int || hops < 0) return;
        final packet = MeshPacket.parse(payload, hops: hops + 1, receivedAt: now);
        if (packet == null) return;
        known.add(packet.id);
        final receipt = message['k'];
        if (store.knows(packet.id)) {
          // Elimizdeki söz makbuzuyla geldi.
          if (receipt is String && _settle([receipt]).isNotEmpty) onSettled?.call([packet.id]);
          return;
        }
        if (accept?.call(packet) == false) {
          store.forget(packet.id, now: now);
          onLog?.call('Söz geri çevrildi (denetim): ${packet.id}');
          return;
        }
        if (!store.add(packet, now: now)) return;
        if (receipt is String) _settle([receipt]);
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
      await _send(peer, _pkt(packet));
    }
  }

  Map<String, Object?> _pkt(MeshPacket packet) => {
    't': 'pkt',
    'p': packet.payload,
    'h': packet.hops,
    if (packet.receipt != null) 'k': packet.receipt,
  };

  // Geçerli makbuzları uygular; yeni "ulaştı" sayılan sözleri döner. İmza (pahalı) yalnızca elimizde
  // olup henüz makbuzu olmayan sözler için denetlenir. Dürüst telefon geçersiz makbuz göndermez: ilk
  // geçersizde mesajın kalanı bırakılır (sahte makbuz yağmuruyla işlemci yorulmasın).
  List<MeshPacket> _settle(Iterable<String> receipts) {
    final verify = verifyReceipt;
    if (verify == null) return const [];
    final settled = <MeshPacket>[];
    for (final receipt in receipts) {
      final id = Receipt.subject(receipt);
      final packet = id == null ? null : store[id];
      if (packet == null || packet.receipt != null) continue;
      if (!verify(receipt, packet.id)) break;
      if (store.settle(packet.id, receipt)) settled.add(packet);
    }
    return settled;
  }

  // Makbuzlar, o sözü bildiği bilinen bağlı telefonlara.
  Future<void> _spreadAcks(List<MeshPacket> packets, {String? except}) async {
    if (packets.isEmpty) return;
    for (final MapEntry(key: peer, value: known) in _peers.entries.toList()) {
      if (peer == except) continue;
      final acks = [
        for (final p in packets)
          if (known.contains(p.id)) p.receipt!,
      ];
      if (acks.isNotEmpty) await _send(peer, {'t': 'ack', 'r': acks.take(_batch).toList()});
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
