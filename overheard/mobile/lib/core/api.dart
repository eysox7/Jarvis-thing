import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

// Sunucunun hata yanıtı ({error, ...ek alanlar}) ya da bağlantı yokluğu (status 0, "offline").
class ApiException implements Exception {
  ApiException(this.status, this.code, [this.extra = const {}]);

  final int status;
  final String code;
  final Map<String, dynamic> extra;

  bool get offline => status == 0;

  @override
  String toString() => 'ApiException($status, $code)';
}

// Overheard sunucusunun HTTP API'si (web uygulamasıyla aynı uçlar). Oturum web'deki gibi oh_session
// çerezidir; uygulama çerezi kendisi saklar ve her isteğe ekler.
class Api {
  Api({required this.baseUrl, this.session, http.Client? client, this.timeout = const Duration(seconds: 12)})
    : _client = client ?? http.Client();

  static const sessionCookie = 'oh_session';

  String baseUrl;
  String? session;
  final Duration timeout;
  final http.Client _client;
  // Oturum çerezi değiştiğinde (giriş, çıkış) kalıcı depoya yazmak için.
  void Function(String? session)? onSession;
  // Her istekte sunucuya ulaşılıp ulaşılamadığı (metroda bağlantının gidip geldiğini izlemek için).
  void Function(bool online)? onReachability;

  Future<Map<String, dynamic>> get(String path) => _send('GET', path);

  // Sunucu dışındaki bir adres (bağlantı dosyası); oturum çerezi gönderilmez.
  Future<Map<String, dynamic>> getUrl(String url) async {
    try {
      final response = await _client.get(Uri.parse(url), headers: {'accept': 'application/json'}).timeout(timeout);
      if (response.statusCode >= 400) throw ApiException(response.statusCode, 'http_${response.statusCode}');
      final data = jsonDecode(utf8.decode(response.bodyBytes));
      return data is Map<String, dynamic> ? data : <String, dynamic>{};
    } on ApiException {
      rethrow;
    } on Exception {
      throw ApiException(0, 'offline');
    }
  }

  // Bir adrese ulaşılabiliyor mu (yanıt gövdesine bakılmaz; ör. Android'in 204 dönen bağlantı denetimi).
  Future<bool> reachable(String url) async {
    try {
      final response = await _client.get(Uri.parse(url)).timeout(const Duration(seconds: 6));
      return response.statusCode < 400;
    } on Exception {
      return false;
    }
  }

  Future<Map<String, dynamic>> post(String path, [Map<String, Object?> body = const {}]) => _send('POST', path, body);

  Future<Map<String, dynamic>> _send(String method, String path, [Object? body]) async {
    final request = http.Request(method, Uri.parse('$baseUrl$path'))..headers['accept'] = 'application/json';
    if (session != null) request.headers['cookie'] = '$sessionCookie=$session';
    if (body != null) {
      request.headers['content-type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    http.Response response;
    try {
      response = await _client.send(request).then(http.Response.fromStream).timeout(timeout);
    } on Exception {
      // Zaman aşımı, DNS, soket, TLS: hepsi "bağlantı yok" demektir (metroda olağan).
      onReachability?.call(false);
      throw ApiException(0, 'offline');
    }
    onReachability?.call(true);
    _readSession(response.headers['set-cookie']);
    Object? data;
    try {
      data = response.bodyBytes.isEmpty ? null : jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      data = null;
    }
    final json = data is Map<String, dynamic> ? data : <String, dynamic>{};
    if (response.statusCode >= 400) {
      throw ApiException(response.statusCode, json['error'] as String? ?? 'http_${response.statusCode}', json);
    }
    return json;
  }

  void _readSession(String? header) {
    if (header == null) return;
    final match = RegExp('$sessionCookie=([^;,]*)').firstMatch(header);
    if (match == null) return;
    final value = match.group(1)!;
    session = value.isEmpty ? null : value;
    onSession?.call(session);
  }
}
