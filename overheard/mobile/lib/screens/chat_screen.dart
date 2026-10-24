import 'dart:async';

import 'package:flutter/material.dart';

import '../app/app.dart';
import '../core/models.dart';
import '../l10n/strings.dart';

// Bir söz üzerinden başlayan konuşma. Açıkken birkaç saniyede bir yenilenir.
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.conversationId});

  final String conversationId;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _text = TextEditingController();
  Conversation? _conversation;
  Object? _error;
  bool _sending = false;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(const Duration(seconds: 5), (_) => _load());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final conversation = await AppScope.read(context).conversation(widget.conversationId);
      if (mounted) {
        setState(() {
          _conversation = conversation;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _send() async {
    final body = _text.text.trim();
    if (body.isEmpty || _sending) return;
    setState(() => _sending = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await AppScope.read(context).sendMessage(widget.conversationId, body);
      _text.clear();
      await _load();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorText(e))));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _reveal() async {
    try {
      final conversation = await AppScope.read(context).reveal(widget.conversationId);
      if (mounted) setState(() => _conversation = conversation);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final c = _conversation;
    final hint = c == null
        ? ''
        : c.kind == 'witness'
        ? t('chat.witnessHint')
        : c.role == 'owner'
        ? t('chat.ownerHint')
        : t('chat.starterHint');
    return Scaffold(
      appBar: AppBar(title: Text(c == null ? t('inbox.title') : c.withHandle ?? t('anon.name'))),
      body: Column(
        children: [
          if (c != null)
            Container(
              width: double.infinity,
              color: theme.colorScheme.surfaceContainerHighest,
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(t('chat.about'), style: theme.textTheme.labelSmall),
                  Text('“${c.overheardText}” · ${c.placeName}', style: theme.textTheme.bodyMedium),
                  const SizedBox(height: 4),
                  Text(hint, style: theme.textTheme.bodySmall),
                  if (c.mutualPlaces.isNotEmpty)
                    Text('📍 ${t('chat.mutual')}: ${c.mutualPlaces.join(', ')}', style: theme.textTheme.bodySmall),
                  if (c.canReveal)
                    Row(
                      children: [
                        Expanded(child: Text(t('chat.revealHint'), style: theme.textTheme.bodySmall)),
                        TextButton(onPressed: _reveal, child: Text(t('chat.reveal'))),
                      ],
                    ),
                ],
              ),
            ),
          Expanded(
            child: c == null
                ? Center(child: _error == null ? const CircularProgressIndicator() : Text(errorText(_error!)))
                : ListView.builder(
                    reverse: true,
                    padding: const EdgeInsets.all(12),
                    itemCount: c.messages.length,
                    itemBuilder: (context, i) => _Bubble(message: c.messages[c.messages.length - 1 - i]),
                  ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 8, 8),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _text,
                      minLines: 1,
                      maxLines: 4,
                      maxLength: 1000,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: InputDecoration(
                        hintText: t('chat.placeholder'),
                        counterText: '',
                        border: const OutlineInputBorder(),
                      ),
                    ),
                  ),
                  IconButton.filled(
                    onPressed: _sending || c == null ? null : _send,
                    tooltip: t('chat.send'),
                    icon: const Icon(Icons.send),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message});

  final Message message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final mine = message.fromMe;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 3),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.75),
        decoration: BoxDecoration(
          color: mine ? accent : theme.colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(message.body, style: TextStyle(color: mine ? Colors.white : null)),
            Text(
              timeAgo(message.createdAt),
              style: theme.textTheme.labelSmall?.copyWith(color: mine ? Colors.white70 : null),
            ),
          ],
        ),
      ),
    );
  }
}
