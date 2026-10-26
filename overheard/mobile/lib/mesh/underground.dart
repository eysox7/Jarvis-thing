import 'dart:async';

import 'package:flutter/foundation.dart';

import '../core/moderation.dart';
import '../core/storage.dart';
import '../l10n/strings.dart';
import 'courier.dart';
import 'gossip.dart';
import 'mesh_store.dart';
import 'packet.dart';
import 'radio.dart';

enum UndergroundStart { ok, permissions, unavailable }

// Saha denemesi günlüğünün bir satırı (telefon bulundu, bağlandı, söz alındı, gönderilemedi...).
class LogLine {
  const LogLine(this.at, this.message);

  final int at;
  final String message;
}

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
  // Bağlantı katmanını kurar; verilen işlev saha günlüğüne yazar.
  final MeshLink Function(void Function(String message) log) linkFactory;
  final MeshRadio radio;
  final Courier courier;
  final int maxHops;
  final int Function() _clock;

  MeshLink? _link;
  Gossip? _gossip;
  StreamSubscription<LinkEvent>? _linkEvents;
  StreamSubscription<void>? _stopRequests;
  // Otomatik mod mu açtı (otomatik mod yalnızca kendi açtığını kapatır).
  bool startedByAuto = false;
  // Kullanıcı bildirimdeki "Kapat"a bastı (otomatik mod bir süre yeniden açmasın).
  void Function()? onUserStop;
  Timer? _tick;
  Timer? _save;
  bool _busy = false;
  final _received = StreamController<MeshPacket>.broadcast();
  final List<LogLine> _log = [];

  // En yeni önce, en fazla 200 satır.
  List<LogLine> get log => _log.reversed.toList();

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

  // Elle açılışta izin sorulur; otomatik açılışta yalnızca izin zaten verilmişse açılır.
  Future<UndergroundStart> start({bool auto = false}) async {
    if (running || _busy) return UndergroundStart.ok;
    _busy = true;
    try {
      if (!await (auto ? radio.granted() : radio.permit())) {
        _write('İzin verilmedi (Bluetooth, yakındaki cihazlar, konum)');
        return UndergroundStart.permissions;
      }
      final link = linkFactory(_write);
      final gossip = Gossip(
        store: store,
        link: link,
        maxHops: maxHops,
        clock: _clock,
        onReceived: _onReceived,
        // Nefret söylemi içeren söz alınmaz, saklanmaz ve yayılmaz.
        accept: (packet) => !containsSlur(packet.note.text),
        onLog: _write,
      )..start();
      _linkEvents = link.events.listen((_) => _changed(save: false));
      if (!await link.start()) {
        await gossip.stop();
        await _linkEvents?.cancel();
        _write('Yakındaki cihaz bağlantısı başlatılamadı');
        return UndergroundStart.unavailable;
      }
      _write(auto ? 'Yeraltı modu kendiliğinden açıldı' : 'Yeraltı modu açıldı');
      _link = link;
      _gossip = gossip;
      startedByAuto = auto;
      _tick = Timer.periodic(const Duration(seconds: 15), (_) => _maintain());
      _stopRequests = radio.stopRequests.listen((_) {
        _write('Bildirimden kapatıldı');
        onUserStop?.call();
        stop();
      });
      if (!await _notify()) _write('Kalıcı bildirim açılamadı (uygulama öndeyken yeniden denenecek)');
      notifyListeners();
      return UndergroundStart.ok;
    } finally {
      _busy = false;
    }
  }

  Future<void> stop() async {
    if (!running) return;
    _tick?.cancel();
    _tick = null;
    await _stopRequests?.cancel();
    _stopRequests = null;
    startedByAuto = false;
    await _gossip?.stop();
    await _linkEvents?.cancel();
    await _link?.stop();
    _gossip = null;
    _link = null;
    await radio.release();
    _write('Yeraltı modu kapandı');
  }

  // Hesap silinince: depo ve günlük boşaltılır.
  void clear() {
    store.clear();
    _log.clear();
    _changed();
  }

  // Sözü bu telefondan siler (rahatsız edici bulduysan); bir daha alınmaz ve kimseye sunulmaz.
  void hide(String id) {
    store.forget(id, now: _clock());
    _changed();
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
    if (sent > 0) _write('Sunucuya ulaştı: $sent söz');
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
    unawaited(_notify());
  }

  // Kalıcı bildirim: hizmeti başlatır ya da yakındaki telefon sayısıyla günceller.
  Future<bool> _notify() => radio
      .keepAlive(
        title: t('ug.notification'),
        text: peers > 0 ? t('ug.on', {'n': peers}) : t('ug.notificationText'),
        stop: t('ug.stop'),
      )
      .catchError((Object _) => false);

  void _onReceived(MeshPacket packet) {
    _received.add(packet);
    _changed();
  }

  void _write(String message) {
    _log.add(LogLine(_clock(), message));
    if (_log.length > 200) _log.removeAt(0);
    notifyListeners();
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
