'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Loads data for a component; re-runs when deps change and exposes reload(). */
export function useLoad<T>(loader: (signal: AbortSignal) => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const ctrl = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    try {
      const value = await loaderRef.current(c.signal);
      if (!c.signal.aborted) {
        setData(value);
        setError(undefined);
      }
    } catch (e) {
      if (!c.signal.aborted) setError(e);
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => ctrl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload, setData };
}
