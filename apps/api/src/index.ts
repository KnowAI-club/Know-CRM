import { env } from './config/env.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { createApp } from './app.js';
import { startWorker } from './jobs/runner.js';
import { registerJobs } from './jobs/index.js';

await migrate();
if (env.DEMO_SEED) {
  const { seedDemo } = await import('./db/seed.js');
  await seedDemo();
}
const app = createApp();
const server = app.listen(env.API_PORT, env.API_HOST, () => {
  console.log(`[api] listening on http://${env.API_HOST}:${env.API_PORT}`);
});
registerJobs();
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
