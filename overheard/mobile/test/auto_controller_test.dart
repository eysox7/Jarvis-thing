// Otomatik yeraltı modu uygulama düzeyinde: bağlantı kopunca açılır, bildirimden kapatılınca o
// yolculukta yeniden açılmaz, bağlantı dönüp hattan inince kendi açtığını kapatır.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:overheard/app/controller.dart';
import 'package:overheard/core/api.dart';
import 'package:overheard/core/storage.dart';
import 'package:overheard/mesh/courier.dart';
import 'package:overheard/mesh/mesh_store.dart';
import 'package:overheard/mesh/underground.dart';

import 'support.dart';

void main() {
  late HttpServer server;
  late String online;
  const offline = 'http://127.0.0.1:9';
  var now = 1700000000000;
  late FakeRadio radio;
  late AppController app;

  // [connectivity]: genel internet denetiminin adresi (varsayılan: o da yok, yani metro).
  Future<void> build({String connectivity = '$offline/generate_204'}) async {
    radio = FakeRadio();
    final api = Api(baseUrl: offline);
    final store = MeshStore();
    final files = MemoryFiles();
    final vault = MemoryVault()
      ..values['server'] = offline
      ..values['session'] = 'oturum'
      ..values['me'] = jsonEncode({'handle': 'yolcu'});
    app = AppController(
      api: api,
      vault: vault,
      files: files,
      locator: FakeLocator(),
      clock: () => now,
      connectivityUrl: connectivity,
      underground: Underground(
        store: store,
        files: files,
        linkFactory: (_) => MemoryNetwork().join('A'),
        radio: radio,
        courier: Courier(api, store),
        clock: () => now,
      ),
    );
    await app.boot();
  }

  setUp(() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) {
      request.response
        ..headers.contentType = ContentType.json
        ..write(jsonEncode(request.uri.path == '/healthz' ? {'ok': true} : {'user': null}))
        ..close();
    });
    online = 'http://127.0.0.1:${server.port}';
    await build();
  });

  tearDown(() async {
    if (app.underground.running) await app.underground.stop();
    app.dispose();
    await server.close(force: true);
  });

  test('bağlantı 30 sn yoksa kendiliğinden açılır; izin sorulmaz', () async {
    await app.autoTick(probe: true);
    expect(app.online, isFalse);
    expect(app.underground.running, isFalse);
    now += 31000;
    await app.autoTick(probe: true);
    expect(app.underground.running, isTrue);
    expect(app.underground.startedByAuto, isTrue);
    expect(radio.prompts, 0);
    expect(radio.alive, isTrue);
  });

  test('izin hiç verilmemişse ya da ekran arkadaysa açılmaz', () async {
    radio.allowed = false;
    await app.autoTick(probe: true);
    now += 31000;
    await app.autoTick(probe: true);
    expect(app.underground.running, isFalse);
    radio.allowed = true;
    app.foreground = false;
    await app.autoTick(probe: true);
    expect(app.underground.running, isFalse);
  });

  test('bildirimden kapatılınca bu yolculukta yeniden açılmaz', () async {
    await app.autoTick(probe: true);
    now += 31000;
    await app.autoTick(probe: true);
    expect(app.underground.running, isTrue);
    radio.stops.add(null);
    await settle();
    expect(app.underground.running, isFalse);
    now += 5 * 60000;
    await app.autoTick(probe: true);
    expect(app.underground.running, isFalse);
  });

  test('bağlantı dönüp 10 dk geçince (hatta değilsen) kapanır; arka planda bildirim açılamasa da çalışır', () async {
    radio.canKeepAlive = false;
    await app.autoTick(probe: true);
    now += 31000;
    await app.autoTick(probe: true);
    expect(app.underground.running, isTrue);
    expect(app.underground.log.any((l) => l.message.startsWith('Kalıcı bildirim açılamadı')), isTrue);

    app.api.baseUrl = online;
    await app.autoTick(probe: true);
    expect(app.online, isTrue);
    now += 5 * 60000;
    await app.autoTick(probe: true);
    expect(app.underground.running, isTrue);
    now += 6 * 60000;
    await app.autoTick(probe: true);
    expect(app.underground.running, isFalse);
  });

  test('elle açılan modu otomatik kapatmaz; ayar kapalıyken açmaz', () async {
    expect(await app.startUnderground(), UndergroundStart.ok);
    expect(radio.prompts, 1);
    app.api.baseUrl = online;
    await app.autoTick(probe: true);
    now += 20 * 60000;
    await app.autoTick(probe: true);
    expect(app.underground.running, isTrue);

    await app.stopUnderground();
    await app.setAutoUnderground(false);
    expect(await app.vault.read('auto_underground'), '0');
    app.api.baseUrl = offline;
    await app.autoTick(probe: true);
    now += 60000;
    await app.autoTick(probe: true);
    expect(app.underground.running, isFalse);
  });

  test('sunucu çöktü ama internet var: metro sayılmaz, açılmaz', () async {
    app.dispose();
    await build(connectivity: '$online/generate_204');
    await app.autoTick(probe: true);
    now += 31000;
    await app.autoTick(probe: true);
    now += 31000;
    await app.autoTick(probe: true);
    expect(app.online, isTrue);
    expect(app.underground.running, isFalse);
  });
}
