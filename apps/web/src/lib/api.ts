export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: { fields?: Record<string, string> },
  ) {
    super(message);
  }
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

/** Calls the CRM API (same origin, proxied by Next.js) with the session cookie. */
export async function api<T = unknown>(path: string, options: { method?: string; body?: Body; signal?: AbortSignal } = {}): Promise<T> {
  const { method = options.body ? 'POST' : 'GET', body, signal } = options;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method,
    signal,
    credentials: 'same-origin',
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('crm:session-expired'));
    const err = typeof data === 'object' && data ? data : { error: String(data) };
    throw new ApiError(res.status, err.error || `Request failed (${res.status})`, err.code, err.details);
  }
  return data as T;
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T>(path: string, body?: Body) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T>(path: string, body: Body) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body: Body) => api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
}
