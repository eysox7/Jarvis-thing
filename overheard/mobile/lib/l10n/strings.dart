import 'dart:ui';

import '../core/api.dart';
import 'web_strings.g.dart';

// Uygulama metinleri (Türkçe ve İngilizce). Hata, sohbet, profil ve rozet metinleri web uygulamasından üretilir.
const _strings = <String, Map<String, String>>{
  'tr': {
    'app.tagline': 'Duyduğunu haritaya bırak.',
    'login.server': 'Sunucu adresi',
    'login.serverHint': 'https://overheard.ornek.com',
    'login.handle': 'Kullanıcı adı',
    'login.password': 'Parola',
    'login.signIn': 'Giriş yap',
    'login.register': 'Hesap aç',
    'login.toRegister': 'Hesabın yok mu? Hesap aç',
    'login.toSignIn': 'Hesabın var mı? Giriş yap',
    'login.terms': 'Kullanım koşullarını ve gizlilik politikasını kabul ediyorum.',
    'login.guest': 'Misafir olarak dene',
    'login.badServer': 'Sunucu adresi https:// ya da http:// ile başlamalı.',
    'login.online': 'İlk giriş için internet gerekir; sonra metroda da çalışır.',
    'login.google': 'Google ile devam et',
    'login.googleNote': 'Google ile devam ederek kullanım koşullarını ve gizlilik politikasını kabul edersin. Google hesabının yalnızca kimliği saklanır; e-postan ve adın saklanmaz.',
    'login.or': 'ya da',
    'login.auto': 'otomatik',
    'login.noServer': 'Sunucu bulunamadı; adresi elle yaz.',
    'login.useAuto': 'Otomatik adrese dön',
    'me.google': 'Google hesabı',
    'me.googleLinked': 'bağlı: Google ile de girebilirsin',
    'me.googleLink': 'Google hesabını bağla',
    'me.googleLinkedDone': 'Google hesabın bağlandı.',
    'me.deleteGoogle': 'Onay için Google hesabını seçeceksin.',
    'nav.map': 'Harita',
    'nav.underground': 'Yeraltı',
    'nav.me': 'Ben',
    'map.here': 'Buradayım',
    'map.compose': 'Söz bırak',
    'map.offline': 'Bağlantı yok: harita son hâliyle gösteriliyor.',
    'map.noLocation': 'Konum alınamadı. Konumu açıp tekrar dene.',
    'map.checkedIn': '{place} içindesin. Yerel sözler açıldı.',
    'map.nowhere': 'Yakınında kayıtlı mekân yok.',
    'map.held': 'Hâlâ {place} içinde sayılıyorsun.',
    'oh.locked': 'Bu yerel bir söz. Okumak için {place} içinde olmalısın.',
    'oh.length': '{n} karakter',
    'oh.public': 'Herkese açık',
    'oh.local': 'Yerel',
    'oh.anonymous': 'anonim',
    'oh.you': 'sen',
    'oh.offline': 'İnternetsiz yazıldı',
    'oh.hops': '{n} telefondan geçti',
    'compose.title': 'Ne duydun?',
    'compose.hint': 'Yanındaki masadan, vagondan, kuyruktan…',
    'compose.place': 'Nerede?',
    'compose.noPlace': 'Şu an bir mekânda ya da hatta görünmüyorsun. Önce "Buradayım" de (metroya binerken durakta).',
    'compose.public': 'Herkese açık (her yerden okunur)',
    'compose.anonymous': 'Anonim bırak',
    'compose.send': 'Bırak',
    'compose.posted': 'Söz haritada.',
    'compose.mesh': 'Bağlantı yok: söz yeraltı ağına bırakıldı. Bir telefon sinyal bulunca sunucuya ulaşacak.',
    'compose.meshOn': 'Yeraltı modunu aç ki yanındaki telefonlara geçsin.',
    'compose.noKey': 'Cihaz anahtarı yok: internetsiz söz için uygulamayı bir kez internetle aç.',
    'ug.title': 'Yeraltı modu',
    'ug.how': 'Metroda internet yokken yazdığın söz, Bluetooth ile yanındaki Overheard\'lü telefonlara geçer. İçlerinden biri sinyal bulduğunda söz sunucuya ulaşır. Sen de başkalarının sözlerini taşırsın.',
    'ug.off': 'Kapalı',
    'ug.on': 'Açık · yakında {n} telefon',
    'ug.searching': 'Açık · yakındaki telefonlar aranıyor',
    'ug.pending': 'Bekleyen',
    'ug.carried': 'Taşıdığın',
    'ug.delivered': 'Ulaşan',
    'ug.flush': 'Şimdi gönder',
    'ug.list': 'Yeraltında duyulanlar',
    'ug.empty': 'Henüz bir şey yok. Metroda yeraltı modunu aç; yanından geçen sözler burada birikir.',
    'ug.own': 'Senin sözün',
    'ug.waiting': 'sinyal bekliyor',
    'ug.sent': 'sunucuya ulaştı',
    'ug.failed': 'gönderilemedi',
    'ug.received': 'Yeraltından bir söz geldi: {place}',
    'ug.permissions': 'Yeraltı modu için Bluetooth, yakındaki cihazlar ve konum izni gerekiyor.',
    'ug.unavailable':
        'Yakındaki cihaz bağlantısı başlatılamadı. Bluetooth ve konum açık mı? (Google Play Hizmetleri de gerekir.)',
    'ug.hide': 'Bu telefondan sil',
    'ug.stop': 'Kapat',
    'ug.auto': 'Otomatik',
    'ug.autoHint': 'Hatta binince ya da bağlantı kopunca kendiliğinden açılır; bağlantı dönüp hattan inince kapanır. Uygulamayı kapatsan da sürer.',
    'ug.autoStarted': 'kendiliğinden açıldı',
    'ug.noSignal': 'bağlantı yok',
    'ug.log': 'Saha günlüğü',
    'ug.logEmpty':
        'Henüz bir olay yok. Yeraltı modunu açınca telefon bulma, bağlanma ve söz alışverişi burada görünür.',
    'ug.notification': 'Yeraltı modu açık',
    'ug.notificationText': 'Sözler yakındaki telefonlara geçiyor',
    'ug.flushed': '{n} söz sunucuya ulaştı.',
    'me.guest': 'Misafir hesabı',
    'me.server': 'Sunucu',
    'me.logout': 'Çıkış yap',
    'me.device': 'Cihaz anahtarı',
    'me.deviceReady': 'hazır (internetsiz sözler imzalanabilir)',
    'me.deviceMissing': 'yok: bir kez internete bağlan',
    'common.retry': 'Tekrar dene',
    'common.close': 'Kapat',
    'common.offline': 'Bağlantı yok.',
  },
  'en': {
    'app.tagline': 'Drop what you overheard on the map.',
    'login.server': 'Server address',
    'login.serverHint': 'https://overheard.example.com',
    'login.handle': 'Username',
    'login.password': 'Password',
    'login.signIn': 'Sign in',
    'login.register': 'Create account',
    'login.toRegister': 'No account? Create one',
    'login.toSignIn': 'Have an account? Sign in',
    'login.terms': 'I accept the terms of use and the privacy policy.',
    'login.guest': 'Try as a guest',
    'login.badServer': 'The server address must start with https:// or http://.',
    'login.online': 'The first sign-in needs internet; after that it works in the subway too.',
    'login.google': 'Continue with Google',
    'login.googleNote': 'By continuing with Google you accept the terms of use and the privacy policy. Only your Google account ID is stored; not your email or name.',
    'login.or': 'or',
    'login.auto': 'automatic',
    'login.noServer': 'No server found; type the address.',
    'login.useAuto': 'Back to the automatic address',
    'me.google': 'Google account',
    'me.googleLinked': 'linked: you can sign in with Google too',
    'me.googleLink': 'Link your Google account',
    'me.googleLinkedDone': 'Your Google account is linked.',
    'me.deleteGoogle': "You'll pick your Google account to confirm.",
    'nav.map': 'Map',
    'nav.underground': 'Underground',
    'nav.me': 'Me',
    'map.here': "I'm here",
    'map.compose': 'Drop one',
    'map.offline': 'No connection: showing the map as it was.',
    'map.noLocation': "Couldn't get your location. Turn it on and try again.",
    'map.checkedIn': "You're at {place}. Local overheards unlocked.",
    'map.nowhere': 'No place registered nearby.',
    'map.held': "You still count as at {place}.",
    'oh.locked': 'This is a local overheard. Be at {place} to read it.',
    'oh.length': '{n} characters',
    'oh.public': 'Public',
    'oh.local': 'Local',
    'oh.anonymous': 'anonymous',
    'oh.you': 'you',
    'oh.offline': 'Written offline',
    'oh.hops': 'passed through {n} phones',
    'compose.title': 'What did you overhear?',
    'compose.hint': 'From the next table, the subway car, the queue…',
    'compose.place': 'Where?',
    'compose.noPlace':
        "You don't seem to be at a place or on a line. Tap \"I'm here\" first (at the station when boarding).",
    'compose.public': 'Public (readable from anywhere)',
    'compose.anonymous': 'Post anonymously',
    'compose.send': 'Drop',
    'compose.posted': "It's on the map.",
    'compose.mesh':
        'No connection: dropped into the underground network. It will reach the server once a phone gets signal.',
    'compose.meshOn': 'Turn on underground mode so it passes to nearby phones.',
    'compose.noKey': 'No device key: open the app online once to post offline.',
    'ug.title': 'Underground mode',
    'ug.how': 'In the subway with no internet, what you write passes over Bluetooth to nearby phones running Overheard. As soon as one of them gets signal, it reaches the server. You carry other people\'s overheards too.',
    'ug.off': 'Off',
    'ug.on': 'On · {n} phones nearby',
    'ug.searching': 'On · looking for nearby phones',
    'ug.pending': 'Waiting',
    'ug.carried': 'Carrying',
    'ug.delivered': 'Delivered',
    'ug.flush': 'Send now',
    'ug.list': 'Heard underground',
    'ug.empty': 'Nothing yet. Turn on underground mode in the subway; overheards passing by collect here.',
    'ug.own': 'Yours',
    'ug.waiting': 'waiting for signal',
    'ug.sent': 'reached the server',
    'ug.failed': 'could not be sent',
    'ug.received': 'An overheard came from underground: {place}',
    'ug.permissions': 'Underground mode needs Bluetooth, nearby devices and location permissions.',
    'ug.unavailable':
        "Couldn't start nearby connections. Are Bluetooth and location on? (Google Play services are required too.)",
    'ug.hide': 'Remove from this phone',
    'ug.stop': 'Turn off',
    'ug.auto': 'Automatic',
    'ug.autoHint': 'Turns on when you board a line or lose signal, and off once you are back online and off the line. Keeps going even if you close the app.',
    'ug.autoStarted': 'turned on automatically',
    'ug.noSignal': 'no signal',
    'ug.log': 'Field log',
    'ug.logEmpty':
        'Nothing yet. Once underground mode is on, finding phones, connecting and exchanging overheards show up here.',
    'ug.notification': 'Underground mode is on',
    'ug.notificationText': 'Overheards are passing to nearby phones',
    'ug.flushed': '{n} overheards reached the server.',
    'me.guest': 'Guest account',
    'me.server': 'Server',
    'me.logout': 'Sign out',
    'me.device': 'Device key',
    'me.deviceReady': 'ready (offline overheards can be signed)',
    'me.deviceMissing': 'missing: connect to the internet once',
    'common.retry': 'Retry',
    'common.close': 'Close',
    'common.offline': 'No connection.',
  },
};

