import 'dart:convert';
import 'dart:typed_data';

// Dolgusuz base64url (web uygulaması ve sunucuyla aynı biçim).
String b64url(List<int> bytes) => base64Url.encode(bytes).replaceAll('=', '');

Uint8List fromB64url(String text) => base64Url.decode(base64Url.normalize(text));

final _b64urlRe = RegExp(r'^[\w-]+$');

bool isB64url(String text) => _b64urlRe.hasMatch(text);
