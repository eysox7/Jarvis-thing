import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:overheard/core/google_auth.dart';
import 'package:overheard/core/location.dart';
import 'package:overheard/mesh/device_key.dart';
import 'package:overheard/mesh/gossip.dart';
import 'package:overheard/mesh/packet.dart';
import 'package:overheard/mesh/radio.dart';

// Bellek içi "Bluetooth": telefonlar ağa katılır, testte istenen ikililer birbirine bağlanır.
class MemoryNetwork {
  final Map<String, MemoryLink> links = {};

  MemoryLink join(String name) => links[name] = MemoryLink(this, name);

  Future<void> connect(String a, String b) async {
    links[a]!.peerUp(b);
    links[b]!.peerUp(a);
    await settle();
  }

  Future<void> cut(String a, String b) async {
    links[a]!.peerDown(b);
    links[b]!.peerDown(a);
    await settle();
  }
}

class MemoryLink implements MeshLink {
  MemoryLink(this.network, this.name);

  final MemoryNetwork network;
  final String name;
  final Set<String> peers = {};
  final List<String> disconnected = [];
  final _events = StreamController<LinkEvent>.broadcast();
  int sent = 0;
  bool started = false;

  @override
  Stream<LinkEvent> get events => _events.stream;

  @override
  Future<bool> start() async => started = true;

  @override
  Future<void> stop() async {
    started = false;
    for (final peer in peers.toList()) {
      await network.cut(name, peer);
    }
  }

  void peerUp(String peer) {
    if (peers.add(peer)) _events.add(PeerConnected(peer));
  }

  void peerDown(String peer) {
    if (peers.remove(peer)) _events.add(PeerDisconnected(peer));
  }

  @override
  Future<void> send(String peer, Uint8List bytes) async {
    if (!peers.contains(peer)) throw StateError('not connected');
    sent++;
    network.links[peer]!._events.add(PeerMessage(name, bytes));
  }

  @override
  Future<void> disconnect(String peer) async {
    disconnected.add(peer);
    await network.cut(name, peer);
  }
}

class FakeRadio implements MeshRadio {
  bool allowed = true;
  bool alive = false;
  // Android arka plandan ön plan hizmeti başlatmaya izin vermediğinde false.
  bool canKeepAlive = true;
  int prompts = 0;
  // Son bildirim metni.
  String? text;
  final stops = StreamController<void>.broadcast();

  @override
  Future<bool> permit() async {
    prompts++;
    return allowed;
  }

  @override
  Future<bool> granted() async => allowed;

  @override
  Future<bool> keepAlive({required String title, required String text, required String stop}) async {
    this.text = text;
    return alive = canKeepAlive;
  }

  @override
  Future<void> release() async => alive = false;

  @override
  Stream<void> get stopRequests => stops.stream;
}

class FakeLocator implements Locator {
  FakeLocator([this.fix]);

  Fix? fix;

  @override
  Future<Fix?> current({Duration timeout = const Duration(seconds: 15)}) async => fix;
}

// Akışların (stream) ve zincirleme gönderimlerin bitmesini bekler.
Future<void> settle() async {
  for (var i = 0; i < 100; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

final testKey = DeviceKey.generate();
const testKeyId = 'k3yId123abcd';
const hour = 3600000;

MeshPacket signedPacket({
  String clientId = 'clientid-0001',
  String text = 'Vagonda biri: "Bu tünel hiç bitmeyecek."',
  required int heardAt,
  bool own = true,
  DeviceKey? key,
  String keyId = testKeyId,
}) {
  final note = MeshNote(
    clientId: clientId,
    placeId: 'istanbul-line-subway-m4',
    placeName: 'M4 Kadıköy–Sabiha Gökçen',
    text: text,
    heardAt: heardAt,
    author: 'yolcu',
  );
  return MeshPacket.parse(MeshPacket.sign(note, key ?? testKey, keyId), receivedAt: heardAt, own: own)!;
}

String jsonBody(Map<String, Object?> data) => jsonEncode(data);

// Google hesap seçicisinin yerine: sıradaki kimlik belgesini verir; yoksa kullanıcı vazgeçmiş sayılır.
class FakeGoogleAuth implements GoogleAuth {
  String? next;
  final requests = <String>[];

  @override
  Future<String> idToken(String serverClientId) async {
    requests.add(serverClientId);
    final token = next;
    if (token == null) throw GoogleCanceled();
    return token;
  }
}
