import 'package:flutter/material.dart';

import '../app/app.dart';
import '../core/models.dart';
import '../l10n/strings.dart';

// Söz ayrıntısı. Kilitliyse metin yerine nerede okunabileceği ve uzunluğu gösterilir.
Future<void> showOverheard(BuildContext context, Overheard overheard) => showModalBottomSheet<void>(
  context: context,
  showDragHandle: true,
  isScrollControlled: true,
  builder: (_) => OverheardCard(overheard: overheard),
);

class OverheardCard extends StatelessWidget {
  const OverheardCard({super.key, required this.overheard});

  final Overheard overheard;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final o = overheard;
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
          ],
        ),
      ),
    );
  }
}
