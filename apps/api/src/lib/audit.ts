import { query } from '../db/pool.js';
import type { SessionUser } from '../middleware/auth.js';

/** Appends to the workspace-wide change history. */
export async function audit(
  actor: Pick<SessionUser, 'id' | 'name'> | null,
  entity: string,
  entityId: string | null,
  action: string,
  summary: string,
) {
  await query(
    `INSERT INTO audit_log(actor_id, actor_name, entity, entity_id, action, summary) VALUES($1,$2,$3,$4,$5,$6)`,
    [actor?.id ?? null, actor?.name ?? 'System', entity, entityId, action, summary.slice(0, 1000)],
  );
}
