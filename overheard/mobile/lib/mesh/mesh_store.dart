import 'packet.dart';

// Telefondaki kulaktan kulağa deposu: kendi sözlerin ve yanından geçenlerden aldıkların. Yalnızca
// süresi dolmamış sözler (sunucu 6 saatten eski çevrimdışı sözü kabul etmez) başkalarına sunulur ve
// sunucuya gönderilir; eskiler "yeraltında duyduklarım" olarak kalır. Depo dolunca en eski taşınan söz
// düşer (kendi sözlerin en son). Düşen sözlerin kimliği bir süre hatırlanır ki yeniden istenmesin.
class MeshStore {
  MeshStore({this.capacity = 300, this.maxAge = const Duration(hours: 6)});

  final int capacity;
  final Duration maxAge;
  final Map<String, MeshPacket> _packets = {};
  final Map<String, int> _dropped = {};

  bool knows(String id) => _packets.containsKey(id) || _dropped.containsKey(id);

  MeshPacket? operator [](String id) => _packets[id];

  int get length => _packets.length;

  // En yeni duyulan önce.
  List<MeshPacket> get packets => _packets.values.toList()..sort((a, b) => b.note.heardAt.compareTo(a.note.heardAt));

  bool fresh(MeshPacket packet, int now) => now - packet.note.heardAt <= maxAge.inMilliseconds;

  // Yeni sözü ekler; zaten biliniyorsa ya da süresi dolmuşsa eklemez.
  bool add(MeshPacket packet, {required int now}) {
    if (knows(packet.id) || !fresh(packet, now)) return false;
    _packets[packet.id] = packet;
    _evict(now);
    return _packets.containsKey(packet.id);
  }

  void clear() {
    _packets.clear();
    _dropped.clear();
  }

  // Sözü unutur (gizlendi ya da denetimden geçmedi); bir süre yeniden istenmez.
  void forget(String id, {required int now}) {
    _packets.remove(id);
    _dropped[id] = now;
  }

  // Başkalarına sunulacak sözlerin kimlikleri: süresi dolmamış, atlama sınırına varmamış (en yeni önce).
  List<String> offer(int now, {required int maxHops, int limit = 200}) =>
      packets.where((p) => fresh(p, now) && p.hops < maxHops).take(limit).map((p) => p.id).toList();

  // Sunucuya gönderilmeyi bekleyenler.
  List<MeshPacket> pending(int now) => packets.where((p) => p.state == PacketState.pending && fresh(p, now)).toList();

  void _evict(int now) {
    _dropped.removeWhere((_, at) => now - at > maxAge.inMilliseconds);
    if (_packets.length <= capacity) return;
    final order = _packets.values.toList()
      ..sort((a, b) {
        if (a.own != b.own) return a.own ? 1 : -1;
        return a.note.heardAt.compareTo(b.note.heardAt);
      });
    for (final packet in order.take(_packets.length - capacity)) {
      _packets.remove(packet.id);
      _dropped[packet.id] = now;
    }
  }

  Map<String, dynamic> toJson() => {'packets': _packets.values.map((p) => p.toJson()).toList(), 'dropped': _dropped};

  void load(Map<String, dynamic> json) {
    _packets.clear();
    _dropped.clear();
    for (final item in (json['packets'] as List? ?? const [])) {
      final packet = item is Map<String, dynamic> ? MeshPacket.fromJson(item) : null;
      if (packet != null) _packets[packet.id] = packet;
    }
    final dropped = json['dropped'];
    if (dropped is Map) {
      dropped.forEach((id, at) {
        if (id is String && at is num) _dropped[id] = at.toInt();
      });
    }
  }
}
