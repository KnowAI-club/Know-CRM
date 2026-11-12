import { Router, type Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { many, one, query } from '../../db/pool.js';
import { parse } from '../../lib/validate.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { leadHistory, projectActivity } from '../../lib/activity.js';
import { deleteObject, putObject, streamObject, objectExists } from '../../lib/storage.js';
import { currentUser, requireStaff } from '../../middleware/auth.js';
import { projectFor } from '../projects/access.js';

export const router = Router();
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 10 },
});
const idParam = z.object({ id: z.string().uuid() });

/** Cleans a display filename; keeps the original extension when renaming. */
export function displayName(original: string, requested?: string) {
  const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 200);
  const ext = path.extname(original).toLowerCase();
  const safeExt = /^\.[a-z0-9]{1,16}$/.test(ext) ? ext : '';
  const base = clean(requested || '') || clean(path.basename(original)) || 'file';
  return safeExt && !base.toLowerCase().endsWith(safeExt) ? `${base}${safeExt}` : base;
}

export async function requireFileType(id: unknown) {
  if (!id || typeof id !== 'string') throw badRequest('Choose a file type.');
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await one('SELECT 1 FROM file_types WHERE id=$1', [id])))
    throw badRequest('That file type no longer exists. Choose another.');
  return id;
}

export async function sendStored(res: Response, key: string, name: string, size: number) {
  if (!(await objectExists(key))) throw notFound('Stored file');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(size));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  streamObject(key).pipe(res);
}

/* ---------- Project files ---------- */

router.get('/files', requireStaff, async (_req, res) => {
  const project = await many(
    `SELECT f.id, 'project' AS source, f.project_id AS owner_id, p.name AS owner_name, f.name, f.name AS title, f.size, f.mime,
            f.visibility, f.to_share, f.file_type_id, ft.label AS file_type_label, f.created_at, false AS locked
       FROM files f JOIN projects p ON p.id=f.project_id LEFT JOIN file_types ft ON ft.id=f.file_type_id`,
  );
  const lead = await many(
    `SELECT a.id, 'lead' AS source, a.lead_id AS owner_id, l.name AS owner_name, a.name, COALESCE(NULLIF(a.title,''), a.name) AS title,
            a.size, a.mime, 'internal' AS visibility, a.to_share, a.file_type_id, ft.label AS file_type_label, a.created_at,
            l.state='won' AS locked
       FROM lead_attachments a JOIN leads l ON l.id=a.lead_id LEFT JOIN file_types ft ON ft.id=a.file_type_id`,
  );
  res.json([...project, ...lead].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)));
});

router.post('/projects/:id/files', requireStaff, async (req, res, next) => {
  const { id } = parse(idParam, req.params);
  await projectFor(req, id, true);
  upload.single('file')(req, res, next);
}, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  if (!req.file) throw badRequest('Choose a file to upload.');
  const fileTypeId = await requireFileType(req.body.fileTypeId);
  const vis = parse(z.enum(['internal', 'client']).default('internal'), req.body.visibility || undefined);
  const name = displayName(req.file.originalname, req.body.name);
  const key = await putObject('files', req.file.buffer);
  try {
    const file = await one(
      `INSERT INTO files(project_id,name,size,mime,visibility,file_type_id,storage_key,uploaded_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, project_id, name, size, mime, visibility, to_share, file_type_id, created_at`,
      [id, name, req.file.size, req.file.mimetype || 'application/octet-stream', vis, fileTypeId, key, me.id],
    );
    await projectActivity(me, id, `File uploaded: ${name} (${vis === 'client' ? 'shared with the client' : 'internal'})`);
    res.status(201).json(file);
  } catch (e) {
    await deleteObject(key);
    throw e;
  }
});

router.get('/files/:id/download', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const file = await one('SELECT * FROM files WHERE id=$1', [id]);
  if (!file) throw notFound('File');
  await projectFor(req, file.project_id);
  if (me.role === 'client' && file.visibility !== 'client') throw notFound('File');
  await sendStored(res, file.storage_key, file.name, Number(file.size));
});

router.patch('/files/:id', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const data = parse(
    z.object({
      visibility: z.enum(['internal', 'client']).optional(),
      toShare: z.boolean().optional(),
      fileTypeId: z.string().uuid().optional(),
      name: z.string().max(200).optional(),
    }),
    req.body,
  );
  if (!Object.keys(data).length) throw badRequest('Nothing to update.');
  const file = await one('SELECT * FROM files WHERE id=$1', [id]);
  if (!file) throw notFound('File');
  if (data.fileTypeId) await requireFileType(data.fileTypeId);
  let name = file.name;
  if (data.name !== undefined) {
    if (!data.name.trim()) throw badRequest('Enter a file name.');
    name = displayName(file.name, data.name);
  }
  const updated = await one(
    `UPDATE files SET visibility=COALESCE($2,visibility), to_share=COALESCE($3,to_share), file_type_id=COALESCE($4,file_type_id), name=$5
      WHERE id=$1 RETURNING id, project_id, name, size, mime, visibility, to_share, file_type_id, created_at`,
    [id, data.visibility ?? null, data.toShare ?? null, data.fileTypeId ?? null, name],
  );
  if (name !== file.name) await projectActivity(me, file.project_id, `File ${file.name} renamed to ${name}`);
  if (data.fileTypeId && data.fileTypeId !== file.file_type_id) {
    const t = await one('SELECT label FROM file_types WHERE id=$1', [data.fileTypeId]);
    await projectActivity(me, file.project_id, `File ${name} filed as ${t?.label}`);
  }
  if (data.visibility && data.visibility !== file.visibility)
    await projectActivity(me, file.project_id, `File ${name} is now ${data.visibility === 'client' ? 'shared with the client' : 'internal'}`);
  if (data.toShare !== undefined && data.toShare !== file.to_share)
    await projectActivity(me, file.project_id, `File ${name} ${data.toShare ? 'marked' : 'no longer marked'} to share`);
  res.json(updated);
});

