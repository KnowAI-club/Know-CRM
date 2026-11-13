'use client';
import { useState, type FormEvent } from 'react';
import { KeyRound, Link2, UserMinus } from 'lucide-react';
import { del, get, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { Avatar, Button, Card, Empty, Field, useConfirm, useToast } from '@/components/ui';
import type { Participant } from './types';
import { fieldErrors } from './util';

interface ClientUser {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

/** Admin-only: portal logins for the client on this project. */
export function AccessTab({
  projectId,
  participants,
  contact,
  onChange,
}: {
  projectId: string;
  participants: Participant[];
  contact: Record<string, any> | null;
  onChange: (p: Participant[]) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data: clients, reload } = useLoad((s) => get<ClientUser[]>('/clients', s), []);
  const [form, setForm] = useState({ name: contact?.name ?? '', email: contact?.email ?? '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [linkId, setLinkId] = useState('');

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!form.email.trim()) local.email = 'Enter the client’s email.';
    if (form.password.length < 12) local.password = 'Use at least 12 characters.';
    setErrors(local);
    if (Object.keys(local).length) return;
    setSaving(true);
    try {
      const { user } = await post<{ user: Participant }>(`/projects/${projectId}/client-access`, form);
      onChange([...participants, user]);
      setForm({ ...form, password: '' });
      toast.success('Portal access created. Share the email and password with your client securely.');
      void reload();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const link = async () => {
    if (!linkId) return;
    try {
      const { user } = await post<{ user: Participant }>(`/projects/${projectId}/client-links`, { clientUserId: linkId });
      if (!participants.some((p) => p.id === user.id)) onChange([...participants, user]);
      setLinkId('');
      toast.success(`${user.name} can now see this project`);
    } catch (e) {
      toast.error(e);
    }
  };

  const revoke = async (p: Participant) => {
    if (
      !(await confirm({
        title: `Revoke ${p.name}'s access?`,
        description: 'They will no longer see this project in the portal. Their shared tasks become internal.',
        confirmLabel: 'Revoke',
        danger: true,
      }))
    )
      return;
    try {
      await del(`/projects/${projectId}/client-links/${p.id}`);
      onChange(participants.filter((x) => x.id !== p.id));
    } catch (e) {
      toast.error(e);
    }
  };

  const linkable = (clients ?? []).filter((c) => c.active && !participants.some((p) => p.id === c.id));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="People with portal access" icon={<KeyRound className="h-4 w-4" />} bodyClassName="p-0">
        {!participants.length ? (
          <Empty
            title="No portal access yet"
            description="Create a login so the client can follow progress, review documents and pay invoices."
          />
        ) : (
          <ul className="divide-y divide-line">
            {participants.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar name={p.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="truncate text-xs text-mute">{p.email}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => revoke(p)}>
                  <UserMinus className="h-3.5 w-3.5" /> Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
        {linkable.length > 0 && (
          <div className="flex gap-2 border-t border-line p-4">
            <select
              className="input flex-1"
              value={linkId}
              onChange={(e) => setLinkId(e.target.value)}
              aria-label="Existing client account"
            >
              <option value="">Link an existing client account…</option>
              {linkable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.email}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={link} disabled={!linkId}>
              <Link2 className="h-4 w-4" /> Link
            </Button>
          </div>
        )}
      </Card>
      <Card title="Create a portal login">
        <form onSubmit={create} className="space-y-3" noValidate>
          <Field label="Name" error={errors.name}>
            <input className="input" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Email" required error={errors.email}>
            <input
              className="input"
              type="email"
              autoComplete="off"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field
            label="Temporary password"
            required
            error={errors.password}
            hint="At least 12 characters. The client can change it after signing in."
          >
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <Button type="submit" loading={saving}>
            Create login
          </Button>
        </form>
      </Card>
    </div>
  );
}
