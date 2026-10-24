import 'package:flutter/material.dart';

import '../app/app.dart';
import '../core/models.dart';
import '../l10n/strings.dart';
import 'chat_screen.dart';

// Sözler üzerinden başlayan konuşmalar.
class MessagesScreen extends StatefulWidget {
  const MessagesScreen({super.key});

  @override
  State<MessagesScreen> createState() => MessagesScreenState();
}

class MessagesScreenState extends State<MessagesScreen> {
  List<ConversationSummary>? _list;
  Object? _error;

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<void> reload() async {
    try {
      final list = await AppScope.read(context).conversations();
      if (mounted) {
        setState(() {
          _list = list;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _open(ConversationSummary c) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ChatScreen(conversationId: c.id)));
    await reload();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final list = _list;
    return Scaffold(
      appBar: AppBar(title: Text(t('inbox.title'))),
      body: RefreshIndicator(
        onRefresh: reload,
        child: list == null
            ? ListView(
                children: [
                  Padding(
                    padding: const EdgeInsets.all(32),
                    child: Center(child: _error == null ? const CircularProgressIndicator() : Text(errorText(_error!))),
                  ),
                ],
              )
            : list.isEmpty
            ? ListView(
                children: [
                  Padding(
                    padding: const EdgeInsets.all(32),
                    child: Text(t('inbox.empty'), textAlign: TextAlign.center),
                  ),
                ],
              )
            : ListView.separated(
                itemCount: list.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, i) {
                  final c = list[i];
                  final last = c.lastMessage == null ? '' : '${c.lastFromMe ? t('inbox.you') : ''}${c.lastMessage}';
                  return ListTile(
                    onTap: () => _open(c),
                    leading: CircleAvatar(child: Text(c.withHandle == null ? '👂' : c.withHandle![0].toUpperCase())),
                    title: Text(
                      c.withHandle ?? t('anon.name'),
                      style: c.unread ? const TextStyle(fontWeight: FontWeight.w700) : null,
                    ),
                    subtitle: Text(
                      '“${c.overheardText}”\n$last',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall,
                    ),
                    isThreeLine: true,
                    trailing: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(timeAgo(c.lastAt), style: theme.textTheme.labelSmall),
                        if (c.unread) const Icon(Icons.circle, size: 10, color: accent),
                      ],
                    ),
                  );
                },
              ),
      ),
    );
  }
}
