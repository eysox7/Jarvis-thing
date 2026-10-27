import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:overheard/core/b64.dart';
import 'package:overheard/core/moderation.dart';
import 'package:overheard/mesh/device_key.dart';
import 'package:overheard/mesh/gossip.dart';
import 'package:overheard/mesh/mesh_store.dart';
import 'package:overheard/mesh/packet.dart';
import 'package:overheard/mesh/receipt.dart';

import 'support.dart';

// Sunucunun makbuz anahtarı (gerçekte sunucuda; açık yarısı /api/config'ten gelir).
final server = DeviceKey.generate();

String receiptFor(String id, {DeviceKey? key, int at = 1700000000000}) {
  final data = utf8.encode(jsonEncode({'i': id, 'd': at}));
  return '${b64url(data)}.${b64url((key ?? server).sign(data))}';
}

class Phone {
  Phone(MemoryNetwork network, String name, int Function() clock, {int maxHops = 8, bool Function(MeshPacket)? accept})
    : link = network.join(name) {
    gossip = Gossip(
      store: store,
      link: link,
      maxHops: maxHops,
      clock: clock,
      onReceived: received.add,
      accept: accept,
      verifyReceipt: (receipt, id) => Receipt.valid(receipt, id, server.publicJwk),
      onSettled: settled.addAll,
      onLog: log.add,
    )..start();
  }

  final MemoryLink link;
  final store = MeshStore();
  final received = <MeshPacket>[];
  final settled = <String>[];
  final log = <String>[];
  late final Gossip gossip;
}

