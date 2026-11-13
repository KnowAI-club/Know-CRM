'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DATA_CHANGED } from './api';

const POLL_MS = 30_000;

/**
 * Loads data for a component; re-runs when deps change and exposes reload().
 * Also refreshes quietly (no spinner, no change unless the data differs) after any
 * save in the app, when the tab regains focus, and every 30s while visible, so
 * changes made elsewhere (other pages, other users, public forms) show up.
 */
export function useLoad<T>(loader: (signal: AbortSignal) => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const ctrl = useRef<AbortController | null>(null);
  const last = useRef<string>('');
  const loadingRef = useRef(false);

  const run = useCallback(async (quiet: boolean) => {
    if (quiet && loadingRef.current) return; // a load is already in flight
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    if (!quiet) setLoading(true);
    loadingRef.current = true;
    try {
      const value = await loaderRef.current(c.signal);
      if (c.signal.aborted) return;
      const json = JSON.stringify(value);
      if (!quiet || json !== last.current) setData(value);
      last.current = json;
      setError(undefined);
    } catch (e) {
      // A failed background refresh keeps showing the last good data.
      if (!c.signal.aborted && !quiet) setError(e);
    } finally {
      if (!c.signal.aborted) {
        loadingRef.current = false;
        if (!quiet) setLoading(false);
      }
    }
  }, []);
  const reload = useCallback(() => run(false), [run]);

  useEffect(() => {
    void reload();
    return () => ctrl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => document.visibilityState === 'visible' && void run(true), 300);
    };
    const poll = setInterval(refresh, POLL_MS);
    window.addEventListener(DATA_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener(DATA_CHANGED, refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [run]);

  return { data, error, loading, reload, setData };
}
