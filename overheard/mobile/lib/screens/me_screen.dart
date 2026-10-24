import 'package:flutter/material.dart';

import '../app/app.dart';
import '../l10n/strings.dart';

class MeScreen extends StatelessWidget {
  const MeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final me = app.me;
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t('nav.me'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ListTile(
            leading: const CircleAvatar(child: Text('👂')),
            title: Text('@${me?.handle ?? ''}', style: theme.textTheme.titleLarge),
            subtitle: me?.isGuest == true ? Text(t('me.guest')) : null,
          ),
          const Divider(),
          ListTile(leading: const Icon(Icons.dns_outlined), title: Text(t('me.server')), subtitle: Text(app.server)),
          ListTile(
            leading: Icon(Icons.key, color: app.hasKey ? successColor : theme.colorScheme.error),
            title: Text(t('me.device')),
            subtitle: Text(app.hasKey ? t('me.deviceReady') : t('me.deviceMissing')),
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(onPressed: app.signOut, icon: const Icon(Icons.logout), label: Text(t('me.logout'))),
        ],
      ),
    );
  }
}
