import 'package:flutter/material.dart';

import 'app/app.dart';
import 'app/controller.dart';
import 'core/api.dart';
import 'core/location.dart';
import 'core/storage.dart';
import 'mesh/courier.dart';
import 'mesh/mesh_store.dart';
import 'mesh/nearby_link.dart';
import 'mesh/radio.dart';
import 'mesh/underground.dart';

// Varsayılan sunucu derlemede verilebilir: flutter build apk --dart-define=OVERHEARD_URL=https://...
const _defaultServer = String.fromEnvironment('OVERHEARD_URL');

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final api = Api(baseUrl: _defaultServer);
  final store = MeshStore();
  final files = DiskFiles();
  final controller = AppController(
    api: api,
    vault: const SecureVault(),
    files: files,
    locator: const DeviceLocator(),
    defaultServer: _defaultServer,
    underground: Underground(
      store: store,
      files: files,
      linkFactory: (log) => NearbyLink(onLog: log),
      radio: AndroidRadio(),
      courier: Courier(api, store),
    ),
  );
  controller.boot();
  runApp(OverheardApp(controller: controller));
}
