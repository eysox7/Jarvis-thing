import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { seedDemoContent, seedPlaces } from './seed.js';
import { purgeExpiredSessions } from './auth.js';
import { purgeStaleData } from './domain.js';
import { createAiModerator } from './ai-moderation.js';

const config = loadConfig();
const db = openDb(config.dbPath);
seedPlaces(db);
if (config.demoMode) await seedDemoContent(db);

// Bakım: süresi dolan oturumlar ve saklama süresini aşan konum verileri saatte bir silinir.
const maintain = () => {
  purgeExpiredSessions(db);
  purgeStaleData(db, config);
};
maintain();
setInterval(maintain, 3600000).unref();

const ai = await createAiModerator(config);
if (ai) console.log(`Yapay zekâ denetimi açık (${config.aiModel})`);
const app = createApp({ db, config, ai });
const server = createServer(app.handler);
// Overheard Kafe: açık masalara sıradaki fişler.
setInterval(() => app.tickVenues(), 60000).unref();

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
