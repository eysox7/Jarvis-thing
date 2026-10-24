import 'package:google_sign_in/google_sign_in.dart';

// Kullanıcı Google hesap seçicisini kapattı.
class GoogleCanceled implements Exception {}

// Google kimlik belgesi (ID token) alır; sunucu onu doğrular (POST /api/auth/google). Belgenin kitlesi
// (aud) sunucunun "Web uygulaması" türündeki istemci kimliğidir; Android'de Credential Manager kullanılır.
abstract class GoogleAuth {
  Future<String> idToken(String serverClientId);
}

class DeviceGoogleAuth implements GoogleAuth {
  String? _initializedFor;

  @override
  Future<String> idToken(String serverClientId) async {
    final signIn = GoogleSignIn.instance;
    if (_initializedFor != serverClientId) {
      await signIn.initialize(serverClientId: serverClientId);
      _initializedFor = serverClientId;
    }
    try {
      final account = await signIn.authenticate();
      final token = account.authentication.idToken;
      if (token == null) throw GoogleCanceled();
      // Uygulama Google oturumunu tutmaz; bir dahaki sefer hesap yeniden seçilebilsin.
      await signIn.signOut();
      return token;
    } on GoogleSignInException catch (e) {
      if (e.code == GoogleSignInExceptionCode.canceled || e.code == GoogleSignInExceptionCode.interrupted) {
        throw GoogleCanceled();
      }
      rethrow;
    }
  }
}
