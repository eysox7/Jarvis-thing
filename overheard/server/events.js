// Server-Sent Events: her kullanıcıya açık bağlantıları üzerinden canlı bildirim.
// Bir kullanıcının aynı anda en fazla bu kadar açık bağlantısı olur; fazlası en eskisini kapatır.
const MAX_STREAMS_PER_USER = 5;

export function createEventHub() {
  const clients = new Map();

  const heartbeat = setInterval(() => {
    for (const set of clients.values()) for (const res of set) res.write(': ping\n\n');
  }, 25000);
  heartbeat.unref();

  return {
    subscribe(userId, req, res) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write('retry: 5000\n\n');
      if (!clients.has(userId)) clients.set(userId, new Set());
      const set = clients.get(userId);
      set.add(res);
      while (set.size > MAX_STREAMS_PER_USER) {
        const oldest = set.values().next().value;
        set.delete(oldest);
        oldest.end();
      }
      req.on('close', () => {
        const set = clients.get(userId);
        if (!set) return;
        set.delete(res);
        if (!set.size) clients.delete(userId);
      });
    },

    publish(userId, type, data) {
      const set = clients.get(userId);
      if (!set) return;
      const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const res of set) res.write(payload);
    },

    count(userId) {
      return clients.get(userId)?.size || 0;
    },

    close() {
      clearInterval(heartbeat);
      for (const set of clients.values()) for (const res of set) res.end();
      clients.clear();
    },
  };
}
