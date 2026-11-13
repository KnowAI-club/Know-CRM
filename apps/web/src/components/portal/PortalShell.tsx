'use client';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { KeyRound, LogOut } from 'lucide-react';
import { post } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Avatar, Button, Field, Menu, Modal, Spinner, useToast } from '@/components/ui';
import { fieldErrors } from '@/components/projects/util';

function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.newPassword.length < 12) return setErrors({ newPassword: 'Use at least 12 characters.' });
    if (form.newPassword !== form.confirm) return setErrors({ confirm: 'The passwords do not match.' });
    setSaving(true);
    try {
      await post('/auth/password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast.success('Password changed');
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setErrors({});
      onClose();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change password"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="pw-form" loading={saving}>
            Change password
          </Button>
        </>
      }
    >
      <form id="pw-form" onSubmit={submit} className="space-y-3" noValidate>
        <Field label="Current password" error={errors.currentPassword}>
          <input className="input" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        </Field>
        <Field label="New password" error={errors.newPassword} hint="At least 12 characters.">
          <input className="input" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        </Field>
        <Field label="Confirm new password" error={errors.confirm}>
          <input className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}

/** Minimal layout for client portal users. */
export function PortalShell({ children }: { children: ReactNode }) {
  const { status, user, workspace, logout } = useSession();
  const router = useRouter();
  const [pw, setPw] = useState(false);

  useEffect(() => {
    if (!status) return;
    if (!status.user) router.replace('/login');
    else if (status.user.role !== 'client') router.replace('/');
  }, [status, router]);

  if (!status || !user || user.role !== 'client') return <Spinner />;

  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-20 border-b border-line bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link href="/portal" className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-acc text-sm font-bold text-acc-ink">
              {(workspace?.name || 'K').slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate text-sm font-semibold">{workspace?.name}</span>
            <span className="hidden text-sm text-mute sm:inline">· Client portal</span>
          </Link>
          <div className="ml-auto">
            <Menu
              trigger={(open) => (
                <button onClick={open} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-subtle" aria-label="Account menu">
                  <Avatar name={user.name} size="sm" />
                  <span className="hidden text-sm sm:inline">{user.name}</span>
                </button>
              )}
              items={[
                { label: 'Change password', icon: <KeyRound className="h-4 w-4" />, onSelect: () => setPw(true) },
                { label: 'Sign out', icon: <LogOut className="h-4 w-4" />, onSelect: () => void logout() },
              ]}
            />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      <PasswordModal open={pw} onClose={() => setPw(false)} />
    </div>
  );
}
