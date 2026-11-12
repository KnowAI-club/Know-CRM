import type { Request } from 'express';
import { one } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';
import { currentUser } from '../../middleware/auth.js';

/** Loads a project the caller may see. Clients need a portal grant; staffOnly hides it from clients. */
export async function projectFor(req: Request, id: string, staffOnly = false) {
  const me = currentUser(req);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Project');
  const project = await one(
    `SELECT p.*, s.category AS stage_category, s.label AS stage_label, s.color AS stage_color
       FROM projects p JOIN project_stages s ON s.id=p.stage WHERE p.id=$1`,
    [id],
  );
  if (!project) throw notFound('Project');
  if (me.role === 'client') {
    if (staffOnly) throw notFound('Project');
    const access = await one('SELECT 1 FROM project_access WHERE user_id=$1 AND project_id=$2', [me.id, id]);
    if (!access) throw notFound('Project');
  }
  return project;
}

export const PROJECT_SELECT = `
  SELECT p.*, s.category AS stage_category, s.label AS stage_label, s.color AS stage_color,
         c.name AS contact_name, c.company, u.name AS owner_name,
         (SELECT l.id FROM leads l WHERE l.project_id=p.id) AS source_lead_id
    FROM projects p
    JOIN project_stages s ON s.id=p.stage
    JOIN contacts c ON c.id=p.contact_id
    JOIN users u ON u.id=p.owner_id`;

/** Fields a client may see about a project. */
export function portalProject(p: Record<string, any>) {
  const fallback: Record<string, string> = {
    inquiry: 'Getting started',
    in_progress: 'In progress',
    completed: 'Completed',
    archived: 'Archived',
  };
  return {
    id: p.id,
    name: p.name,
    stage: p.stage,
    stage_category: p.stage_category,
    stage_label: p.stage_label || fallback[p.stage_category],
    stage_color: p.stage_color,
    progress: p.progress,
    due_date: p.due_date,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}
