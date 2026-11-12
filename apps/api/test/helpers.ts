// Integration-test harness: an isolated PostgreSQL schema per run and a supertest agent.
process.env.DATABASE_SCHEMA = 'knowcrm_test';
process.env.WORKER_ENABLED = 'false';
process.env.MAIL_ENABLED = 'false';
process.env.NODE_ENV = 'test';

import request from 'supertest';
import { after, before } from 'node:test';

const { pool } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { createApp } = await import('../src/app.js');

export const app = createApp();
export const ADMIN = { name: 'Admin User', email: 'admin@test.local', password: 'correct-horse-battery' };

export async function resetDatabase() {
  await pool.query('DROP SCHEMA IF EXISTS knowcrm_test CASCADE');
  await migrate(false);
}

/** A cookie-keeping client signed in as the workspace admin. */
export async function adminAgent() {
  const agent = request.agent(app);
  const status = await agent.get('/api/auth/status');
  if (status.body.needsSetup) {
    await agent.post('/api/setup').send({ ...ADMIN, workspaceName: 'Test Workspace' }).expect(201);
  } else {
    await agent.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);
  }
  return agent;
}

export async function agentFor(email: string, password: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password }).expect(200);
  return agent;
}

export function setupSuite() {
  before(resetDatabase);
  after(() => pool.end());
}
