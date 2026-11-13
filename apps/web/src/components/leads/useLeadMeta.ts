'use client';
import { useCallback, useEffect, useState } from 'react';
import { get } from '@/lib/api';
import type { LeadOption, Stage } from './types';

/** Lead stages and shared source/industry options for pickers. */
export function useLeadMeta() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [options, setOptions] = useState<LeadOption[]>([]);
  const [error, setError] = useState<unknown>();
  const reload = useCallback(async () => {
    try {
      const [s, o] = await Promise.all([get<Stage[]>('/lead-stages'), get<LeadOption[]>('/lead-options')]);
      setStages(s);
      setOptions(o);
      setError(undefined);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return {
    stages,
    options,
    error,
    reload,
    sources: options.filter((o) => o.kind === 'source').map((o) => o.label),
    industries: options.filter((o) => o.kind === 'industry').map((o) => o.label),
    stageLabel: (id: string) => stages.find((s) => s.id === id)?.label ?? id,
  };
}
