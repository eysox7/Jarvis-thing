import 'dart:async';

import 'package:flutter/foundation.dart';

import '../core/storage.dart';
import '../l10n/strings.dart';
import 'courier.dart';
import 'gossip.dart';
import 'mesh_store.dart';
import 'packet.dart';
import 'radio.dart';

enum UndergroundStart { ok, permissions, unavailable }

// Yeraltı modu: telefonlar arası yayılmayı (Gossip) bağlantı katmanına (Nearby) bağlar, depoyu diske
// yazar ve bağlantı bulunca sözleri sunucuya ulaştırır (Courier). Mod kapalıyken de yazılan söz
// depoya girer; mod açılınca yanındakilere geçer.
class Underground extends ChangeNotifier {
  Underground({
    required this.store,
    required this.files,
    required this.linkFactory,
    required this.radio,
    required this.courier,
    int Function()? clock,
    this.maxHops = 8,
  }) : _clock = clock ?? (() => DateTime.now().millisecondsSinceEpoch);

  static const file = 'underground';
  static const idleAfter = Duration(seconds: 30);

  final MeshStore store;
  final Files files;
  final MeshLink Function() linkFactory;
  final MeshRadio radio;
  final Courier courier;
  final int maxHops;
  final int Function() _clock;

  MeshLink? _link;
  Gossip? _gossip;
  StreamSubscription<LinkEvent>? _linkEvents;
  Timer? _tick;
  Timer? _save;
  bool _busy = false;
  final _received = StreamController<MeshPacket>.broadcast();

  bool get running => _gossip != null;
  int get peers => _gossip?.peers.length ?? 0;
  Stream<MeshPacket> get received => _received.stream;

  List<MeshPacket> get packets => store.packets;
  int get waiting => packets.where((p) => p.own && p.state == PacketState.pending).length;
  int get carried => packets.where((p) => !p.own).length;
  int get delivered => packets.where((p) => p.state == PacketState.delivered).length;

  Future<void> load() async {
    final json = await files.load(file);
    if (json != null) store.load(json);
    notifyListeners();
  }

  Future<UndergroundStart> start() async {
    if (running || _busy) return UndergroundStart.ok;
    _busy = true;
    try {
      if (!await radio.permit()) return UndergroundStart.permissions;
      final link = linkFactory();
      final gossip = Gossip(store: store, link: link, maxHops: maxHops, clock: _clock, onReceived: _onReceived)
        ..start();
      _linkEvents = link.events.listen((_) => _changed(save: false));
      if (!await link.start()) {
        await gossip.stop();
        await _linkEvents?.cancel();
        return UndergroundStart.unavailable;
      }
      _link = link;
      _gossip = gossip;
      _tick = Timer.periodic(const Duration(seconds: 15), (_) => _maintain());
      await radio.keepAlive(title: t('ug.notification'), text: t('ug.notificationText'));
      notifyListeners();
      return UndergroundStart.ok;
    } finally {
      _busy = false;
    }
  }

  Future<void> stop() async {
    _tick?.cancel();
    _tick = null;
    await _gossip?.stop();
    await _linkEvents?.cancel();
    await _link?.stop();
    _gossip = null;
    _link = null;
    await radio.release();
    notifyListeners();
  }

  // Kendi yeni sözün. Mod açıksa bağlı herkese gider; bağlantı varsa hemen sunucuya da.
  Future<bool> publish(MeshPacket packet) async {
    final added = _gossip != null ? await _gossip!.publish(packet) : store.add(packet, now: _clock());
    _changed();
    return added;
  }

  Future<int> flush() async {
    final before = packets.map((p) => p.state).toList();
    final sent = await courier.flush(now: _clock());
    final after = packets.map((p) => p.state).toList();
    if (!listEquals(before, after)) _changed();
    return sent;
  }

  void _maintain() {
    final gossip = _gossip, link = _link;
    if (gossip == null || link == null) return;
    for (final peer in gossip.idlePeers(idleAfter)) {
      unawaited(link.disconnect(peer));
    }
    unawaited(flush());
    unawaited(
      radio.update(title: t('ug.notification'), text: peers > 0 ? t('ug.on', {'n': peers}) : t('ug.notificationText')),
    );
  }

  void _onReceived(MeshPacket packet) {
    _received.add(packet);
    _changed();
  }

  void _changed({bool save = true}) {
    notifyListeners();
    if (!save) return;
    _save?.cancel();
    _save = Timer(const Duration(milliseconds: 500), () => files.save(file, store.toJson()));
  }

  @override
  void dispose() {
    _tick?.cancel();
    _save?.cancel();
    _received.close();
    super.dispose();
  }
}
