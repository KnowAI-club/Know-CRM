import { env } from './config/env.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { createApp } from './app.js';
import { startWorker } from './jobs/runner.js';

await migrate();
const app = createApp();
const server = app.listen(env.API_PORT, env.API_HOST, () => {
  console.log(`[api] listening on http://${env.API_HOST}:${env.API_PORT}`);
});
const stopWorker = env.WORKER_ENABLED ? startWorker() : () => undefined;

async function shutdown(signal: string) {
  console.log(`[api] ${signal} received, shutting down`);
  stopWorker();
  server.close();
  await pool.end().catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
