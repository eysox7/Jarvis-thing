import '../core/api.dart';
import 'mesh_store.dart';
import 'packet.dart';

// Bağlantı gelince depodaki sözleri sunucuya ulaştırır: kendi sözlerin ve taşıdıkların. Sunucu
// imzayı ve yazarın "o sırada oradaydım" kanıtını denetler; aynı söz ikinci kez gelirse yalnızca
// kaydı döner. Sunucunun reddettiği söz (ör. kanıt yok) bir daha gönderilmez ama okunmaya devam eder.
class Courier {
  Courier(this.api, this.store);

  final Api api;
  final MeshStore store;
  bool _busy = false;

  // Gönderilen söz sayısı. Bağlantı yoksa, oturum kapalıysa ya da sunucu "sonra" diyorsa durur.
  Future<int> flush({required int now}) async {
    if (_busy || api.session == null) return 0;
    _busy = true;
    var sent = 0;
    try {
      for (final packet in store.pending(now)) {
        try {
          final result = await api.post('/api/overheards/relay', {'p': packet.payload, 'hops': packet.hops});
          packet
            ..state = PacketState.delivered
            ..overheardId = (result['overheard'] as Map?)?['id'] as String?
            ..receipt = result['receipt'] as String?;
          sent++;
        } on ApiException catch (e) {
          if (e.offline || e.status == 401 || e.status == 429 || e.status >= 500) break;
          packet
            ..state = PacketState.failed
            ..error = e.code;
        }
      }
    } finally {
      _busy = false;
    }
    return sent;
  }
}
