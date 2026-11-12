import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '../config/env.js';

// Return DATE columns as plain 'YYYY-MM-DD' strings and NUMERIC as numbers.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 10_000,
  options: `-c search_path=${env.DATABASE_SCHEMA},public`,
});

interface Tx {
  client: pg.PoolClient;
  /** Tail of the query queue: a transaction client must run one query at a time. */
  tail: Promise<unknown>;
}

const txStore = new AsyncLocalStorage<Tx>();

export type Row = Record<string, any>;

/** Runs a parameterised query on the active transaction (if any) or the pool. */
export async function query<T extends Row = Row>(sql: string, params: unknown[] = []) {
  const tx = txStore.getStore();
  if (!tx) return pool.query<T>(sql, params);
  const run = tx.tail.then(() => tx.client.query<T>(sql, params));
  tx.tail = run.catch(() => undefined);
  return run;
}

export async function many<T extends Row = Row>(sql: string, params: unknown[] = []) {
  return (await query<T>(sql, params)).rows;
}

export async function one<T extends Row = Row>(sql: string, params: unknown[] = []) {
  return (await query<T>(sql, params)).rows[0] as T | undefined;
}

/** Runs fn inside a transaction; nested calls reuse the outer transaction. */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (txStore.getStore()) return fn();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await txStore.run({ client, tail: Promise.resolve() }, fn);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