router.delete('/files/:id', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const file = await one('DELETE FROM files WHERE id=$1 RETURNING *', [id]);
  if (!file) throw notFound('File');
  await projectActivity(me, file.project_id, `File deleted: ${file.name}`);
  await deleteObject(file.storage_key).catch(() => undefined);
  res.json({ ok: true });
});

/* ---------- Lead attachments ---------- */

async function openLead(leadId: string) {
  const lead = await one('SELECT id, state FROM leads WHERE id=$1', [leadId]);
  if (!lead) throw notFound('Lead');
  if (lead.state === 'won') throw conflict('Won evidence is frozen.');
  return lead;
}

router.get('/leads/:id/attachments', requireStaff, async (req, res) => {
  const { id } = parse(idParam, req.params);
  res.json(
    await many(
      `SELECT a.id, a.title, a.name, a.size, a.mime, a.to_share, a.file_type_id, ft.label AS file_type_label, a.created_at
         FROM lead_attachments a LEFT JOIN file_types ft ON ft.id=a.file_type_id WHERE a.lead_id=$1 ORDER BY a.created_at DESC`,
      [id],
    ),
  );
});

router.post('/leads/:id/attachments', requireStaff, async (req, res, next) => {
  const { id } = parse(idParam, req.params);
  await openLead(id);
  upload.array('files', 10)(req, res, next);
}, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw badRequest('Choose at least one file.');
  const title = parse(z.string().trim().min(1, 'Add a title.').max(200), req.body.title ?? '');
  const fileTypeId = await requireFileType(req.body.fileTypeId);
  const ids: string[] = [];
  for (const f of files) {
    if (!f.size) throw badRequest('Files cannot be empty.');
    const key = await putObject('leads', f.buffer);
    try {
      const row = await one(
        `INSERT INTO lead_attachments(lead_id,title,name,size,mime,file_type_id,storage_key,uploaded_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [id, title, displayName(f.originalname), f.size, f.mimetype || 'application/octet-stream', fileTypeId, key, me.id],
      );
      ids.push(row!.id);
      await leadHistory(id, me.id, 'Attachment uploaded', { title, name: f.originalname });
    } catch (e) {
      await deleteObject(key);
      throw e;
    }
  }
  res.status(201).json({ ids });
});

router.patch('/lead-attachments/:id', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const data = parse(
    z.object({ toShare: z.boolean().optional(), title: z.string().trim().min(1).max(200).optional(), fileTypeId: z.string().uuid().optional() }),
    req.body,
  );
  if (!Object.keys(data).length) throw badRequest('Nothing to update.');
  const a = await one('SELECT * FROM lead_attachments WHERE id=$1', [id]);
  if (!a) throw notFound('Attachment');
  await openLead(a.lead_id);
  if (data.fileTypeId) await requireFileType(data.fileTypeId);
  const updated = await one(
    `UPDATE lead_attachments SET to_share=COALESCE($2,to_share), title=COALESCE($3,title), file_type_id=COALESCE($4,file_type_id)
      WHERE id=$1 RETURNING *`,
    [id, data.toShare ?? null, data.title ?? null, data.fileTypeId ?? null],
  );
  if (data.title && data.title !== a.title) await leadHistory(a.lead_id, me.id, 'Attachment renamed', { from: a.title, title: data.title });
  if (data.fileTypeId && data.fileTypeId !== a.file_type_id) await leadHistory(a.lead_id, me.id, 'Attachment file type changed', { title: a.title });
  res.json(updated);
});

router.delete('/lead-attachments/:id', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const a = await one('SELECT * FROM lead_attachments WHERE id=$1', [id]);
  if (!a) throw notFound('Attachment');
  await openLead(a.lead_id);
  await query('DELETE FROM lead_attachments WHERE id=$1', [id]);
  await leadHistory(a.lead_id, me.id, 'Attachment deleted', { name: a.name });
  await deleteObject(a.storage_key).catch(() => undefined);
  res.json({ ok: true });
});

router.get('/lead-attachments/:id/download', requireStaff, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const a = await one('SELECT * FROM lead_attachments WHERE id=$1', [id]);
  if (!a) throw notFound('Attachment');
  await sendStored(res, a.storage_key, a.name, Number(a.size));
});
