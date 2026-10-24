import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:overheard/app/app.dart';
import 'package:overheard/app/controller.dart';
import 'package:overheard/core/api.dart';
import 'package:overheard/core/storage.dart';
import 'package:overheard/mesh/courier.dart';
import 'package:overheard/mesh/mesh_store.dart';
import 'package:overheard/mesh/packet.dart';
import 'package:overheard/mesh/underground.dart';
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
        linkFactory: () => MemoryNetwork().join('A'),
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

    expect(find.text('“Kendi sözüm”'), findsOneWidget);
    expect(find.text('“Yanımdakinin sözü”'), findsOneWidget);
    expect(find.textContaining('passed through 2 phones'), findsOneWidget);
    expect(find.textContaining('waiting for signal'), findsNWidgets(2));
    expect(find.text('Off'), findsOneWidget);

    radio.granted = false;
    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();
    expect(find.text('Underground mode needs Bluetooth, nearby devices and location permissions.'), findsOneWidget);
    expect(app.underground.running, isFalse);

    radio.granted = true;
    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();
    expect(app.underground.running, isTrue);
    expect(radio.alive, isTrue);
    expect(find.text('On · looking for nearby phones'), findsOneWidget);
    await tester.runAsync(app.underground.stop);
  });
}
