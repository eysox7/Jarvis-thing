import 'dart:convert';

import '../core/b64.dart';
import 'device_key.dart';

// Sunucunun teslim makbuzu: "<veri>.<imza>" (base64url), veri {"i": ağdaki söz kimliği, "o": sunucudaki
// söz, "d": zaman}. Sunucu
// sözü kabul edince kendi anahtarıyla imzalar (POST /api/overheards/relay); makbuz Bluetooth ağında
// yayılır. Sunucunun açık anahtarı (/api/config receiptKey) telefonda saklıdır, doğrulama sinyalsiz
// yapılır: uydurma makbuzla kimse başkasının sözünü "ulaştı" diye yolda düşüremez.
abstract final class Receipt {
  static const maxLength = 600;

  // Makbuzun ait olduğu söz (imza denetlenmeden; önce elde o söz var mı diye bakmak için).
  static String? subject(String receipt) => _field(receipt, 'i');

  // Sözün sunucudaki kimliği (yazar sinyal bulunca sözünü açabilsin).
  static String? overheard(String receipt) => _field(receipt, 'o');

  static String? _field(String receipt, String name) {
    final parts = receipt.split('.');
    if (receipt.length > maxLength || parts.length != 2 || !parts.every(isB64url)) return null;
    try {
      final json = jsonDecode(utf8.decode(fromB64url(parts[0])));
      return json is Map && json[name] is String ? json[name] as String : null;
    } catch (_) {
      return null;
    }
  }

  // Sunucunun imzası mı ve makbuz [id] sözü için mi.
  static bool valid(String receipt, String id, Map<String, dynamic>? serverKey) {
    if (serverKey == null || subject(receipt) != id) return false;
    final parts = receipt.split('.');
    return DeviceKey.verify(serverKey, fromB64url(parts[0]), fromB64url(parts[1]));
  }
}
