import 'package:http/testing.dart';
import 'package:http/http.dart' as http;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:overheard/app/app.dart';
import 'package:overheard/app/controller.dart';
import 'package:overheard/core/api.dart';
import 'package:overheard/core/models.dart';
import 'package:overheard/core/storage.dart';
import 'package:overheard/mesh/courier.dart';
import 'package:overheard/mesh/mesh_store.dart';
import 'package:overheard/mesh/packet.dart';
import 'package:overheard/mesh/underground.dart';
import 'package:overheard/screens/me_screen.dart';
import 'package:overheard/screens/overheard_sheet.dart';
import 'package:overheard/screens/underground_screen.dart';

import 'support.dart';

void main() {
  late AppController app;
  late FakeRadio radio;

  setUp(() async {
    final api = Api(baseUrl: '');
    final store = MeshStore();
    final files = MemoryFiles();
    radio = FakeRadio();
    app = AppController(
      api: api,
      vault: MemoryVault(),
      files: files,
      locator: FakeLocator(),
      underground: Underground(
        store: store,
        files: files,
        linkFactory: (_) => MemoryNetwork().join('A'),
        radio: radio,
        courier: Courier(api, store),
      ),
    );
  });

  tearDown(() => app.dispose());

  testWidgets('giriş ekranı: sunucu adresi denetlenir', (tester) async {
    await tester.runAsync(app.boot);
    await tester.pumpWidget(OverheardApp(controller: app));
    await tester.pump();
    expect(find.text('👂 Overheard'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'overheard.local');
    await tester.tap(find.byType(FilledButton));
    await tester.pump();
    expect(find.text('The server address must start with https:// or http://.'), findsOneWidget);
  });

  testWidgets('yeraltı ekranı: bekleyen ve taşınan sözler okunur; izin yoksa açılmaz', (tester) async {
    final now = DateTime.now().millisecondsSinceEpoch;
    app.underground.store.add(
      signedPacket(clientId: 'clientid-own1', text: 'Kendi sözüm', heardAt: now - 60000),
      now: now,
    );
    final carried = MeshPacket.parse(
      signedPacket(
        clientId: 'clientid-other',
        text: 'Yanımdakinin sözü',
        heardAt: now - 120000,
        own: false,
        keyId: 'baskaAnahtar',
      ).payload,
      hops: 2,
      receivedAt: now,
    )!;
    app.underground.store.add(carried, now: now);
    await tester.pumpWidget(
      AppScope(
        controller: app,
        child: const MaterialApp(home: UndergroundScreen()),
      ),
    );

    expect(find.text('Off'), findsOneWidget);
    // İlk anahtar yeraltı modu, ikincisi otomatik mod.
    expect(find.byType(Switch), findsNWidgets(2));
    expect(find.text('Automatic'), findsOneWidget);

    radio.allowed = false;
    await tester.tap(find.byType(Switch).first);
    await tester.pumpAndSettle();
    expect(find.text('Underground mode needs Bluetooth, nearby devices and location permissions.'), findsOneWidget);
    expect(app.underground.running, isFalse);

    radio.allowed = true;
    await tester.tap(find.byType(Switch).first);
    await tester.pumpAndSettle();
    expect(app.underground.running, isTrue);
    expect(radio.alive, isTrue);
    expect(find.text('On · looking for nearby phones'), findsOneWidget);
    // Kilit ekranındaki bildirim kendi bekleyen sözünü de sayar.
    expect(radio.text, 'Overheards are passing to nearby phones · 1 of yours waiting for signal');

    await tester.scrollUntilVisible(find.text('“Yanımdakinin sözü”'), 200);
    expect(find.text('“Kendi sözüm”'), findsOneWidget);
    expect(find.textContaining('passed through 2 phones'), findsOneWidget);
    expect(find.textContaining('waiting for signal'), findsNWidgets(2));
    await tester.runAsync(app.underground.stop);
  });

  testWidgets('söz ayrıntısı: okunabilen sözde tepki, mesaj, şikâyet ve engelleme; kilitlide yok', (tester) async {
    Widget card(Overheard o) => AppScope(
      controller: app,
      child: MaterialApp(
        home: Scaffold(body: OverheardCard(overheard: o)),
      ),
    );
    const open = Overheard(
      id: 'o1',
      placeId: 'p',
      placeName: 'Kadıköy İskelesi',
      lat: 0,
      lng: 0,
      createdAt: 0,
      locked: false,
      text: 'Martılar da zam yaptı',
      author: 'yolcu',
      canMessage: true,
      offline: true,
      hops: 3,
      reactions: {'heart': 2},
    );
    await tester.pumpWidget(card(open));
    expect(find.text('“Martılar da zam yaptı”'), findsOneWidget);
    expect(find.text('Message'), findsOneWidget);
    expect(find.text('Report'), findsOneWidget);
    expect(find.text('Block'), findsOneWidget);
    expect(find.text('❤️ 2'), findsOneWidget);
    // "Ben de duydum" yalnızca o sırada orada olana.
    expect(find.textContaining('👂'), findsNothing);
    expect(find.text('Written offline · passed through 3 phones'), findsOneWidget);

    const locked = Overheard(
      id: 'o2',
      placeId: 'p',
      placeName: 'Moda Sahili',
      lat: 0,
      lng: 0,
      createdAt: 0,
      locked: true,
      length: 42,
    );
    await tester.pumpWidget(card(locked));
    expect(find.textContaining('Be at Moda Sahili to read it'), findsOneWidget);
    expect(find.text('Report'), findsNothing);
    expect(find.text('Message'), findsNothing);
  });

  testWidgets('profil: koşullar, gizlilik ve hesap silme', (tester) async {
    await tester.pumpWidget(
      AppScope(
        controller: app,
        child: const MaterialApp(home: MeScreen()),
      ),
    );
    expect(find.text('Terms of use'), findsOneWidget);
    expect(find.text('Privacy policy'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Delete my account'), 200);
    await tester.tap(find.text('Delete my account'));
    await tester.pumpAndSettle();
    expect(find.textContaining('permanently'), findsOneWidget);
  });

  testWidgets('yeraltı: gelen sözde kişisel veri maskelenir; günlük görünür', (tester) async {
    final now = DateTime.now().millisecondsSinceEpoch;
    final carried = MeshPacket.parse(
      signedPacket(
        clientId: 'clientid-pii1',
        text: 'Adam 0532 123 45 67 numarasını bağırdı',
        heardAt: now,
        own: false,
        keyId: 'baskaAnahtar',
      ).payload,
      hops: 1,
      receivedAt: now,
    )!;
    app.underground.store.add(carried, now: now);
    await tester.pumpWidget(
      AppScope(
        controller: app,
        child: const MaterialApp(home: UndergroundScreen()),
      ),
    );
    expect(find.textContaining('[telefon]'), findsOneWidget);
    expect(find.textContaining('0532'), findsNothing);
    await tester.scrollUntilVisible(find.text('Field log'), 200);
    expect(find.text('Field log'), findsOneWidget);
  });

  testWidgets('yeraltı: sunucuya ulaşmış söze dokununca sunucudaki hâli açılır', (tester) async {
    final api = Api(
      baseUrl: 'http://sunucu.test',
      client: MockClient(
        (request) async => http.Response(
          jsonEncode({
            'overheard': {
              'id': 'srv1',
              'placeId': 'ist-kadikoy-iskele',
              'placeName': 'Kadıköy İskelesi',
              'text': 'Sunucudaki söz',
              'offline': true,
              'hops': 1,
            },
          }),
          request.url.path == '/api/overheards/srv1' ? 200 : 404,
          headers: {'content-type': 'application/json; charset=utf-8'},
        ),
      ),
    );
    final store = MeshStore();
    final files = MemoryFiles();
    final online = AppController(
      api: api,
      vault: MemoryVault(),
      files: files,
      locator: FakeLocator(),
      underground: Underground(
        store: store,
        files: files,
        linkFactory: (_) => MemoryNetwork().join('A'),
        radio: FakeRadio(),
        courier: Courier(api, store),
      ),
    );
    addTearDown(online.dispose);
    final now = DateTime.now().millisecondsSinceEpoch;
    final packet = signedPacket(clientId: 'clientid-done', text: 'Yolda yazdım', heardAt: now - 60000);
    store.add(packet, now: now);
    packet
      ..state = PacketState.delivered
      ..overheardId = 'srv1';
    await tester.pumpWidget(
      AppScope(
        controller: online,
        child: const MaterialApp(home: UndergroundScreen()),
      ),
    );
    await tester.scrollUntilVisible(find.text('“Yolda yazdım”'), 200);
    await tester.tap(find.text('“Yolda yazdım”'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Sunucudaki söz'), findsOneWidget);
  });
}
