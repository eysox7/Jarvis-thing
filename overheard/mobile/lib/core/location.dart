import 'package:geolocator/geolocator.dart';

// Bir konum ölçümü. Çevrimdışı sözde "o sırada oradaydım" kanıtı olarak [enlem, boylam, doğruluk,
// zaman] biçiminde gider (sunucudaki readFix ile aynı).
class Fix {
  const Fix(this.lat, this.lng, this.accuracy, this.at);

  final double lat;
  final double lng;
  final double accuracy;
  final int at;

  List<num> toProof() => [_round5(lat), _round5(lng), accuracy.round(), at];

  Map<String, num> toCoords() => {'lat': lat, 'lng': lng, 'accuracy': accuracy};

  Map<String, num> toJson() => {'lat': lat, 'lng': lng, 'accuracy': accuracy, 'at': at};

  static Fix? fromJson(Object? j) => j is Map && j['lat'] is num && j['lng'] is num
      ? Fix(
          (j['lat'] as num).toDouble(),
          (j['lng'] as num).toDouble(),
          ((j['accuracy'] as num?) ?? 9999).toDouble(),
          ((j['at'] as num?) ?? 0).toInt(),
        )
      : null;

  static double _round5(double v) => (v * 100000).round() / 100000;
}

abstract class Locator {
  Future<Fix?> current({Duration timeout});
}

class DeviceLocator implements Locator {
  const DeviceLocator();

  // İzin yoksa ister. Konum kapalıysa, izin verilmezse ya da (tünelde) zamanında konum gelmezse null.
  @override
  Future<Fix?> current({Duration timeout = const Duration(seconds: 15)}) async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return null;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) return null;
      final position = await Geolocator.getCurrentPosition(
        locationSettings: LocationSettings(accuracy: LocationAccuracy.high, timeLimit: timeout),
      );
      return Fix(position.latitude, position.longitude, position.accuracy, position.timestamp.millisecondsSinceEpoch);
    } catch (_) {
      return null;
    }
  }
}
