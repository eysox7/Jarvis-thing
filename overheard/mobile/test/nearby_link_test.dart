// Uygulamanın Android katmanıyla (MeshPlugin.kt) konuşan bağlantı: kanal sahte bir Android tarafıyla
// denenir (yöntem çağrıları kaydedilir, olaylar elle gönderilir).
import 'dart:math';

import 'package:fake_async/fake_async.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:overheard/mesh/gossip.dart';
import 'package:overheard/mesh/mesh_channel.dart';
import 'package:overheard/mesh/nearby_link.dart';
import 'package:overheard/mesh/radio.dart';

class FakeAndroid {
  FakeAndroid() {
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(methods, (call) async {
      calls.add(call);
      return switch (call.method) {
        'start' => {'advertising': true, 'discovering': true},
        'connect' || 'send' => true,
        _ => null,
      };
    });
    messenger.setMockStreamHandler(events, MockStreamHandler.inline(onListen: (arguments, sink) => this.sink = sink));
  }

  static const methods = MethodChannel('test/mesh');
  static const events = EventChannel('test/mesh/events');
  final calls = <MethodCall>[];
  MockStreamHandlerEventSink? sink;

  MeshChannel get channel => MeshChannel(methods: methods, events: events);

  void emit(Map<String, Object?> event) => sink!.success(event);

  List<String> get names => calls.map((c) => c.method).toList();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('bulunan telefona bağlanır; bağlantı, mesaj ve kopma olaya dönüşür', () {
    fakeAsync((async) {
      final android = FakeAndroid();
      final log = <String>[];
      // Adı "oh-0..." olur: karşıdaki "oh-z..." telefona bekleme yapmadan bağlanır.
      final link = NearbyLink(channel: android.channel, onLog: log.add, random: _Zero());
      final events = <LinkEvent>[];
      link.events.listen(events.add);
      late bool started;
      link.start().then((v) => started = v);
      async.flushMicrotasks();
      expect(started, isTrue);
      expect(android.calls.first.arguments, {'name': link.name, 'serviceId': NearbyLink.serviceId});

      android.emit({'type': 'found', 'id': 'E1', 'name': 'oh-zzzzzz'});
      async.flushMicrotasks();
      async.elapse(Duration.zero);
      expect(android.names, ['start', 'connect']);
      expect(android.calls.last.arguments, {'id': 'E1'});

      android.emit({'type': 'initiated', 'id': 'E1', 'name': 'oh-zzzzzz'});
      android.emit({'type': 'connected', 'id': 'E1'});
      android.emit({
        'type': 'payload',
        'id': 'E1',
        'bytes': Uint8List.fromList([1, 2, 3]),
      });
      android.emit({'type': 'disconnected', 'id': 'E1'});
      async.flushMicrotasks();
      expect(events.map((e) => e.runtimeType), [PeerConnected, PeerMessage, PeerDisconnected]);
      expect((events[1] as PeerMessage).bytes, [1, 2, 3]);
      expect(log.any((l) => l.startsWith('Bağlandı: oh-zzzzzz')), isTrue);
    });
  });

  test('aynı anda bulunca adı büyük olan bekler; alışverişi biten telefona bir süre bağlanılmaz', () {
    fakeAsync((async) {
      final android = FakeAndroid();
      final link = NearbyLink(channel: android.channel, random: _Zero());
      link.start();
      async.flushMicrotasks();
      // Karşıdakinin adı küçük: o bağlanmalı; biz 4 sn bekleriz.
      android.emit({'type': 'found', 'id': 'E2', 'name': 'oh-000000'.replaceRange(3, 4, '/')});
      async.flushMicrotasks();
      async.elapse(const Duration(seconds: 3));
      expect(android.names, ['start']);
      async.elapse(const Duration(seconds: 2));
      expect(android.names, ['start', 'connect']);

      android.emit({'type': 'connected', 'id': 'E2'});
      async.flushMicrotasks();
      link.disconnect('E2');
      async.flushMicrotasks();
      expect(android.names.last, 'disconnect');
      // Bir dakika içinde yeniden bulunsa da bağlanılmaz.
      android.emit({'type': 'found', 'id': 'E3', 'name': 'oh-/00000'});
      async.flushMicrotasks();
      async.elapse(const Duration(seconds: 10));
      expect(android.names.where((n) => n == 'connect'), hasLength(1));
    });
  });

  test('gönderim başarısızsa hata verir (dedikodu katmanı yutar)', () async {
    final android = FakeAndroid();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      FakeAndroid.methods,
      (call) async => call.method == 'send' ? false : {'advertising': true, 'discovering': false},
    );
    final link = NearbyLink(channel: android.channel);
    expect(await link.start(), isTrue);
    await expectLater(link.send('E9', Uint8List(1)), throwsStateError);
  });

  test('bağlantı ve bildirim katmanı aynı kanalı birlikte dinler: ikisi de kendi olayını alır', () {
    fakeAsync((async) {
      final android = FakeAndroid();
      final channel = android.channel;
      final link = NearbyLink(channel: channel, random: _Zero());
      final radio = AndroidRadio(channel: channel, channelName: 'Yeraltı modu');
      final events = <LinkEvent>[];
      var stops = 0;
      link.events.listen(events.add);
      link.start();
      async.flushMicrotasks();
      // Yeraltı modu açılırken bildirim katmanı da dinlemeye başlar (Underground.start).
      radio.stopRequests.listen((_) => stops++);
      async.flushMicrotasks();
      android.emit({'type': 'connected', 'id': 'E1'});
      android.emit({'type': 'stopRequested'});
      async.flushMicrotasks();
      expect(events.single, isA<PeerConnected>());
      expect(stops, 1);
    });
  });
}

// Rastgele ad "oh-000000" olsun.
class _Zero implements Random {
  @override
  int nextInt(int max) => 0;

  @override
  bool nextBool() => false;

  @override
  double nextDouble() => 0;
}