String get lang => PlatformDispatcher.instance.locale.languageCode == 'tr' ? 'tr' : 'en';

String _fill(String template, Map<String, Object?> vars) =>
    template.replaceAllMapped(RegExp(r'\{(\w+)\}'), (m) => '${vars[m[1]] ?? m[0]}');

String t(String key, [Map<String, Object?> vars = const {}]) {
  final template =
      _strings[lang]![key] ?? webStrings[lang]![key] ?? _strings['tr']![key] ?? webStrings['tr']![key] ?? key;
  return _fill(template, vars);
}

// Sunucu hatası ya da yalnızca hata kodu (ör. check-in'in "blocked" nedeni, reddedilen paketin kodu).
String errorText(Object error) {
  if (error is ApiException && error.offline) return t('common.offline');
  final (code, extra) = switch (error) {
    ApiException(:final code, :final extra) => (code, extra),
    String code => (code, const <String, dynamic>{}),
    _ => ('default', const <String, dynamic>{}),
  };
  for (final key in ['errors.$code', 'location.$code']) {
    if (webStrings[lang]!.containsKey(key)) return t(key, extra);
  }
  return t('errors.default');
}

String timeAgo(int at, [int? now]) {
  final minutes = ((now ?? DateTime.now().millisecondsSinceEpoch) - at) ~/ 60000;
  if (minutes < 1) return t('time.now');
  if (minutes < 60) return t('time.m', {'n': minutes});
  if (minutes < 60 * 24) return t('time.h', {'n': minutes ~/ 60});
  return t('time.d', {'n': minutes ~/ (60 * 24)});
}
