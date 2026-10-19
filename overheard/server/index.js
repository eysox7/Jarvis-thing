import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { seedDemoContent, seedPlaces } from './seed.js';
import { purgeExpiredSessions } from './auth.js';

const config = loadConfig();
const db = openDb(config.dbPath);
seedPlaces(db);
if (config.demoMode) await seedDemoContent(db);

purgeExpiredSessions(db);
setInterval(() => purgeExpiredSessions(db), 3600000).unref();

const app = createApp({ db, config });
const server = createServer(app.handler);

server.listen(config.port, config.host, () => {
  console.log(`Overheard ${config.demoMode ? '(demo modu) ' : ''}http://localhost:${config.port}`);
});

function shutdown() {
  app.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
