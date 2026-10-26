enum AutoAction { none, start, stop }

// Otomatik yeraltı modunun kararı (saf mantık; saat ve bağlantı bilgisi dışarıdan gelir).
// - Açılır: hattasın (binişte check-in) ya da sunucuya [offlineAfter] süredir ulaşılamıyor.
// - Kapanır (yalnızca kendisi açtıysa): sunucuya [idleAfter] süredir ulaşılıyor ve hatta değilsin.
// - Kullanıcı kapatırsa (uygulamadan ya da bildirimden): koşullar bir kez ortadan kalkana dek
//   (hattan inip bağlantı gelene dek) yeniden açılmaz.
class AutoUnderground {
  AutoUnderground({this.offlineAfter = const Duration(seconds: 30), this.idleAfter = const Duration(minutes: 10)});

  final Duration offlineAfter;
  final Duration idleAfter;
  bool enabled = true;
  // Son check-in'e göre bir hattasın (içeride kalma süresi dolmadı).
  bool onLine = false;
  bool _online = true;
  int? _since;
  bool _suppressed = false;

  bool get online => _online;

  // Bir istek sunucuya ulaştı (true) ya da bağlantı yok (false).
  void reachability(bool online, int now) {
    if (online != _online || _since == null) {
      _online = online;
      _since = now;
    }
  }

  void userStopped() => _suppressed = true;

  AutoAction decide({required bool running, required bool startedByAuto, required int now}) {
    final since = _since;
    final offlineLong = !_online && since != null && now - since >= offlineAfter.inMilliseconds;
    final onlineLong = _online && since != null && now - since >= idleAfter.inMilliseconds;
    if (_suppressed) {
      if (!onLine && _online) _suppressed = false;
      return AutoAction.none;
    }
    if (!enabled) return AutoAction.none;
    if (!running && (onLine || offlineLong)) return AutoAction.start;
    if (running && startedByAuto && !onLine && onlineLong) return AutoAction.stop;
    return AutoAction.none;
  }
}
