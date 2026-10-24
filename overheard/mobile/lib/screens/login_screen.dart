import 'package:flutter/material.dart';

import '../app/app.dart';
import '../core/google_auth.dart';
import '../l10n/strings.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _server = TextEditingController();
  final _handle = TextEditingController();
  final _password = TextEditingController();
  bool _serverEdited = false;
  bool _register = false;
  bool _terms = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final app = AppScope.read(context);
    _server.text = app.server;
    if (app.server.isNotEmpty) app.loadConfig().catchError((_) {});
  }

  @override
  void dispose() {
    _server.dispose();
    _handle.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    final app = AppScope.read(context);
    final url = _server.text.trim();
    if (!RegExp(r'^https?://').hasMatch(url)) {
      setState(() => _error = t('login.badServer'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      // Yalnızca elle değiştirilen adres kaydedilir; bağlantı dosyasından gelen adres öyle kalır.
      if (_serverEdited) {
        await app.setServer(url);
        await app.loadConfig().catchError((_) {});
      }
      await action();
    } on GoogleCanceled {
      // Hesap seçici kapatıldı.
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _submit() {
    final app = AppScope.read(context);
    final handle = _handle.text.trim(), password = _password.text;
    if (_register && !_terms) {
      setState(() => _error = t('errors.terms_required'));
      return;
    }
    _run(() => _register ? app.register(handle, password) : app.signIn(handle, password));
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final theme = Theme.of(context);
    // Bağlantı dosyası adresi sonradan getirirse alan da güncellenir (elle yazılmadıysa).
    if (!_serverEdited && _server.text != app.server) _server.text = app.server;
    final serverKnown = app.server.isNotEmpty;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('👂 Overheard', style: theme.textTheme.displaySmall?.copyWith(fontWeight: FontWeight.w800)),
                    const SizedBox(height: 4),
                    Text(t('app.tagline'), style: theme.textTheme.titleMedium),
                    if (app.serverMessage != null) ...[
                      const SizedBox(height: 12),
                      Card(
                        child: Padding(padding: const EdgeInsets.all(12), child: Text('📣 ${app.serverMessage}')),
                      ),
                    ],
                    const SizedBox(height: 24),
                    if (app.googleClientId != null) ...[
                      OutlinedButton.icon(
                        onPressed: _busy ? null : () => _run(app.signInWithGoogle),
                        style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
                        icon: const Text('G', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
                        label: Text(t('login.google')),
                      ),
                      const SizedBox(height: 6),
                      Text(t('login.googleNote'), textAlign: TextAlign.center, style: theme.textTheme.bodySmall),
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Row(
                          children: [
                            const Expanded(child: Divider()),
                            Padding(padding: const EdgeInsets.symmetric(horizontal: 8), child: Text(t('login.or'))),
                            const Expanded(child: Divider()),
                          ],
                        ),
                      ),
                    ],
                    TextField(
                      controller: _handle,
                      autocorrect: false,
                      autofillHints: const [AutofillHints.username],
                      decoration: InputDecoration(labelText: t('login.handle'), border: const OutlineInputBorder()),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _password,
                      obscureText: true,
                      autofillHints: [_register ? AutofillHints.newPassword : AutofillHints.password],
                      decoration: InputDecoration(labelText: t('login.password'), border: const OutlineInputBorder()),
                      onSubmitted: (_) => _submit(),
                    ),
                    if (_register)
                      CheckboxListTile(
                        value: _terms,
                        onChanged: (v) => setState(() => _terms = v ?? false),
                        contentPadding: EdgeInsets.zero,
                        controlAffinity: ListTileControlAffinity.leading,
                        title: Text(t('login.terms'), style: theme.textTheme.bodySmall),
                      ),
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
                    ],
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
                      child: _busy
                          ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                          : Text(_register ? t('login.register') : t('login.signIn')),
                    ),
                    TextButton(
                      onPressed: _busy ? null : () => setState(() => _register = !_register),
                      child: Text(_register ? t('login.toSignIn') : t('login.toRegister')),
                    ),
                    if (app.demoMode)
                      OutlinedButton(onPressed: _busy ? null : () => _run(app.guest), child: Text(t('login.guest'))),
                    const SizedBox(height: 8),
                    // Sunucu normalde bağlantı dosyasından gelir; yerel sunucuyla denerken elle yazılır.
                    ExpansionTile(
                      initiallyExpanded: !serverKnown,
                      tilePadding: EdgeInsets.zero,
                      title: Text(t('login.server'), style: theme.textTheme.bodyMedium),
                      subtitle: Text(
                        serverKnown
                            ? '${app.server}${app.serverDiscovered ? ' · ${t('login.auto')}' : ''}'
                            : t('login.noServer'),
                        style: theme.textTheme.bodySmall,
                      ),
                      children: [
                        TextField(
                          controller: _server,
                          keyboardType: TextInputType.url,
                          autocorrect: false,
                          onChanged: (_) => _serverEdited = true,
                          decoration: InputDecoration(
                            hintText: t('login.serverHint'),
                            border: const OutlineInputBorder(),
                          ),
                        ),
                        if (!app.serverDiscovered && app.connectUrl.isNotEmpty)
                          TextButton(
                            onPressed: _busy
                                ? null
                                : () {
                                    _serverEdited = false;
                                    app.useDiscoveredServer();
                                  },
                            child: Text(t('login.useAuto')),
                          ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(t('login.online'), textAlign: TextAlign.center, style: theme.textTheme.bodySmall),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
