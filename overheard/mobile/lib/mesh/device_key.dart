import 'dart:math';
import 'dart:typed_data';

import 'package:pointycastle/export.dart';

import '../core/b64.dart';

// Cihazın imza anahtarı (ECDSA P-256, SHA-256). Web uygulamasındaki WebCrypto anahtarıyla aynı
// biçimdedir: açık yarısı JWK olarak sunucuya kaydedilir (POST /api/me/device-keys), imza r||s
// (64 bayt) olarak gönderilir. Özel yarı yalnızca bu telefonda, şifreli depoda durur.
class DeviceKey {
  DeviceKey._(this._d, this._q);

  final BigInt _d;
  final ECPoint _q;

  static final ECDomainParameters _curve = ECCurve_secp256r1();

  factory DeviceKey.generate([Random? random]) {
    final source = random ?? Random.secure();
    final seed = FortunaRandom()..seed(KeyParameter(Uint8List.fromList(List.generate(32, (_) => source.nextInt(256)))));
    final generator = ECKeyGenerator()..init(ParametersWithRandom(ECKeyGeneratorParameters(_curve), seed));
    final pair = generator.generateKeyPair();
    return DeviceKey._(pair.privateKey.d!, pair.publicKey.Q!);
  }

  factory DeviceKey.fromPrivate(String encoded) {
    final d = _toBigInt(fromB64url(encoded));
    return DeviceKey._(d, (_curve.G * d)!);
  }

  String get privateEncoded => b64url(_bytes32(_d));

  Map<String, String> get publicJwk => {
    'kty': 'EC',
    'crv': 'P-256',
    'x': b64url(_bytes32(_q.x!.toBigInteger()!)),
    'y': b64url(_bytes32(_q.y!.toBigInteger()!)),
  };

  // Belirlenimci imza (RFC 6979): aynı söz aynı imzayı alır, rastgele sayı üretecine güvenilmez.
  Uint8List sign(List<int> message) {
    final signer = ECDSASigner(SHA256Digest(), HMac(SHA256Digest(), 64))
      ..init(true, PrivateKeyParameter<ECPrivateKey>(ECPrivateKey(_d, _curve)));
    final signature = signer.generateSignature(Uint8List.fromList(message)) as ECSignature;
    return Uint8List.fromList([..._bytes32(signature.r), ..._bytes32(signature.s)]);
  }

  static bool verify(Map<String, dynamic> jwk, List<int> message, List<int> signature) {
    if (signature.length != 64) return false;
    try {
      final x = _toBigInt(fromB64url(jwk['x'] as String));
      final y = _toBigInt(fromB64url(jwk['y'] as String));
      final point = _curve.curve.createPoint(x, y);
      final verifier = ECDSASigner(SHA256Digest())
        ..init(false, PublicKeyParameter<ECPublicKey>(ECPublicKey(point, _curve)));
      final r = _toBigInt(signature.sublist(0, 32));
      final s = _toBigInt(signature.sublist(32));
      return verifier.verifySignature(Uint8List.fromList(message), ECSignature(r, s));
    } catch (_) {
      return false;
    }
  }

  static BigInt _toBigInt(List<int> bytes) =>
      bytes.fold(BigInt.zero, (value, byte) => (value << 8) | BigInt.from(byte));

  static Uint8List _bytes32(BigInt value) {
    final out = Uint8List(32);
    var v = value;
    for (var i = 31; i >= 0; i--) {
      out[i] = (v & BigInt.from(0xff)).toInt();
      v = v >> 8;
    }
    return out;
  }
}
