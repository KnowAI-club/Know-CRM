import { env } from '../config/env.js';
import { query } from '../db/pool.js';

export interface Job {
  name: string;
  /** Minimum seconds between runs. */
  every: number;
  run: () => Promise<void>;
}

const jobs: Job[] = [];
export const registerJob = (job: Job) => jobs.push(job);

/** Runs every due job once; jobs are serialised with a Postgres advisory lock. */
export async function tick() {
  for (const job of jobs) {
    const lock = await query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [
      `know-crm-job:${job.name}`,
    ]);
    if (!lock.rows[0]?.ok) continue;
    try {
      const due = await query(
        `SELECT 1 FROM worker_runs WHERE job=$1 AND last_run_at > now() - make_interval(secs => $2)`,
        [job.name, job.every],
      );
      if (due.rowCount) continue;
      let error: string | null = null;
      try {
        await job.run();
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        console.error(`[worker] ${job.name} failed`, e);
      }
      await query(
        `INSERT INTO worker_runs(job,last_run_at,last_error) VALUES($1,now(),$2)
         ON CONFLICT (job) DO UPDATE SET last_run_at=now(), last_error=$2`,
        [job.name, error],
      );
    } finally {
      await query('SELECT pg_advisory_unlock(hashtext($1))', [`know-crm-job:${job.name}`]);
    }
  }
}

export function startWorker() {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    await tick().catch((e) => console.error('[worker]', e));
    running = false;
  }, env.WORKER_INTERVAL_SECONDS * 1000);
  console.log(`[worker] started (every ${env.WORKER_INTERVAL_SECONDS}s)`);
  return () => clearInterval(timer);
}
