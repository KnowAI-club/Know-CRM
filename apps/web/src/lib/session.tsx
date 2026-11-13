'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { get, post } from './api';

export type Role = 'admin' | 'sales' | 'designer' | 'developer' | 'client';
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}
export interface Workspace {
  name: string;
  currency: string;
  timezone: string;
  data: Record<string, any>;
}
interface Status {
  needsSetup: boolean;
  user: User | null;
  workspace: Workspace | null;
}

interface SessionValue {
  status: Status | null;
  user: User | null;
  workspace: Workspace | null;
  currency: string;
  isAdmin: boolean;
  isStaff: boolean;
  refresh: () => Promise<Status>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const refresh = useCallback(async () => {
    const s = await get<Status>('/auth/status');
    setStatus(s);
    return s;
  }, []);
  const logout = useCallback(async () => {
    await post('/auth/logout').catch(() => undefined);
    // A full reload clears every cached client state after sign-out.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/login');
  }, []);
  useEffect(() => {
    void refresh().catch(() => setStatus({ needsSetup: false, user: null, workspace: null }));
    const expired = () => void refresh();
    window.addEventListener('crm:session-expired', expired);
    return () => window.removeEventListener('crm:session-expired', expired);
  }, [refresh]);
  const user = status?.user ?? null;
  return (
    <SessionContext.Provider
      value={{
        status,
        user,
        workspace: status?.workspace ?? null,
        currency: status?.workspace?.currency ?? 'INR',
        isAdmin: user?.role === 'admin',
        isStaff: !!user && user.role !== 'client',
        refresh,
        logout,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}
