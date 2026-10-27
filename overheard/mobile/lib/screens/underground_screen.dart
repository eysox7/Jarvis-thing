import 'package:flutter/material.dart';

import '../app/app.dart';
import '../app/controller.dart';
import '../core/api.dart';
import '../core/moderation.dart';
import '../l10n/strings.dart';
import '../mesh/packet.dart';
import '../mesh/underground.dart';
import 'overheard_sheet.dart';

// Yeraltı modu: internetsiz, telefondan telefona söz aktarımı. Gelen sözler burada hemen okunur;
// yanındaki telefondan geldiyse sen de onun yanındasın demektir.
class UndergroundScreen extends StatelessWidget {
  const UndergroundScreen({super.key});

  Future<void> _toggle(BuildContext context, AppController app, bool on) async {
    final messenger = ScaffoldMessenger.of(context);
    if (!on) return app.stopUnderground();
    final result = await app.startUnderground();
    final problem = switch (result) {
      UndergroundStart.permissions => t('ug.permissions'),
      UndergroundStart.unavailable => t('ug.unavailable'),
      UndergroundStart.ok => null,
    };
    if (problem != null) messenger.showSnackBar(SnackBar(content: Text(problem)));
  }

  // Sunucuya ulaşmış söz (kendi ulaştırdığın ya da makbuzu ağda gelen) sunucudaki hâliyle açılır.
  Future<void> _open(BuildContext context, AppController app, String id) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final overheard = await app.overheard(id);
      if (context.mounted) await showOverheard(context, overheard);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorText(e))));
    }
  }

  Future<void> _flush(BuildContext context, Underground underground) async {
    final messenger = ScaffoldMessenger.of(context);
    final sent = await underground.flush();
    messenger.showSnackBar(SnackBar(content: Text(sent > 0 ? t('ug.flushed', {'n': sent}) : t('common.offline'))));
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final underground = app.underground;
    final theme = Theme.of(context);
    final packets = underground.packets;
    final status = [
      !underground.running
          ? t('ug.off')
          : underground.peers > 0
          ? t('ug.on', {'n': underground.peers})
          : t('ug.searching'),
      if (underground.running && underground.startedByAuto) t('ug.autoStarted'),
      if (!app.online) t('ug.noSignal'),
    ].join(' · ');
    return Scaffold(
      appBar: AppBar(title: Text(t('ug.title'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SwitchListTile(
                    value: underground.running,
                    onChanged: (on) => _toggle(context, app, on),
                    contentPadding: EdgeInsets.zero,
                    secondary: Icon(
                      Icons.bluetooth_searching,
                      color: underground.running ? successColor : null,
                      size: 32,
                    ),
                    title: Text(t('ug.title'), style: theme.textTheme.titleMedium),
                    subtitle: Text(status),
                  ),
                  // Otomatik: hatta binince ya da bağlantı kopunca açılır, çıkınca kapanır.
                  SwitchListTile(
                    value: app.auto.enabled,
                    onChanged: app.setAutoUnderground,
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    title: Text(t('ug.auto')),
                    subtitle: Text(t('ug.autoHint')),
                  ),
                  const SizedBox(height: 8),
                  Text(t('ug.how'), style: theme.textTheme.bodySmall),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      _Stat(label: t('ug.pending'), value: underground.waiting),
                      _Stat(label: t('ug.carried'), value: underground.carried),
                      _Stat(label: t('ug.delivered'), value: underground.delivered),
                    ],
                  ),
                  if (underground.waiting > 0 || underground.carried > 0) ...[
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: () => _flush(context, underground),
                      icon: const Icon(Icons.cloud_upload_outlined),
                      label: Text(t('ug.flush')),
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(t('ug.list'), style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          if (packets.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Text(t('ug.empty'), style: theme.textTheme.bodyMedium),
            )
          else
            for (final packet in packets)
              _PacketTile(
                packet: packet,
                onHide: () => underground.hide(packet.id),
                onOpen: packet.overheardId == null ? null : () => _open(context, app, packet.overheardId!),
              ),
          const SizedBox(height: 16),
          // İki telefonla saha denemesinde ne olduğunu görmek için.
          Card(
            child: ExpansionTile(
              leading: const Icon(Icons.receipt_long_outlined),
              title: Text(t('ug.log')),
              childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              children: [
                if (underground.log.isEmpty)
                  Text(t('ug.logEmpty'), style: theme.textTheme.bodySmall)
                else
                  for (final line in underground.log.take(100))
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        '${_clock(line.at)}  ${line.message}',
                        style: theme.textTheme.bodySmall?.copyWith(fontFamily: 'monospace'),
                      ),
                    ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String _clock(int at) {
  final time = DateTime.fromMillisecondsSinceEpoch(at);
  String two(int v) => v.toString().padLeft(2, '0');
  return '${two(time.hour)}:${two(time.minute)}:${two(time.second)}';
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});

  final String label;
  final int value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Expanded(
      child: Column(
        children: [
          Text('$value', style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
          Text(label, style: theme.textTheme.bodySmall),
        ],
      ),
    );
  }
}

class _PacketTile extends StatelessWidget {
  const _PacketTile({required this.packet, required this.onHide, this.onOpen});

  final MeshPacket packet;
  final VoidCallback onHide;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final note = packet.note;
    final state = switch (packet.state) {
      PacketState.pending => '⏳ ${t('ug.waiting')}',
      PacketState.delivered => '✅ ${t('ug.sent')}',
      PacketState.failed => '⚠️ ${t('ug.failed')}${packet.error == null ? '' : ': ${errorText(packet.error!)}'}',
    };
    final origin = packet.own ? t('ug.own') : '📡 ${t('oh.hops', {'n': packet.hops})}';
    final who = note.anonymous || note.author == null ? t('oh.anonymous') : note.author!;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 14, 4, 14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _body(theme, note, who, origin, state)),
              // Rahatsız edici bulduğun taşınan sözü telefondan silebilirsin; bir daha alınmaz.
              if (!packet.own)
                PopupMenuButton<void>(
                  itemBuilder: (_) => [PopupMenuItem(onTap: onHide, child: Text(t('ug.hide')))],
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _body(ThemeData theme, MeshNote note, String who, String origin, String state) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      // Yeraltından gelen söz sunucuya varmadan okunur: kişisel veri ve küfür maskelenir.
      Text('“${displayText(note.text)}”', style: theme.textTheme.titleMedium?.copyWith(fontFamily: 'serif')),
      const SizedBox(height: 6),
      Text('${note.placeName} · ${timeAgo(note.heardAt)} · $who', style: theme.textTheme.bodySmall),
      const SizedBox(height: 4),
      Text('$origin · $state', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.primary)),
    ],
  );
}
