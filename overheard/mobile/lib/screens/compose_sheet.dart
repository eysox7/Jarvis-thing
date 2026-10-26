import 'package:flutter/material.dart';

import '../app/app.dart';
import '../app/controller.dart';
import '../core/api.dart';
import '../core/models.dart';
import '../l10n/strings.dart';
import 'overheard_sheet.dart';

Future<void> showCompose(BuildContext context) => showModalBottomSheet<void>(
  context: context,
  showDragHandle: true,
  isScrollControlled: true,
  builder: (_) => const ComposeSheet(),
);

class ComposeSheet extends StatefulWidget {
  const ComposeSheet({super.key});

  @override
  State<ComposeSheet> createState() => _ComposeSheetState();
}

class _ComposeSheetState extends State<ComposeSheet> {
  static const _max = 280;
  final _text = TextEditingController();
  String? _placeId;
  bool _public = false;
  bool _anonymous = false;
  bool _busy = false;
  bool _locating = true;
  String? _error;

  // Pencere hemen açılır; bağlıysa konum arka planda tazelenir (binilen hat, girilen mekân). Tünelde
  // konum ya da bağlantı yoksa son check-in kullanılır.
  @override
  void initState() {
    super.initState();
    _locate();
  }

  Future<void> _locate() async {
    try {
      await AppScope.read(context).checkIn(timeout: const Duration(seconds: 5));
    } catch (_) {
      // Konum ya da bağlantı yok: son check-in geçerli.
    }
    if (mounted) setState(() => _locating = false);
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send(Place place) async {
    final app = AppScope.read(context);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    final text = _text.text.trim();
    if (text.length < 3) {
      setState(() => _error = t('errors.text_too_short'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final outcome = await app.compose(text: text, place: place, public: _public, anonymous: _anonymous);
      navigator.pop();
      if (outcome.viaMesh) {
        messenger.showSnackBar(
          SnackBar(
            duration: const Duration(seconds: 8),
            content: Text('📡 ${t('compose.mesh')}${app.underground.running ? '' : ' ${t('compose.meshOn')}'}'),
            action: app.underground.running
                ? null
                : SnackBarAction(label: t('ug.title'), onPressed: () => app.startUnderground()),
          ),
        );
      } else {
        messenger.showSnackBar(
          SnackBar(
            content: Text(t('compose.posted')),
            action: SnackBarAction(label: '👀', onPressed: () => showOverheard(navigator.context, outcome.overheard!)),
          ),
        );
      }
    } on NoDeviceKey {
      setState(() => _error = t('compose.noKey'));
    } on ApiException catch (e) {
      setState(() => _error = errorText(e));
    } catch (e) {
      setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final theme = Theme.of(context);
    final places = app.composePlaces();
    final selected = places.where((p) => p.id == _placeId).firstOrNull ?? places.firstOrNull;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(t('compose.title'), style: theme.textTheme.titleLarge),
              const SizedBox(height: 12),
              TextField(
                controller: _text,
                autofocus: true,
                maxLength: _max,
                minLines: 3,
                maxLines: 6,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(hintText: t('compose.hint'), border: const OutlineInputBorder()),
              ),
              Row(
                children: [
                  Text(t('compose.place'), style: theme.textTheme.labelLarge),
                  if (_locating) ...[
                    const SizedBox(width: 8),
                    const SizedBox.square(dimension: 12, child: CircularProgressIndicator(strokeWidth: 1.5)),
                  ],
                ],
              ),
              const SizedBox(height: 8),
              if (places.isEmpty && !_locating)
                Text(t('compose.noPlace'), style: theme.textTheme.bodyMedium)
              else
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final p in places)
                      ChoiceChip(
                        avatar: Icon(p.line ? Icons.subway : Icons.place, size: 16),
                        label: Text(p.name),
                        selected: p.id == selected?.id,
                        onSelected: (_) => setState(() => _placeId = p.id),
                      ),
                  ],
                ),
              const SizedBox(height: 8),
              SwitchListTile(
                value: _public,
                onChanged: (v) => setState(() => _public = v),
                contentPadding: EdgeInsets.zero,
                title: Text(t('compose.public')),
              ),
              SwitchListTile(
                value: _anonymous,
                onChanged: (v) => setState(() => _anonymous = v),
                contentPadding: EdgeInsets.zero,
                title: Text(t('compose.anonymous')),
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
                ),
              FilledButton.icon(
                onPressed: _busy || selected == null ? null : () => _send(selected),
                style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
                icon: _busy
                    ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.send),
                label: Text(t('compose.send')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
