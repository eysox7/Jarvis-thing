import 'package:flutter/services.dart';

// Uygulamanın kendi Android katmanıyla (MeshPlugin.kt, MeshService.kt) konuşma kanalı. Olaylar tek
// bir yayında gelir: found, lost, initiated, connected, failed, disconnected, payload, log,
// stopRequested (bildirimdeki "Kapat").
class MeshChannel {
  MeshChannel({MethodChannel? methods, EventChannel? events})
    : _methods = methods ?? const MethodChannel('app.overheard/mesh'),
      _events = events ?? const EventChannel('app.overheard/mesh/events');

  final MethodChannel _methods;
  final EventChannel _events;
  Stream<Map<Object?, Object?>>? _stream;

  Stream<Map<Object?, Object?>> get events =>
      _stream ??= _events.receiveBroadcastStream().where((e) => e is Map).cast<Map<Object?, Object?>>();

  Future<T?> call<T>(String method, [Map<String, Object?>? arguments]) => _methods.invokeMethod<T>(method, arguments);
}
