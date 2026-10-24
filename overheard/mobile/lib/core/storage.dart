import 'dart:convert';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';

// Küçük ve gizli değerler: oturum çerezi, cihazın özel anahtarı, son konum ve check-in sonucu.
abstract class Vault {
  Future<String?> read(String key);
  Future<void> write(String key, String? value);
}

// Android Keystore ile şifrelenmiş depo.
class SecureVault implements Vault {
  const SecureVault();

  static const _storage = FlutterSecureStorage();

  @override
  Future<String?> read(String key) async {
    try {
      return await _storage.read(key: key);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(String key, String? value) =>
      value == null ? _storage.delete(key: key) : _storage.write(key: key, value: value);
}

class MemoryVault implements Vault {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String? value) async => value == null ? values.remove(key) : values[key] = value;
}

// Büyükçe JSON belgeler (kulaktan kulağa deposu, çevrimdışı gösterilecek son harita): uygulama klasöründe.
abstract class Files {
  Future<Map<String, dynamic>?> load(String name);
  Future<void> save(String name, Map<String, dynamic> json);
  Future<void> clear();
}

class DiskFiles implements Files {
  Future<File> _file(String name) async => File('${(await getApplicationSupportDirectory()).path}/$name.json');

  @override
  Future<Map<String, dynamic>?> load(String name) async {
    try {
      final file = await _file(name);
      if (!await file.exists()) return null;
      return jsonDecode(await file.readAsString()) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> save(String name, Map<String, dynamic> json) async {
    final file = await _file(name);
    final temp = File('${file.path}.tmp');
    await temp.writeAsString(jsonEncode(json), flush: true);
    await temp.rename(file.path);
  }

  @override
  Future<void> clear() async {
    final dir = await getApplicationSupportDirectory();
    await for (final entity in dir.list()) {
      if (entity is File && entity.path.endsWith('.json')) await entity.delete();
    }
  }
}

class MemoryFiles implements Files {
  final Map<String, String> docs = {};

  @override
  Future<Map<String, dynamic>?> load(String name) async =>
      docs[name] == null ? null : jsonDecode(docs[name]!) as Map<String, dynamic>;

  @override
  Future<void> save(String name, Map<String, dynamic> json) async => docs[name] = jsonEncode(json);

  @override
  Future<void> clear() async => docs.clear();
}
