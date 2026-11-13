'use client';
import { useEffect, useState } from 'react';
import { get, writeCount } from '@/lib/api';

export interface TargetOption {
  id: string;
  name: string;
  sub: string;
}
export interface Targets {
  leads: TargetOption[];
  projects: TargetOption[];
  loaded: boolean;
}

let cache: Promise<Omit<Targets, 'loaded'>> | null = null;
let cachedAt = -1;

/** Open leads and live projects that tasks, meetings and reminders can be linked to. */
export function useTargets(): Targets {
  const [value, setValue] = useState<Targets>({ leads: [], projects: [], loaded: false });
  useEffect(() => {
    if (cachedAt !== writeCount()) cache = null;
    cachedAt = writeCount();
    cache ??= Promise.all([get<any[]>('/leads?state=active'), get<any[]>('/projects')])
      .then(([active, projects]) => ({
        leads: active
          .map((l) => ({ id: l.id, name: l.name, sub: l.data?.company || l.email || '' }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        projects: projects
          .filter((p) => !['completed', 'archived'].includes(p.stage_category))
          .map((p) => ({ id: p.id, name: p.name, sub: p.company || p.contact_name || '' }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .catch((e) => {
        cache = null;
        throw e;
      });
    let live = true;
    cache.then((t) => live && setValue({ ...t, loaded: true })).catch(() => live && setValue((v) => ({ ...v, loaded: true })));
    return () => {
      live = false;
    };
  }, []);
  return value;
}

/** Encodes a link target for a <select>: "lead:<id>" or "project:<id>". */
export type TargetValue = `lead:${string}` | `project:${string}` | '';

export function splitTarget(v: TargetValue) {
  const [kind, id] = v.split(':') as ['lead' | 'project' | '', string | undefined];
  return { leadId: kind === 'lead' ? id! : null, projectId: kind === 'project' ? id! : null };
}
