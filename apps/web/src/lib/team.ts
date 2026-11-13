'use client';
import { useEffect, useState } from 'react';
import { get, writeCount } from './api';
import type { User } from './session';

export interface TeamMember extends User {
  active?: boolean;
}

let cache: Promise<TeamMember[]> | null = null;
let cachedAt = -1;

/** Active team members (non-client), cached until the next save anywhere in the app. */
export function useTeam() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  useEffect(() => {
    if (cachedAt !== writeCount()) cache = null;
    cachedAt = writeCount();
    cache ??= get<TeamMember[]>('/team').catch((e) => {
      cache = null;
      throw e;
    });
    cache.then((list) => setTeam(list.filter((u) => u.role !== 'client' && u.active !== false))).catch(() => undefined);
  }, []);
  return team;
}

export function resetTeamCache() {
  cache = null;
}
