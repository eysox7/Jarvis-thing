import 'dart:async';

import 'package:permission_handler/permission_handler.dart';

import 'mesh_channel.dart';

// Yeraltı modunun Android tarafı: izinler ve telefon cepteyken de süren (kalıcı bildirimli) hizmet.
abstract class MeshRadio {
  // İzin ister (kullanıcıya sorar).
  Future<bool> permit();
  // İzinler zaten verilmiş mi (sormaz; otomatik mod bununla karar verir).
  Future<bool> granted();
  // Hizmeti başlatır ya da bildirimini günceller; arka planda başlatılamazsa false.
  Future<bool> keepAlive({required String title, required String text, required String stop});
  Future<void> release();
  // Bildirimdeki "Kapat" düğmesi.
  Stream<void> get stopRequests;
}

class AndroidRadio implements MeshRadio {
  AndroidRadio({MeshChannel? channel, required this.channelName}) : _channel = channel ?? MeshChannel();

  final MeshChannel _channel;
  final String channelName;

  // Android 12+ Bluetooth (tara, duyur, bağlan); Nearby eski sürümlerde konum ister. Wi-Fi ve bildirim
  // izni olmasa da (yalnızca Bluetooth ile, bildirimsiz) çalışır.
  static const _required = [
    Permission.locationWhenInUse,
    Permission.bluetoothScan,
    Permission.bluetoothAdvertise,
    Permission.bluetoothConnect,
  ];

  @override
  Future<bool> permit() async {
    final statuses = await [..._required, Permission.nearbyWifiDevices, Permission.notification].request();
    return _required.every((p) => statuses[p]?.isGranted ?? false);
  }

  @override
  Future<bool> granted() async {
    for (final permission in _required) {
      if (!await permission.isGranted) return false;
    }
    return true;
  }

  @override
  Future<bool> keepAlive({required String title, required String text, required String stop}) async =>
      await _channel.call<bool>('keepAlive', {'title': title, 'text': text, 'stop': stop, 'channel': channelName}) ??
      false;

  @override
  Future<void> release() => _channel.call<void>('release');

  @override
  Stream<void> get stopRequests => _channel.events.where((e) => e['type'] == 'stopRequested');
}
