import { readdir, readFile } from 'node:fs/promises';
import { pool } from './pool.js';
import { env } from '../config/env.js';

const dir = new URL('./migrations/', import.meta.url);

/** Applies pending numbered SQL migrations under an advisory lock. */
export async function migrate(log = true) {
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${env.DATABASE_SCHEMA}"`);
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`know-crm-migrations:${env.DATABASE_SCHEMA}`]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    const files = (await readdir(dir)).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
    for (const file of files) {
      const version = Number(file.slice(0, 3));
      if (applied.has(version)) continue;
      await client.query(await readFile(new URL(file, dir), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version, name) VALUES($1,$2)', [version, file]);
      if (log) console.log(`[db] applied ${file}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
