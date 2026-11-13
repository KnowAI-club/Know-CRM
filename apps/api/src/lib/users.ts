import { one } from '../db/pool.js';
import { badRequest } from './errors.js';

/** Ensures the id is an active, non-client team member (or the unchanged previous value). */
export async function assertActiveStaff(id: string | null | undefined, message: string, previous?: string | null) {
  if (!id) return;
  if (previous && id === previous) return;
  const u = await one(`SELECT 1 FROM users WHERE id=$1 AND role <> 'client' AND disabled_at IS NULL`, [id]);
  if (!u) throw badRequest(message);
}

export async function userName(id: string | null | undefined) {
  if (!id) return null;
  return (await one<{ name: string }>('SELECT name FROM users WHERE id=$1', [id]))?.name ?? null;
}
