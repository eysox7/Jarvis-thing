import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app/app.dart';
import '../core/google_auth.dart';
import '../l10n/strings.dart';

class MeScreen extends StatelessWidget {
  const MeScreen({super.key});

  Future<void> _open(BuildContext context, String url) async {
    final messenger = ScaffoldMessenger.of(context);
    final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication).catchError((_) => false);
    if (!ok) messenger.showSnackBar(SnackBar(content: Text(url)));
  }

  // Hesap ve bütün veriler kalıcı olarak silinir (Play Store: uygulama içinden hesap silme).
  Future<void> _delete(BuildContext context) async {
    final app = AppScope.read(context);
    final password = TextEditingController();
    final guest = app.me?.isGuest ?? false;
    // Parolası olmayan (Google ile açılmış) hesap silmeyi Google hesabını seçerek onaylar.
    final viaGoogle = !guest && !app.profile.passwordLogin && app.profile.googleLinked;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(t('profile.delete')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(t('profile.deleteConfirm')),
            if (viaGoogle) ...[
              const SizedBox(height: 12),
              Text(t('me.deleteGoogle')),
            ] else if (!guest) ...[
              const SizedBox(height: 12),
              Text(t('profile.deletePassword')),
              TextField(controller: password, obscureText: true, autofocus: true),
            ],
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(t('common.close'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
            onPressed: () => Navigator.pop(context, true),
            child: Text(t('profile.delete')),
          ),
        ],
      ),
    );
    final value = password.text;
    password.dispose();
    if (confirmed != true || !context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      await app.deleteAccount(value);
      messenger.showSnackBar(SnackBar(content: Text(t('profile.deleted'))));
    } on GoogleCanceled {
      // Onay verilmedi.
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorText(e))));
    }
  }

  Future<void> _linkGoogle(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await AppScope.read(context).linkGoogle();
      messenger.showSnackBar(SnackBar(content: Text(t('me.googleLinkedDone'))));
    } on GoogleCanceled {
      // Hesap seçilmedi.
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorText(e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final me = app.me;
    final profile = app.profile;
    final theme = Theme.of(context);
    final earned = profile.badges.where((b) => b.earned).toList();
    return Scaffold(
      appBar: AppBar(title: Text(t('profile.title'))),
      body: RefreshIndicator(
        onRefresh: app.refreshProfile,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const CircleAvatar(child: Text('👂')),
              title: Text('@${me?.handle ?? ''}', style: theme.textTheme.titleLarge),
              subtitle: me?.isGuest == true ? Text(t('profile.guestNote')) : null,
            ),
            if (profile.banned) Text(t('profile.bannedNote'), style: TextStyle(color: theme.colorScheme.error)),
            const SizedBox(height: 8),
            Row(
              children: [
                for (final (key, label) in [
                  ('places', 'profile.places'),
                  ('cities', 'profile.cities'),
                  ('overheards', 'profile.overheards'),
                  ('reactionsReceived', 'profile.reactions'),
                ])
                  Expanded(
                    child: Column(
                      children: [
                        Text(
                          '${profile.stats[key] ?? 0}',
                          style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        Text(t(label), style: theme.textTheme.bodySmall, textAlign: TextAlign.center),
                      ],
                    ),
                  ),
              ],
            ),
            if (profile.badges.isNotEmpty) ...[
              const SizedBox(height: 20),
              Text(
                '${t('profile.badges')} · ${earned.length}/${profile.badges.length}',
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final b in profile.badges)
                    Tooltip(
                      message: t('badge.${b.id}.how'),
                      child: Chip(
                        label: Text(t('badge.${b.id}')),
                        avatar: Icon(b.earned ? Icons.verified : Icons.lock_outline, size: 16),
                        backgroundColor: b.earned ? accent.withValues(alpha: 0.15) : null,
                      ),
                    ),
                ],
              ),
            ],
            const Divider(height: 32),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.dns_outlined),
              title: Text(t('me.server')),
              subtitle: Text(app.server),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.key, color: app.hasKey ? successColor : theme.colorScheme.error),
              title: Text(t('me.device')),
              subtitle: Text(app.hasKey ? t('me.deviceReady') : t('me.deviceMissing')),
            ),
            if (app.googleClientId != null)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(Icons.account_circle_outlined, color: profile.googleLinked ? successColor : null),
                title: Text(t('me.google')),
                subtitle: profile.googleLinked ? Text(t('me.googleLinked')) : null,
                trailing: profile.googleLinked
                    ? null
                    : TextButton(onPressed: () => _linkGoogle(context), child: Text(t('me.googleLink'))),
              ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.description_outlined),
              title: Text(t('legal.terms')),
              onTap: () => _open(context, app.termsUrl),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.privacy_tip_outlined),
              title: Text(t('legal.privacy')),
              onTap: () => _open(context, app.privacyUrl),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: app.signOut,
              icon: const Icon(Icons.logout),
              label: Text(t('profile.logout')),
            ),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: () => _delete(context),
              style: TextButton.styleFrom(foregroundColor: theme.colorScheme.error),
              icon: const Icon(Icons.delete_forever_outlined),
              label: Text(t('profile.delete')),
            ),
          ],
        ),
      ),
    );
  }
}