void main() {
  late MemoryNetwork net;
  late int now;
  Phone phone(String name, {int maxHops = 8, bool Function(MeshPacket)? accept}) =>
      Phone(net, name, () => now, maxHops: maxHops, accept: accept);

  setUp(() {
    net = MemoryNetwork();
    now = 1700000000000;
  });

  test('A → B → C: söz iki telefondan geçer, yolda kimse değiştiremez', () async {
    final a = phone('A'), b = phone('B'), c = phone('C');
    await net.connect('A', 'B');
    await net.connect('B', 'C');
    final packet = signedPacket(heardAt: now);
    expect(await a.gossip.publish(packet), isTrue);
    await settle();
    expect(b.store[packet.id]!.hops, 1);
    expect(c.store[packet.id]!.hops, 2);
    expect(c.store[packet.id]!.payload, packet.payload);
    expect(c.store[packet.id]!.own, isFalse);
    expect(b.received.single.note.text, packet.note.text);
    expect(c.received.single.note.text, packet.note.text);
    expect(a.received, isEmpty);
  });

  test('sonradan yanına gelen telefon eksik sözleri envanter alışverişiyle alır', () async {
    final a = phone('A'), b = phone('B');
    final first = signedPacket(clientId: 'clientid-0001', heardAt: now - hour);
    final second = signedPacket(clientId: 'clientid-0002', heardAt: now - 1000);
    await a.gossip.publish(first);
    await a.gossip.publish(second);
    expect(b.store.length, 0);
    await net.connect('A', 'B');
    expect(b.store.length, 2);
    // B'nin kendi sözü de A'ya geçer (iki yönlü).
    final mine = signedPacket(clientId: 'clientid-b001', heardAt: now, key: testKey, keyId: 'otherKey1234');
    await b.gossip.publish(mine);
    await settle();
    expect(a.store[mine.id]?.hops, 1);
  });

  test('üçgende aynı söz bir kez alınır, sonsuza dek dolaşmaz', () async {
    final a = phone('A'), b = phone('B'), c = phone('C');
    await net.connect('A', 'B');
    await net.connect('B', 'C');
    await net.connect('A', 'C');
    final packet = signedPacket(heardAt: now);
    await a.gossip.publish(packet);
    await settle();
    expect(b.received, hasLength(1));
    expect(c.received, hasLength(1));
    final total = a.link.sent + b.link.sent + c.link.sent;
    await settle();
    expect(a.link.sent + b.link.sent + c.link.sent, total);
    expect(total, lessThan(12));
  });

  test('atlama sınırı: söz en fazla maxHops telefondan geçer', () async {
    final a = phone('A', maxHops: 2),
        b = phone('B', maxHops: 2),
        c = phone('C', maxHops: 2),
        d = phone('D', maxHops: 2);
    await net.connect('A', 'B');
    await net.connect('B', 'C');
    await net.connect('C', 'D');
    final packet = signedPacket(heardAt: now);
    await a.gossip.publish(packet);
    await settle();
    expect(b.store[packet.id]!.hops, 1);
    expect(c.store[packet.id]!.hops, 2);
    expect(d.store[packet.id], isNull);
  });

  test('6 saati geçen söz ne kabul edilir ne sunulur', () async {
    final a = phone('A'), b = phone('B');
    expect(await a.gossip.publish(signedPacket(clientId: 'clientid-old1', heardAt: now - 7 * hour)), isFalse);
    final packet = signedPacket(heardAt: now - 5 * hour);
    await a.gossip.publish(packet);
    now += 2 * hour;
    await net.connect('A', 'B');
    expect(b.store.length, 0);
    // Telefonda "yeraltında duyduklarım" olarak kalır.
    expect(a.store[packet.id], isNotNull);
    expect(a.store.pending(now), isEmpty);
  });

  test('alışverişi biten bağlantı boşta sayılır (kalabalıkta yer açmak için)', () async {
    final a = phone('A');
    phone('B');
    await net.connect('A', 'B');
    expect(a.gossip.idlePeers(const Duration(seconds: 30)), isEmpty);
    now += 31000;
    expect(a.gossip.idlePeers(const Duration(seconds: 30)), ['B']);
    await a.gossip.publish(signedPacket(heardAt: now));
    expect(a.gossip.idlePeers(const Duration(seconds: 30)), isEmpty);
  });

  test('bozuk ve sahte mesajlar yok sayılır', () async {
    final a = phone('A');
    phone('B');
    await net.connect('A', 'B');
    for (final raw in [
      'çöp',
      '[]',
      '{"t":"pkt","p":"a.b.c","h":0}',
      '{"t":"pkt","p":"x","h":-1}',
      '{"t":"inv","ids":"x"}',
    ]) {
      await net.links['B']!.send('A', Uint8List.fromList(utf8.encode(raw)));
    }
    await settle();
    expect(a.store.length, 0);
    expect(a.received, isEmpty);
  });

  test('depo dolunca önce en eski taşınan söz düşer, kendi sözün kalır', () {
    final store = MeshStore(capacity: 2);
    final own = signedPacket(clientId: 'clientid-own1', heardAt: now - 3 * hour);
    final old = signedPacket(clientId: 'clientid-old2', heardAt: now - 2 * hour, own: false);
    final fresh = signedPacket(clientId: 'clientid-new3', heardAt: now - hour, own: false);
    expect(store.add(own, now: now), isTrue);
    expect(store.add(old, now: now), isTrue);
    expect(store.add(fresh, now: now), isTrue);
    expect(store[own.id], isNotNull);
    expect(store[old.id], isNull);
    // Düşen söz yeniden istenmez.
    expect(store.knows(old.id), isTrue);
    expect(store.add(old, now: now), isFalse);
  });

  test('denetimden geçmeyen söz alınmaz, saklanmaz ve yayılmaz', () async {
    final a = phone('A');
    final b = phone('B', accept: (p) => !containsSlur(p.note.text));
    final c = phone('C');
    await net.connect('A', 'B');
    await net.connect('B', 'C');
    final bad = signedPacket(clientId: 'clientid-bad1', text: 'Vagondaki adam ibne dedi', heardAt: now);
    final good = signedPacket(clientId: 'clientid-good', heardAt: now);
    await a.gossip.publish(bad);
    await a.gossip.publish(good);
    await settle();
    expect(b.store[bad.id], isNull);
    expect(b.store.knows(bad.id), isTrue);
    expect(c.store[bad.id], isNull);
    expect(c.store[good.id]?.hops, 2);
    expect(b.received.map((p) => p.id), [good.id]);
    expect(b.log.any((line) => line.startsWith('Söz geri çevrildi')), isTrue);
  });

  test('teslim makbuzu yayılır: aynı sözü taşıyanlar artık göndermez, sonradan alan makbuzuyla alır', () async {
    final a = phone('A'), b = phone('B'), c = phone('C');
    await net.connect('A', 'B');
    await net.connect('B', 'C');
    final packet = signedPacket(heardAt: now);
    await a.gossip.publish(packet);
    await settle();
    expect(c.store.pending(now).single.id, packet.id);

    // A sinyal buldu, sözü ulaştırdı; makbuz B'den C'ye geçer.
    final receipt = receiptFor(packet.id);
    a.store.settle(packet.id, receipt);
    await a.gossip.announce([a.store[packet.id]!]);
    await settle();
    for (final phone in [b, c]) {
      expect(phone.store[packet.id]!.state, PacketState.delivered);
      expect(phone.store[packet.id]!.receipt, receipt);
      expect(phone.store.pending(now), isEmpty);
      expect(phone.settled, [packet.id]);
    }

    // Sonradan gelen D sözü makbuzuyla alır; hiç göndermeye kalkmaz.
    final d = phone('D');
    await net.connect('C', 'D');
    expect(d.store[packet.id]!.state, PacketState.delivered);
    expect(d.store.pending(now), isEmpty);

    // Elinde makbuzsuz kopya olan E bağlanınca envanterinden makbuzu alır.
    final e = phone('E');
    e.store.add(signedPacket(heardAt: now, own: false), now: now);
    await net.connect('E', 'D');
    expect(e.store[packet.id]!.state, PacketState.delivered);
  });

  test('uydurma ya da başka söze ait makbuz yok sayılır', () async {
    final a = phone('A'), b = phone('B');
    await net.connect('A', 'B');
    final packet = signedPacket(heardAt: now);
    await a.gossip.publish(packet);
    await settle();
    final other = signedPacket(clientId: 'clientid-0002', heardAt: now);
    final forged = receiptFor(packet.id, key: DeviceKey.generate());
    final valid = receiptFor(other.id);
    // Başka sözün geçerli imzası, bu sözün kimliğiyle.
    final swapped = '${receiptFor(packet.id).split('.').first}.${valid.split('.').last}';
    for (final receipt in [forged, valid, swapped, 'bozuk', 'a.b.c']) {
      for (final message in [
        {
          'v': 1,
          't': 'ack',
          'r': [receipt],
        },
        {'v': 1, 't': 'pkt', 'p': packet.payload, 'h': 0, 'k': receipt},
      ]) {
        await net.links['A']!.send('B', Uint8List.fromList(utf8.encode(jsonEncode(message))));
      }
    }
    await settle();
    expect(b.store[packet.id]!.state, PacketState.pending);
    expect(b.settled, isEmpty);
  });
}
