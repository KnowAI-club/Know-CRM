'use client';
import { useState } from 'react';
import { Button, Card, ErrorBox, Field, Spinner, useToast } from '@/components/ui';
import { ApiError, get, post, put } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { fieldErrors } from '@/components/money/util';
import { Section } from './shared';

interface Pref {
  kind: string;
  label: string;
  inApp: boolean;
}

export function NotificationSettings() {
  const toast = useToast();
  const prefs = useLoad((s) => get<Pref[]>('/notifications/preferences', s), []);
  const toggle = async (p: Pref) => {
    prefs.setData((l) => l?.map((x) => (x.kind === p.kind ? { ...x, inApp: !p.inApp } : x)));
    try {
      await put(`/notifications/preferences/${p.kind}`, { inApp: !p.inApp });
    } catch (e) {
      prefs.setData((l) => l?.map((x) => (x.kind === p.kind ? { ...x, inApp: p.inApp } : x)));
      toast.error(e);
    }
  };
  return (
    <Section
      title="Notifications"
      description="Choose which events show in your notification bell. These settings are personal."
    >
      <Card bodyClassName="p-0">
        {prefs.error ? (
          <div className="p-4">
            <ErrorBox error={prefs.error} retry={prefs.reload} />
          </div>
        ) : !prefs.data ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-line">
            {prefs.data.map((p) => (
              <li key={p.kind}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
                  <span className="flex-1 text-sm">{p.label}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="h-4 w-4 accent-[var(--acc)]"
                    checked={p.inApp}
                    onChange={() => toggle(p)}
                  />
                </label>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Section>
  );
}

export function PasswordSettings() {
  const toast = useToast();
  const { logout } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!current) errs.currentPassword = 'Enter your current password.';
    if (next.length < 12) errs.newPassword = 'Use at least 12 characters.';
    else if (next === current) errs.newPassword = 'Choose a different password.';
    if (again !== next) errs.again = 'Passwords do not match.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await post('/auth/password', { currentPassword: current, newPassword: next });
      toast.success('Password changed. Sign in again with your new password.');
      setTimeout(() => void logout(), 1200);
    } catch (err) {
      if (err instanceof ApiError)
        setErrors(err.status === 401 ? { currentPassword: err.message } : fieldErrors(err));
      toast.error(err);
      setSaving(false);
    }
  }
  return (
    <Section title="Password" description="Changing your password signs you out on every device.">
      <Card>
        <form onSubmit={submit} className="grid max-w-md gap-4">
          <Field label="Current password" error={errors.currentPassword}>
            <input
              type="password"
              className="input"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label="New password" hint="At least 12 characters" error={errors.newPassword}>
            <input
              type="password"
              className="input"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          <Field label="Confirm new password" error={errors.again}>
            <input
              type="password"
              className="input"
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" loading={saving}>
              Change password
            </Button>
          </div>
        </form>
      </Card>
    </Section>
  );
}
