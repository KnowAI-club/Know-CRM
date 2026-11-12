import { one, query } from '../db/pool.js';
import type { SessionUser } from '../middleware/auth.js';
import { notify } from './notify.js';

/**
 * Adds an entry to a project's timeline. When the actor is a client, the
 * project owner is notified so client actions never go unseen.
 */
export async function projectActivity(
  actor: Pick<SessionUser, 'name' | 'role'> | { name: string; role?: string },
  projectId: string,
  description: string,
  visibility: 'internal' | 'client' = 'internal',
) {
  await query(
    'INSERT INTO activities(project_id, description, actor_name, visibility) VALUES($1,$2,$3,$4)',
    [projectId, description.slice(0, 2000), actor.name, visibility],
  );
  if (actor.role === 'client') {
    const project = await one<{ owner_id: string; name: string }>(
      'SELECT owner_id, name FROM projects WHERE id=$1',
      [projectId],
    );
    if (project)
      await notify({
        userId: project.owner_id,
        kind: 'client_activity',
        title: `${actor.name}: ${description}`,
        body: project.name,
        link: `/projects/${projectId}`,
      });
  }
}

/** Appends to a lead's history. actorId null means "System". */
export async function leadHistory(
  leadId: string,
  actorId: string | null,
  action: string,
  detail: Record<string, unknown> = {},
) {
  await query('INSERT INTO lead_history(lead_id, actor_id, action, detail) VALUES($1,$2,$3,$4)', [
    leadId,
    actorId,
    action,
    JSON.stringify(detail),
  ]);
}

/** “quoted snippet…” used in activity text. */
export function snippet(text: string, max = 60) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return `“${flat.length > max ? `${flat.slice(0, max)}…` : flat}”`;
}
