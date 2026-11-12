import { one } from '../db/pool.js';

export interface WorkspaceSettings {
  name: string;
  currency: string;
  timezone: string;
  data: Record<string, any>;
}

export async function getSettings(): Promise<WorkspaceSettings | null> {
  return (await one<WorkspaceSettings>(
    'SELECT name, currency, timezone, data FROM workspace_settings WHERE id=1',
  )) ?? null;
}

export async function workspaceCurrency() {
  return (await getSettings())?.currency ?? 'INR';
}
