'use client';
import { useEffect, useState } from 'react';

/** Current time in ms, refreshed every `intervalMs` so time-based UI stays current. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
