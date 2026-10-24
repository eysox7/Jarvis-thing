import 'package:flutter/material.dart';

import '../app/app.dart';
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
      await AppScope.read(context).setServer(url);
      await action();
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
                    const SizedBox(height: 32),
                    TextField(
                      controller: _server,
                      keyboardType: TextInputType.url,
                      autocorrect: false,
                      decoration: InputDecoration(
                        labelText: t('login.server'),
                        hintText: t('login.serverHint'),
                        border: const OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
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
                    const SizedBox(height: 16),
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
