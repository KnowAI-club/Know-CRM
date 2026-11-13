'use client';
import { useEffect, useState } from 'react';
import { get } from './api';
import type { User } from './session';

export interface TeamMember extends User {
  disabled_at?: string | null;
}

let cache: Promise<TeamMember[]> | null = null;

/** Active team members (non-client), cached for the page session. */
export function useTeam() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  useEffect(() => {
    cache ??= get<TeamMember[]>('/team').catch((e) => {
      cache = null;
      throw e;
    });
    cache.then((list) => setTeam(list.filter((u) => u.role !== 'client' && !u.disabled_at))).catch(() => undefined);
  }, []);
  return team;
}

export function resetTeamCache() {
  cache = null;
}
