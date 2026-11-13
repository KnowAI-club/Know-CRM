import { Router } from 'express';
import { many } from '../../db/pool.js';
import { currentUser, requireStaff } from '../../middleware/auth.js';

export const router = Router();

interface Hit {
  id: string;
  title: string;
  sub: string;
  link: string;
  at: string | Date | null;
  archived?: boolean;
  download?: string;
  score?: number;
}

const escapeLike = (w: string) => w.replace(/[\\%_]/g, (c) => `\\${c}`);

export function scoreTitle(title: string, q: string, words: string[]) {
  const t = title.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 85;
  const titleWords = t.split(/[^a-z0-9@.]+/).filter(Boolean);
  if (words.every((w) => titleWords.some((tw) => tw.startsWith(w)))) return 70;
  if (t.includes(q)) return 55;
  if (words.every((w) => t.includes(w))) return 45;
  return 20;
}

/** GET /search?q= — grouped, scored matches across the workspace. */
router.get('/search', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const q = String(req.query.q ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 100);
  const words = [...new Set(q.split(' ').filter(Boolean))].slice(0, 6);
  if (!words.length) return void res.json({ groups: [] });
  const patterns = words.map((w) => `%${escapeLike(w)}%`);
  const match = (fields: string) => `concat_ws(' ', ${fields}) ILIKE ALL($1::text[])`;
  const admin = me.role === 'admin';

  const sources: Record<string, Promise<Hit[]>> = {
    leads: many(
      `SELECT l.id, l.name AS title, CASE WHEN l.state='nurture' THEN 'Nurture' ELSE s.label END || ' · ' || COALESCE(NULLIF(l.data->>'company',''), l.email) AS sub,
              '/leads/' || l.id AS link, l.updated_at AS at
         FROM leads l JOIN lead_stages s ON s.id=l.stage
        WHERE l.state IN ('active','nurture') AND ${match(`l.name, l.email, l.data->>'company', l.data->>'phone'`)} LIMIT 30`,
      [patterns],
    ),
    projects: many(
      `SELECT p.id, p.name AS title, c.name || ' · ' || s.label AS sub, '/projects/' || p.id AS link, p.updated_at AS at, s.category='archived' AS archived
         FROM projects p JOIN contacts c ON c.id=p.contact_id JOIN project_stages s ON s.id=p.stage
        WHERE p.phase <> 'intake' AND ${match('p.name, c.name, c.company, p.project_type, p.description')} LIMIT 30`,
      [patterns],
    ),
    contacts: many(
      `SELECT id, name AS title, concat_ws(' · ', NULLIF(company,''), NULLIF(email,'')) AS sub, '/clients?contact=' || id AS link, updated_at AS at
         FROM contacts WHERE ${match('name, email, company, phone, business_name, business_email, personal_email, poc_name, poc_email')} LIMIT 30`,
      [patterns],
    ),
    files: many(
      `SELECT * FROM (
         SELECT f.id, f.name AS title, p.name || COALESCE(' · ' || t.label, '') AS sub, '/projects/' || p.id || '?tab=files' AS link,
                f.created_at AS at, '/api/files/' || f.id || '/download' AS download
           FROM files f JOIN projects p ON p.id=f.project_id LEFT JOIN file_types t ON t.id=f.file_type_id
          WHERE ${match('f.name, p.name, t.label')}
         UNION ALL
         SELECT a.id, COALESCE(NULLIF(a.title,''), a.name), l.name || COALESCE(' · ' || t.label, ''), '/leads/' || l.id || '?tab=files',
                a.created_at, '/api/lead-attachments/' || a.id || '/download'
           FROM lead_attachments a JOIN leads l ON l.id=a.lead_id LEFT JOIN file_types t ON t.id=a.file_type_id
          WHERE ${match('a.title, a.name, l.name, t.label')}
       ) x LIMIT 30`,
      [patterns],
    ),
    tasks: many(
      `SELECT t.id, t.title, COALESCE(p.name, l.name, '') AS sub,
              CASE WHEN t.project_id IS NOT NULL THEN '/projects/' || t.project_id || '?tab=tasks' ELSE '/leads/' || t.lead_id || '?tab=tasks' END AS link,
              t.created_at AS at, t.completed AS archived
         FROM tasks t LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN leads l ON l.id=t.lead_id
        WHERE ($2 OR t.assignee_id=$3) AND ${match('t.title, p.name, l.name')} LIMIT 30`,
      [patterns, admin, me.id],
    ),
    meetings: many(
      `SELECT m.id, m.title, COALESCE(p.name, l.name, '') AS sub, '/meetings/' || m.id AS link, m.start_at AS at, m.status='cancelled' AS archived
         FROM meetings m LEFT JOIN projects p ON p.id=m.project_id LEFT JOIN leads l ON l.id=m.lead_id
        WHERE ${match('m.title, p.name, l.name')} LIMIT 30`,
      [patterns],
    ),
    notes: many(
      `SELECT n.id, left(regexp_replace(n.body, '\\s+', ' ', 'g'), 90) AS title, p.name AS sub, '/projects/' || p.id || '?tab=notes' AS link, n.created_at AS at
         FROM notes n JOIN projects p ON p.id=n.project_id WHERE ${match('n.body')}
       UNION ALL
       SELECT n.id, n.title, l.name, '/leads/' || l.id || '?tab=meetings', n.created_at
         FROM lead_notes n JOIN leads l ON l.id=n.lead_id WHERE ${match('n.title, n.body')}
       LIMIT 30`,
      [patterns],
    ),
    documents: many(
      `SELECT d.id, d.title, initcap(d.kind) || ' · ' || p.name AS sub, '/documents/' || d.id AS link, d.updated_at AS at
         FROM documents d JOIN projects p ON p.id=d.project_id WHERE ${match('d.title, d.kind, p.name')} LIMIT 30`,
      [patterns],
    ),
    reminders: many(
      `SELECT r.id, r.title, COALESCE(p.name, l.name, '') AS sub, '/reminders' AS link, r.run_at AS at, r.status IN ('sent','cancelled','skipped') AS archived
         FROM reminders r LEFT JOIN projects p ON p.id=r.project_id LEFT JOIN leads l ON l.id=r.lead_id
        WHERE (r.created_by=$2 OR r.recipient_id=$2) AND NOT r.auto_notice AND ${match('r.title, r.body, p.name, l.name')} LIMIT 30`,
      [patterns, me.id],
    ),
    templates: many(
      `SELECT id, title, id || ' · ' || subject AS sub, '/templates' AS link, updated_at AS at
         FROM email_templates WHERE ${match('id, title, subject')} LIMIT 30`,
      [patterns],
    ),
  };

  const keys = Object.keys(sources);
  const results = await Promise.all(keys.map((k) => sources[k]!));
  const groups = keys
    .map((key, i) => {
      const rows = results[i]!.map((h) => ({
        ...h,
        score: (key === 'notes' ? 25 : scoreTitle(h.title ?? '', q, words)) - (h.archived ? 15 : 0),
      }));
      rows.sort(
        (a, b) => b.score - a.score || +new Date(b.at ?? 0) - +new Date(a.at ?? 0) || String(a.title).localeCompare(String(b.title)),
      );
      return { key, order: i, total: rows.length, more: rows.length >= 30, best: rows[0]?.score ?? 0, items: rows.slice(0, 6) };
    })
    .filter((g) => g.total > 0)
    .sort((a, b) => b.best - a.best || a.order - b.order)
    .map(({ order, best, ...g }) => g);
  res.json({ groups });
});
