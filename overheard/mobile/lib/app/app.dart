import 'package:flutter/material.dart';

import '../screens/home_shell.dart';
import '../screens/login_screen.dart';
import 'controller.dart';

// Uygulama durumunu ağaca verir; değiştikçe dinleyen ekranlar yeniden çizilir.
class AppScope extends InheritedNotifier<AppController> {
  const AppScope({super.key, required AppController controller, required super.child}) : super(notifier: controller);

  static AppController of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;

  static AppController read(BuildContext context) => context.getInheritedWidgetOfExactType<AppScope>()!.notifier!;
}

// Web uygulamasının renkleri: kâğıt zemin, mürekkep, turuncu vurgu.
const accent = Color(0xFFFF5A3C);
const lockedColor = Color(0xFF8B86A3);
const successColor = Color(0xFF1F9D6B);

ThemeData _theme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: accent,
    brightness: brightness,
    primary: accent,
    surface: dark ? const Color(0xFF26222E) : const Color(0xFFFFFAF0),
  );
  return ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: dark ? const Color(0xFF15131A) : const Color(0xFFF4F1EA),
    useMaterial3: true,
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );
}

class OverheardApp extends StatelessWidget {
  const OverheardApp({super.key, required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) => AppScope(
    controller: controller,
    child: MaterialApp(
      title: 'Overheard',
      debugShowCheckedModeBanner: false,
      theme: _theme(Brightness.light),
      darkTheme: _theme(Brightness.dark),
      home: const _Root(),
    ),
  );
}

class _Root extends StatelessWidget {
  const _Root();

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    if (!app.booted) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return app.me == null ? const LoginScreen() : const HomeShell();
  }
}
