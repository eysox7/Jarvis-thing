import 'dart:async';

import 'package:flutter/material.dart';

import '../app/app.dart';
import '../l10n/strings.dart';
import '../mesh/packet.dart';
import 'map_screen.dart';
import 'me_screen.dart';
import 'messages_screen.dart';
import 'underground_screen.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  int _tab = 0;
  StreamSubscription<MeshPacket>? _received;
  Timer? _poll;
  final _messages = GlobalKey<MessagesScreenState>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Okunmamış mesaj rozeti için ara ara profil sorulur (bağlantı yoksa sessizce geçer).
    _poll = Timer.periodic(const Duration(seconds: 30), (_) => AppScope.read(context).refreshProfile());
    // Yeraltından gelen her söz kısa bir bildirimle görünür (metin yeraltı sekmesinde okunur).
    _received = AppScope.read(context).underground.received.listen((packet) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('📡 ${t('ug.received', {'place': packet.note.placeName})}'),
          action: SnackBarAction(label: t('nav.underground'), onPressed: () => setState(() => _tab = 1)),
        ),
      );
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _received?.cancel();
    _poll?.cancel();
    super.dispose();
  }

  // Uygulamaya dönünce (metrodan çıkınca) bekleyenler gönderilir, harita tazelenir.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) AppScope.read(context).refresh().catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final waiting = app.underground.waiting;
    return Scaffold(
      body: IndexedStack(
        index: _tab,
        children: [
          const MapScreen(),
          const UndergroundScreen(),
          MessagesScreen(key: _messages),
          const MeScreen(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) {
          setState(() => _tab = i);
          if (i == 2) _messages.currentState?.reload();
          if (i == 3) app.refreshProfile();
        },
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.map_outlined),
            selectedIcon: const Icon(Icons.map),
            label: t('nav.map'),
          ),
          NavigationDestination(
            icon: Badge(
              isLabelVisible: waiting > 0 || app.underground.running,
              label: waiting > 0 ? Text('$waiting') : null,
              backgroundColor: app.underground.running && waiting == 0 ? successColor : null,
              child: const Icon(Icons.subway_outlined),
            ),
            selectedIcon: const Icon(Icons.subway),
            label: t('nav.underground'),
          ),
          NavigationDestination(
            icon: Badge(
              isLabelVisible: app.profile.unread > 0,
              label: Text('${app.profile.unread}'),
              child: const Icon(Icons.chat_bubble_outline),
            ),
            selectedIcon: const Icon(Icons.chat_bubble),
            label: t('inbox.title'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.person_outline),
            selectedIcon: const Icon(Icons.person),
            label: t('nav.me'),
          ),
        ],
      ),
    );
  }
}
