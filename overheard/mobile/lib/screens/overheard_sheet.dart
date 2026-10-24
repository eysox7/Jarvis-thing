import 'package:flutter/material.dart';

import '../app/app.dart';
import '../core/models.dart';
import '../l10n/strings.dart';
import 'chat_screen.dart';

// Söz ayrıntısı. Kilitliyse metin yerine nerede okunabileceği ve uzunluğu gösterilir. Okunabilen
// sözde tepkiler, yazana mesaj, şikâyet ve engelleme.
Future<void> showOverheard(BuildContext context, Overheard overheard) => showModalBottomSheet<void>(
  context: context,
  showDragHandle: true,
  isScrollControlled: true,
  builder: (_) => OverheardCard(overheard: overheard),
);

const reactionEmoji = {'lol': '😂', 'wow': '😮', 'same': '👂', 'heart': '❤️'};

class OverheardCard extends StatefulWidget {
  const OverheardCard({super.key, required this.overheard});

  final Overheard overheard;

  @override
  State<OverheardCard> createState() => _OverheardCardState();
}

class _OverheardCardState extends State<OverheardCard> {
  late Overheard _o = widget.overheard;
  bool _busy = false;

  @override
  void didUpdateWidget(OverheardCard old) {
    super.didUpdateWidget(old);
    if (old.overheard.id != widget.overheard.id) _o = widget.overheard;
  }

  void _snack(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
    } catch (e) {
      if (mounted) _snack(errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _confirm(String text, String action) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          content: Text(text),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: Text(t('common.close'))),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(action)),
          ],
        ),
      ) ??
      false;

  void _react(String kind) => _run(() async {
    final updated = await AppScope.read(context).react(_o.id, kind);
    if (mounted) setState(() => _o = updated);
  });

  void _report() => _run(() async {
    if (!await _confirm(t('bubble.confirmReport'), t('bubble.report'))) return;
    if (!mounted) return;
    await AppScope.read(context).report(_o.id);
    _snack(t('toast.reported'));
  });

  void _block() => _run(() async {
    final who = _o.author ?? t('anon.name');
    if (!await _confirm(t('bubble.confirmBlock', {'handle': who}), t('bubble.block'))) return;
    if (!mounted) return;
    final navigator = Navigator.of(context);
    await AppScope.read(context).blockAuthor(_o.id);
    _snack(t('toast.blocked'));
    navigator.pop();
  });

  Future<void> _message() async {
    final text = TextEditingController();
    final body = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(t('bubble.message')),
        content: TextField(
          controller: text,
          autofocus: true,
          minLines: 2,
          maxLines: 5,
          maxLength: 1000,
          decoration: InputDecoration(hintText: t('chat.placeholder')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(t('common.close'))),
          FilledButton(onPressed: () => Navigator.pop(context, text.text.trim()), child: Text(t('chat.send'))),
        ],
      ),
    );
    text.dispose();
    if (body == null || body.isEmpty || !mounted) return;
    await _run(() async {
      final navigator = Navigator.of(context);
      final conversationId = await AppScope.read(context).messageAbout(_o.id, body);
      navigator.pop();
      await navigator.push(MaterialPageRoute<void>(builder: (_) => ChatScreen(conversationId: conversationId)));
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final o = _o;
    final who = o.mine ? t('oh.you') : o.author ?? t('oh.anonymous');
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (o.locked) ...[
              Text('🔒 ${t('oh.locked', {'place': o.placeName})}', style: theme.textTheme.titleMedium),
              const SizedBox(height: 6),
              Text(t('oh.length', {'n': o.length}), style: theme.textTheme.bodySmall),
            ] else
              Text('“${o.text}”', style: theme.textTheme.headlineSmall?.copyWith(fontFamily: 'serif', height: 1.3)),
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                Chip(avatar: Icon(o.onLine ? Icons.subway : Icons.place, size: 16), label: Text(o.placeName)),
                Chip(label: Text(o.public ? t('oh.public') : t('oh.local'))),
                if (o.sameTime) Chip(label: Text('👂 ${t('bubble.sameTime')}')),
                if (o.offline)
                  Chip(
                    avatar: const Text('📡'),
                    label: Text(
                      [
                        t('oh.offline'),
                        if ((o.hops ?? 0) > 0) t('oh.hops', {'n': o.hops}),
                      ].join(' · '),
                    ),
                    backgroundColor: accent.withValues(alpha: 0.12),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Text(o.locked ? timeAgo(o.createdAt) : '${timeAgo(o.createdAt)} · $who', style: theme.textTheme.bodySmall),
            if (!o.locked) ...[
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                children: [
                  for (final MapEntry(key: kind, value: emoji) in reactionEmoji.entries)
                    if (kind != 'same' || o.sameTime || o.myReactions.contains(kind))
                      FilterChip(
                        label: Text('$emoji ${o.reactions[kind] ?? 0}'),
                        tooltip: t('react.$kind'),
                        selected: o.myReactions.contains(kind),
                        onSelected: _busy || o.mine ? null : (_) => _react(kind),
                      ),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 4,
                children: [
                  if (o.canMessage)
                    TextButton.icon(
                      onPressed: _busy ? null : _message,
                      icon: const Icon(Icons.chat_bubble_outline),
                      label: Text(t('bubble.message')),
                    ),
                  if (!o.mine) ...[
                    TextButton.icon(
                      onPressed: _busy ? null : _report,
                      icon: const Icon(Icons.flag_outlined),
                      label: Text(t('bubble.report')),
                    ),
                    TextButton.icon(
                      onPressed: _busy ? null : _block,
                      icon: const Icon(Icons.block),
                      label: Text(t('bubble.block')),
                    ),
                  ],
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
