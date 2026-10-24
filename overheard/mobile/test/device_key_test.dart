import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:overheard/core/b64.dart';
import 'package:overheard/mesh/device_key.dart';

void main() {
  test('imza açık anahtarla doğrulanır; metin değişince tutmaz', () {
    final key = DeviceKey.generate();
    final message = utf8.encode('{"t":"Vagonda biri"}');
    final signature = key.sign(message);
    expect(signature.length, 64);
    expect(DeviceKey.verify(key.publicJwk, message, signature), isTrue);
    expect(DeviceKey.verify(key.publicJwk, utf8.encode('{"t":"Vagonda bir"}'), signature), isFalse);
    expect(DeviceKey.verify(DeviceKey.generate().publicJwk, message, signature), isFalse);
  });

  test('JWK web uygulamasının biçiminde; özel anahtar saklanıp geri yüklenir', () {
    final key = DeviceKey.generate();
    final jwk = key.publicJwk;
    expect(jwk['kty'], 'EC');
    expect(jwk['crv'], 'P-256');
    expect(fromB64url(jwk['x']!).length, 32);
    expect(fromB64url(jwk['y']!).length, 32);
    expect(jwk.containsKey('d'), isFalse);
    final restored = DeviceKey.fromPrivate(key.privateEncoded);
    expect(restored.publicJwk, jwk);
    // Belirlenimci imza (RFC 6979): aynı anahtar ve metin, aynı imza.
    final message = utf8.encode('aynı söz');
    expect(restored.sign(message), key.sign(message));
  });
}
