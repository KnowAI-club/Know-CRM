'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { post, ApiError } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { useSession } from '@/lib/session';
import { Button, Field, Spinner } from '@/components/ui';
import { CURRENCIES } from '@know-crm/shared';
import { BrandMark } from '@/components/shell/BrandMark';

export default function LoginPage() {
  const router = useRouter();
  const { status, refresh } = useSession();
  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: '', currency: 'INR' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setup = status?.needsSetup;

  useEffect(() => {
    if (status?.user) router.replace(status.user.role === 'client' ? '/portal' : '/');
  }, [status, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (setup) await post('/setup', form);
      else await post('/auth/login', { email: form.email, password: form.password });
      const s = await refresh();
      router.replace(s.user?.role === 'client' ? '/portal' : '/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!status || status.user) return <Spinner />;
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <BrandMark className="h-9 w-9 rounded-xl" />
          <span className="text-lg font-semibold">{BRAND}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{setup ? 'Set up your workspace' : 'Welcome back'}</h1>
        <p className="mt-1 mb-6 text-sm text-mute">
          {setup ? 'Create the first admin account. You can invite your team afterwards.' : 'Sign in to continue to your workspace.'}
        </p>
        <form onSubmit={submit} className="card space-y-4 p-5">
          {setup && (
            <>
              <Field label="Workspace name" required>
                <input className="input" value={form.workspaceName} onChange={set('workspaceName')} required maxLength={120} />
              </Field>
              <Field label="Your name" required>
                <input className="input" value={form.name} onChange={set('name')} required maxLength={120} autoComplete="name" />
              </Field>
            </>
          )}
          <Field label="Email" required>
            <input className="input" type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
          </Field>
          <Field label="Password" required hint={setup ? 'At least 12 characters.' : undefined}>
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={set('password')}
              required
              minLength={setup ? 12 : 1}
              autoComplete={setup ? 'new-password' : 'current-password'}
            />
          </Field>
          {setup && (
            <Field label="Currency">
              <select className="input" value={form.currency} onChange={set('currency')}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          )}
          {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full justify-center" loading={busy}>
            {setup ? 'Create workspace' : 'Sign in'}
          </Button>
        </form>
      </div>
    </main>
  );
}
