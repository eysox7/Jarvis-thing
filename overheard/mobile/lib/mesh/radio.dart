import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:permission_handler/permission_handler.dart';

// Yeraltı modunun Android tarafı: izinler ve telefon cepteyken de süren (kalıcı bildirimli) hizmet.
abstract class MeshRadio {
  Future<bool> permit();
  Future<void> keepAlive({required String title, required String text});
  Future<void> update({required String title, required String text});
  Future<void> release();
}

class AndroidRadio implements MeshRadio {
  AndroidRadio() {
    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: 'underground',
        channelName: 'Yeraltı modu',
        channelDescription: 'Kulaktan kulağa söz aktarımı sürerken görünür.',
        onlyAlertOnce: true,
      ),
      iosNotificationOptions: const IOSNotificationOptions(showNotification: false),
      foregroundTaskOptions: ForegroundTaskOptions(
        eventAction: ForegroundTaskEventAction.nothing(),
        allowWakeLock: true,
      ),
    );
  }

  // Android 12+ Bluetooth (tara, duyur, bağlan); Nearby eski sürümlerde konum ister. Wi-Fi ve bildirim
  // izni olmasa da (yalnızca Bluetooth ile, bildirimsiz) çalışır.
  @override
  Future<bool> permit() async {
    const required = [
      Permission.locationWhenInUse,
      Permission.bluetoothScan,
      Permission.bluetoothAdvertise,
      Permission.bluetoothConnect,
    ];
    final statuses = await [...required, Permission.nearbyWifiDevices, Permission.notification].request();
    return required.every((p) => statuses[p]?.isGranted ?? false);
  }

  @override
  Future<void> keepAlive({required String title, required String text}) async {
    if (await FlutterForegroundTask.isRunningService) return update(title: title, text: text);
    await FlutterForegroundTask.startService(
      serviceId: 7,
      serviceTypes: const [ForegroundServiceTypes.connectedDevice],
      notificationTitle: title,
      notificationText: text,
    );
  }

  @override
  Future<void> update({required String title, required String text}) async {
    if (await FlutterForegroundTask.isRunningService) {
      await FlutterForegroundTask.updateService(notificationTitle: title, notificationText: text);
    }
  }

  @override
  Future<void> release() async {
    if (await FlutterForegroundTask.isRunningService) await FlutterForegroundTask.stopService();
  }
}
