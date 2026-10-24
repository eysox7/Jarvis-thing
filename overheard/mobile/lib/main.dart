import 'package:flutter/material.dart';

import 'app/app.dart';
import 'app/controller.dart';
import 'core/api.dart';
import 'core/google_auth.dart';
import 'core/location.dart';
import 'core/storage.dart';
import 'mesh/courier.dart';
import 'mesh/mesh_store.dart';
import 'mesh/nearby_link.dart';
import 'mesh/radio.dart';
import 'mesh/underground.dart';

// Varsayılan sunucu derlemede verilebilir: flutter build apk --dart-define=OVERHEARD_URL=https://...
const _defaultServer = String.fromEnvironment('OVERHEARD_URL');
// Bağlantı dosyası: asıl sunucunun adresi GitHub Pages'teki bu dosyadan öğrenilir (ayrıntı: README).
// Site ayrı bir depoda (eysox7/overheard) ya da bu deponun Pages'inde olabilir; ilk yanıt veren kullanılır.
const _connectUrl = String.fromEnvironment(
  'OVERHEARD_CONNECT',
  defaultValue: 'https://eysox7.github.io/overheard/connect.json,https://eysox7.github.io/Jarvis-thing/connect.json',
);

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
    connectUrl: _connectUrl,
    google: DeviceGoogleAuth(),
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
