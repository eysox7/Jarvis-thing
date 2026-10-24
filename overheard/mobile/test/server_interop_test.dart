// Uygulamayı gerçek Overheard sunucusuna (../server) karşı çalıştırır: metroda yazılan söz Dart'ta
// imzalanır, bellek içi "Bluetooth" ile başka telefona geçer, o telefon sunucuya ulaştırır ve Node
// sunucusu imzayı doğrular. node bulunamazsa atlanır.
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:overheard/app/controller.dart';
import 'package:overheard/core/api.dart';
import 'package:overheard/core/b64.dart';
import 'package:overheard/core/location.dart';
import 'package:overheard/core/models.dart';
import 'package:overheard/core/storage.dart';
import 'package:overheard/mesh/courier.dart';
import 'package:overheard/mesh/mesh_store.dart';
import 'package:overheard/mesh/packet.dart';
import 'package:overheard/mesh/underground.dart';

import 'support.dart';

// Demo verisindeki Kadıköy İskelesi (yarıçap 150 m).
const _pier = (lat: 40.9925, lng: 29.0236);
const _unreachable = 'http://127.0.0.1:9';

void main() {
  final root = Directory.current.parent.path;
  final hasServer = File('$root/server/index.js').existsSync() && Process.runSync('which', ['node']).exitCode == 0;
  Process? server;
  Directory? temp;
  late String base;
  late MemoryNetwork net;
  final apps = <AppController>[];

  setUpAll(() async {
    if (!hasServer) return;
    temp = await Directory.systemTemp.createTemp('overheard-interop');
    final port = 20000 + Random().nextInt(20000);
    base = 'http://127.0.0.1:$port';
    server = await Process.start(
      'node',
      ['server/index.js'],
      workingDirectory: root,
      environment: {
        'PORT': '$port',
        'OVERHEARD_DB': '${temp!.path}/test.db',
        'OVERHEARD_DEMO': 'true',
        'OVERHEARD_AI_MODERATION': 'false',
        // Sunucu testlerindeki gibi: aynı adresten çok sayıda hesap açılır.
        'OVERHEARD_RATE_SCALE': '100',
      },
    );
    server!.stdout.drain<void>();
    server!.stderr.drain<void>();
    final client = HttpClient();
    for (var i = 0; i < 100; i++) {
      try {
        final response = await (await client.getUrl(Uri.parse('$base/healthz'))).close();
        await response.drain<void>();
        if (response.statusCode == 200) break;
      } catch (_) {}
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    client.close();
  });

  tearDownAll(() async {
    server?.kill();
    await server?.exitCode;
    await temp?.delete(recursive: true);
  });

  setUp(() => net = MemoryNetwork());

  tearDown(() {
    for (final app in apps) {
      app.dispose();
    }
    apps.clear();
  });

  Future<AppController> phone(String name, String handle) async {
    final api = Api(baseUrl: base);
    final store = MeshStore();
    final files = MemoryFiles();
    final vault = MemoryVault()..values['server'] = base;
    final app = AppController(
      api: api,
      vault: vault,
      files: files,
      locator: FakeLocator(Fix(_pier.lat, _pier.lng, 12, DateTime.now().millisecondsSinceEpoch)),
      underground: Underground(
        store: store,
        files: files,
        linkFactory: (_) => net.join(name),
        radio: FakeRadio(),
        courier: Courier(api, store),
      ),
    );
    apps.add(app);
    await app.boot();
    await app.register(handle, 'metro-parola-1');
    await app.refresh();
    expect(app.hasKey, isTrue);
    return app;
  }

  String unique(String prefix) => '${prefix}_${Random().nextInt(1 << 30).toRadixString(36)}';

  group('sunucuyla', skip: hasServer ? false : 'node bulunamadı', () {
    test('metroda yazılan söz telefondan telefona geçer; taşıyan ulaştırır, sunucu imzayı doğrular', () async {
      final author = await phone('A', unique('yazar'));
      final carrier = await phone('B', unique('tasiyan'));

      // İskelede check-in (bağlıyken), sonra tünel: konum yok, sunucuya ulaşılamıyor.
      final presence = await author.checkIn();
      final pier = presence.places.firstWhere((p) => p.id == 'ist-kadikoy-iskele');
      (author.locator as FakeLocator).fix = null;
      author.api.baseUrl = _unreachable;
      final outcome = await author.compose(text: 'Vapurda biri: "Martılar da zam yaptı."', place: pier, public: true);
      expect(outcome.viaMesh, isTrue);
      expect(author.underground.waiting, 1);

      // Yeraltı modu ikisinde de açık; Bluetooth menziline girdiler.
      expect(await author.underground.start(), UndergroundStart.ok);
      expect(await carrier.underground.start(), UndergroundStart.ok);
      await net.connect('A', 'B');
      expect(carrier.underground.carried, 1);
      final carried = carrier.underground.packets.single;
      expect(carried.hops, 1);
      expect(carried.note.text, 'Vapurda biri: "Martılar da zam yaptı."');

      // Taşıyanın bağlantısı var: söz sunucuya onun eliyle ulaşır.
      expect(await carrier.underground.flush(), 1);
      expect(carried.state, PacketState.delivered);

      author.api.baseUrl = base;
      final overheard = await author.overheard(carried.overheardId!);
      expect(overheard.mine, isTrue);
      expect(overheard.offline, isTrue);
      expect(overheard.hops, 1);
      expect(overheard.placeId, 'ist-kadikoy-iskele');
      expect(overheard.public, isTrue);

      // Yazar sonra bağlanınca kendi kopyası da "ulaştı" olur (sunucu aynı sözü ikinci kez yazmaz).
      expect(await author.underground.flush(), 1);
      expect(author.underground.packets.single.state, PacketState.delivered);
      expect(author.underground.packets.single.overheardId, carried.overheardId);
    });

    test('yolda değiştirilen söz reddedilir; taşıyan bir daha göndermez', () async {
      final author = await phone('A', unique('yazar'));
      final carrier = await phone('B', unique('tasiyan'));
      final presence = await author.checkIn();
      final pier = presence.places.firstWhere((p) => p.id == 'ist-kadikoy-iskele');
      author.api.baseUrl = _unreachable;
      (author.locator as FakeLocator).fix = null;
      final outcome = await author.compose(text: 'Orijinal söz burada', place: pier);
      final parts = outcome.packet!.payload.split('.');
      final data = jsonDecode(utf8.decode(fromB64url(parts[0]))) as Map<String, dynamic>;
      data['t'] = 'Değiştirilmiş söz burada';
      final forged = MeshPacket.parse(
        '${b64url(utf8.encode(jsonEncode(data)))}.${parts[1]}.${parts[2]}',
        hops: 1,
        receivedAt: DateTime.now().millisecondsSinceEpoch,
      )!;
      carrier.underground.store.add(forged, now: DateTime.now().millisecondsSinceEpoch);
      expect(await carrier.underground.flush(), 0);
      expect(forged.state, PacketState.failed);
      expect(forged.error, 'bad_signature');
    });

    test('o sırada orada olmayanın sözü ulaşır ama sunucu kabul etmez', () async {
      final author = await phone('A', unique('yazar'));
      final carrier = await phone('B', unique('tasiyan'));
      // İskelede check-in var ama söz Ankara'daki bir mekâna yazılmış gibi.
      final presence = await author.checkIn();
      final pier = presence.places.firstWhere((p) => p.id == 'ist-kadikoy-iskele');
      final elsewhere = await Api(baseUrl: base).get('/api/cities/ankara/map');
      final place = (elsewhere['places'] as List).first as Map<String, dynamic>;
      author.api.baseUrl = _unreachable;
      (author.locator as FakeLocator).fix = null;
      expect(pier.id, 'ist-kadikoy-iskele');
      final outcome = await author.compose(
        text: 'Ankara\'da olmadığım hâlde',
        place: Place(id: place['id'] as String, name: place['name'] as String, lat: 0, lng: 0),
      );
      await author.underground.start();
      await carrier.underground.start();
      await net.connect('A', 'B');
      expect(await carrier.underground.flush(), 0);
      final carried = carrier.underground.packets.single;
      expect(carried.id, outcome.packet!.id);
      expect(carried.state, PacketState.failed);
      expect(carried.error, 'not_there_then');
    });

    test('tepki, mesaj ve yanıt; okunmamış rozeti', () async {
      final author = await phone('A', unique('yazar'));
      final reader = await phone('B', unique('okur'));
      await author.checkIn();
      final pier = author.composePlaces().firstWhere((p) => p.id == 'ist-kadikoy-iskele');
      final posted = await author.compose(text: 'İskelede biri: "Simit de artık abonelikle."', place: pier);
      expect(posted.viaMesh, isFalse);
      final id = posted.overheard!.id;

      await reader.checkIn();
      var seen = await reader.overheard(id);
      expect(seen.locked, isFalse);
      expect(seen.canMessage, isTrue);
      seen = await reader.react(id, 'heart');
      expect(seen.reactions['heart'], 1);
      expect(seen.myReactions, ['heart']);

      final conversationId = await reader.messageAbout(id, 'Ben de oradaydım, çok güldüm!');
      await author.refreshProfile();
      expect(author.profile.unread, 1);
      final list = await author.conversations();
      expect(list.single.id, conversationId);
      expect(list.single.unread, isTrue);
      final chat = await author.conversation(conversationId);
      expect(chat.role, 'owner');
      expect(chat.messages.single.body, 'Ben de oradaydım, çok güldüm!');
      await author.sendMessage(conversationId, 'Simitçi abi efsane');
      final back = await reader.conversation(conversationId);
      expect(back.messages.map((m) => (m.body, m.fromMe)), [
        ('Ben de oradaydım, çok güldüm!', true),
        ('Simitçi abi efsane', false),
      ]);
      expect((await author.conversations()).single.unread, isFalse);
    });

    test('şikâyet ve engelleme: engellenenin sözleri haritadan kalkar, yazışılamaz', () async {
      final author = await phone('A', unique('yazar'));
      final reader = await phone('B', unique('okur'));
      await author.checkIn();
      final pier = author.composePlaces().firstWhere((p) => p.id == 'ist-kadikoy-iskele');
      final id = (await author.compose(text: 'İskelede biri: "Vapur da tatile çıkmış."', place: pier)).overheard!.id;
      await reader.checkIn();
      await reader.report(id);
      await reader.blockAuthor(id);
      await reader.loadCity('istanbul');
      expect(reader.map!.overheards.any((o) => o.id == id), isFalse);
      await expectLater(
        reader.messageAbout(id, 'merhaba'),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', anyOf(403, 404))),
      );
    });

    test('hesap silme: sunucudaki hesap ve telefondaki her şey gider', () async {
      final handle = unique('silinen');
      final app = await phone('A', handle);
      await app.checkIn();
      final pier = app.composePlaces().firstWhere((p) => p.id == 'ist-kadikoy-iskele');
      app.api.baseUrl = _unreachable;
      (app.locator as FakeLocator).fix = null;
      await app.compose(text: 'Silinecek bir söz burada', place: pier);
      expect(app.underground.packets, isNotEmpty);
      app.api.baseUrl = base;
      await expectLater(app.deleteAccount('yanlış parola'), throwsA(isA<ApiException>()));
      expect(app.me, isNotNull);
      await app.deleteAccount('metro-parola-1');
      expect(app.me, isNull);
      expect(app.hasKey, isFalse);
      expect(app.underground.packets, isEmpty);
      expect(await app.vault.read('device_key'), isNull);
      await expectLater(
        app.signIn(handle, 'metro-parola-1'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'bad_credentials')),
      );
    });
  });
}
