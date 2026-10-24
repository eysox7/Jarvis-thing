import 'dart:convert';

import '../core/b64.dart';
import 'device_key.dart';

// Kulaktan kulağa taşınan söz. Yazarın telefonunda imzalanır: "<veri>.<anahtar>.<imza>" (base64url).
// Biçim web uygulamasınınkiyle aynıdır; sunucu imzayı yazarın kayıtlı cihaz anahtarıyla doğrular
// (POST /api/overheards/relay). Taşıyan telefon sözü değiştiremez, başkası adına söz uyduramaz.
class MeshNote {
  const MeshNote({
    required this.clientId,
    required this.placeId,
    required this.placeName,
    required this.text,
    required this.heardAt,
    this.public = false,
    this.anonymous = false,
    this.ephemeral = false,
    this.fix,
    this.author,
  });

  final String clientId;
  final String placeId;
  final String placeName;
  final String text;
  final int heardAt;
  final bool public;
  final bool anonymous;
  final bool ephemeral;
  // [enlem, boylam, doğruluk (m), zaman (ms)]: yazarken alınmış iyi bir konum varsa.
  final List<num>? fix;
  // Anonim değilse yazarın kullanıcı adı (yalnızca taşıyanın ekranı için; sunucu kendi kaydına bakar).
  final String? author;

  static final _clientIdRe = RegExp(r'^[\w-]{8,40}$');

  // Kısa alan adları web uygulamasıyla aynı (QR'a sığsın diye seçilmişti).
  Map<String, dynamic> toJson() => {
    'c': clientId,
    'p': placeId,
    'n': placeName,
    't': text,
    'h': heardAt,
    'v': public ? 'p' : 'l',
    'a': anonymous ? 1 : 0,
    'e': ephemeral ? 1 : 0,
    'f': fix,
    'u': anonymous ? null : author,
  };

  static MeshNote? fromJson(Object? json) {
    if (json is! Map) return null;
    final c = json['c'], p = json['p'], t = json['t'], h = json['h'];
    if (c is! String || !_clientIdRe.hasMatch(c)) return null;
    if (p is! String || p.isEmpty || p.length > 100) return null;
    if (t is! String || t.trim().isEmpty || t.length > 1000) return null;
    if (h is! num) return null;
    final f = json['f'];
    final fix = f is List && f.length == 4 && f.every((v) => v is num) ? f.cast<num>() : null;
    final n = json['n'], u = json['u'];
    return MeshNote(
      clientId: c,
      placeId: p,
      placeName: n is String ? n : '',
      text: t,
      heardAt: h.toInt(),
      public: json['v'] == 'p',
      anonymous: json['a'] == 1,
      ephemeral: json['e'] == 1,
      fix: fix,
      author: u is String ? u : null,
    );
  }
}

enum PacketState { pending, delivered, failed }

class MeshPacket {
  MeshPacket._({
    required this.payload,
    required this.keyId,
    required this.note,
    required this.hops,
    required this.receivedAt,
    required this.own,
  });

  final String payload;
  final String keyId;
  final MeshNote note;
  // Bu telefona gelene dek kaç telefondan geçti (kendi sözün: 0).
  final int hops;
  final int receivedAt;
  final bool own;
  PacketState state = PacketState.pending;
  // Sunucu kabul etmediyse nedeni (ör. not_there_then); söz yine okunur, artık gönderilmez.
  String? error;
  String? overheardId;

  String get id => '$keyId:${note.clientId}';

  static const maxDataLength = 4000;

  static String sign(MeshNote note, DeviceKey key, String keyId) {
    final bytes = utf8.encode(jsonEncode(note.toJson()));
    return '${b64url(bytes)}.$keyId.${b64url(key.sign(bytes))}';
  }

  // Gelen paketi çözer; biçimi bozuksa null. İmza burada değil sunucuda doğrulanır (yazarın açık
  // anahtarı sunucudadır).
  static MeshPacket? parse(String payload, {int hops = 0, required int receivedAt, bool own = false}) {
    final parts = payload.split('.');
    if (parts.length != 3 || !parts.every(isB64url) || parts[0].length > maxDataLength || parts[1].length > 40) {
      return null;
    }
    MeshNote? note;
    try {
      note = MeshNote.fromJson(jsonDecode(utf8.decode(fromB64url(parts[0]))));
    } catch (_) {
      return null;
    }
    if (note == null) return null;
    return MeshPacket._(payload: payload, keyId: parts[1], note: note, hops: hops, receivedAt: receivedAt, own: own);
  }

  Map<String, dynamic> toJson() => {
    'p': payload,
    'h': hops,
    'r': receivedAt,
    'o': own,
    's': state.name,
    if (error != null) 'e': error,
    if (overheardId != null) 'i': overheardId,
  };

  static MeshPacket? fromJson(Map<String, dynamic> json) {
    final packet = parse(
      json['p'] as String? ?? '',
      hops: (json['h'] as num?)?.toInt() ?? 0,
      receivedAt: (json['r'] as num?)?.toInt() ?? 0,
      own: json['o'] == true,
    );
    if (packet == null) return null;
    packet.state = PacketState.values.asNameMap()[json['s']] ?? PacketState.pending;
    packet.error = json['e'] as String?;
    packet.overheardId = json['i'] as String?;
    return packet;
  }
}
