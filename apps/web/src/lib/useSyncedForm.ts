'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Edit state for a record that can refresh underneath the form. When `base` changes,
 * fields the server changed take the new value; fields only the user changed keep
 * the user's edit.
 */
export function useSyncedForm<T extends object>(base: T) {
  const [form, setForm] = useState(base);
  const prev = useRef(base);
  useEffect(() => {
    const old = prev.current as Record<string, unknown>;
    const next = base as Record<string, unknown>;
    prev.current = base;
    setForm((f) => {
      const cur = f as Record<string, unknown>;
      const merged = { ...next };
      for (const k of Object.keys(cur)) if (cur[k] !== old[k] && next[k] === old[k]) merged[k] = cur[k];
      return merged as T;
    });
  }, [base]);
  return [form, setForm] as const;
}
