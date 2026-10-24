import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:overheard/core/b64.dart';
import 'package:overheard/mesh/device_key.dart';
import 'package:overheard/mesh/packet.dart';

import 'support.dart';

void main() {
  test('paket "<veri>.<anahtar>.<imza>" biçiminde, alanlar web uygulamasıyla aynı', () {
    final packet = signedPacket(heardAt: 1700000000000);
    final parts = packet.payload.split('.');
    expect(parts, hasLength(3));
    expect(parts[1], testKeyId);
    final data = jsonDecode(utf8.decode(fromB64url(parts[0]))) as Map<String, dynamic>;
    expect(data.keys, ['c', 'p', 'n', 't', 'h', 'v', 'a', 'e', 'f', 'u']);
    expect(data['v'], 'l');
    expect(DeviceKey.verify(testKey.publicJwk, fromB64url(parts[0]), fromB64url(parts[2])), isTrue);
    expect(packet.id, '$testKeyId:clientid-0001');
    expect(packet.note.placeName, 'M4 Kadıköy–Sabiha Gökçen');
    expect(packet.note.author, 'yolcu');
  });

  test('anonim sözde yazar adı pakete girmez', () {
    final note = MeshNote(
      clientId: 'clientid-anon',
      placeId: 'p',
      placeName: 'P',
      text: 'gizli',
      heardAt: 1,
      anonymous: true,
      author: 'yolcu',
    );
    final packet = MeshPacket.parse(MeshPacket.sign(note, testKey, testKeyId), receivedAt: 1)!;
    expect(packet.note.author, isNull);
    expect(packet.note.anonymous, isTrue);
  });

  test('bozuk paketler reddedilir', () {
    final good = signedPacket(heardAt: 1).payload;
    final data = good.split('.').first;
    for (final bad in [
      '',
      'a.b',
      'a.b.c.d',
      'bad!.$testKeyId.sig',
      '${b64url(utf8.encode('{"c":"kisa","p":"x","t":"y","h":1}'))}.$testKeyId.sig',
      '${b64url(utf8.encode('[1,2]'))}.$testKeyId.sig',
      '${b64url(utf8.encode('{"c":"clientid-0001","p":"x","t":"","h":1}'))}.$testKeyId.sig',
      '$data.${'k' * 41}.sig',
    ]) {
      expect(MeshPacket.parse(bad, receivedAt: 0), isNull, reason: bad);
    }
  });

  test('depoya yazılıp okunur (durum, hata, söz kimliği)', () {
    final packet = signedPacket(heardAt: 5)
      ..state = PacketState.failed
      ..error = 'not_there_then';
    final copy = MeshPacket.fromJson(jsonDecode(jsonEncode(packet.toJson())) as Map<String, dynamic>)!;
    expect(copy.payload, packet.payload);
    expect(copy.state, PacketState.failed);
    expect(copy.error, 'not_there_then');
    expect(copy.own, isTrue);
  });
}
