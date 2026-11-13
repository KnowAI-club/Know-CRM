'use client';
import { useState } from 'react';
import { MoreHorizontal, Plus, UserCheck, UserX } from 'lucide-react';
import { ROLE_LABELS, TEAM_ROLES } from '@know-crm/shared';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Menu,
  Modal,
  Spinner,
  useConfirm,
  useToast,
} from '@/components/ui';
import { ApiError, get, patch, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { resetTeamCache } from '@/lib/team';
import { date } from '@/lib/format';
import { fieldErrors } from '@/components/money/util';
import { Section } from './shared';

interface Member {
  id: string;
  name: string;
  email: string;
  role: (typeof TEAM_ROLES)[number];
  phone: string | null;
  active: boolean;
  created_at: string;
}

export function TeamSettings() {
  const toast = useToast();
  const confirm = useConfirm();
  const { user, isAdmin } = useSession();
  const team = useLoad((s) => get<Member[]>('/team', s), []);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const change = async (m: Member, body: { role?: string; active?: boolean }, message: string) => {
    if (
      body.active === false &&
      !(await confirm({
        title: `Disable ${m.name}?`,
        description:
          'They are signed out immediately and cannot sign in until re-enabled. Their records stay.',
        confirmLabel: 'Disable',
        danger: true,
      }))
    )
      return;
    setBusy(m.id);
    try {
      const saved = await patch<Member>(`/team/${m.id}`, body);
      team.setData((l) => l?.map((x) => (x.id === saved.id ? { ...x, ...saved } : x)));
      resetTeamCache();
      toast.success(message);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Team"
      description="People who can sign in to the CRM. Clients get portal access from each project instead."
      actions={
        isAdmin && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add member
          </Button>
        )
      }
    >
      <Card bodyClassName="p-0">
        {team.error ? (
          <div className="p-4">
            <ErrorBox error={team.error} retry={team.reload} />
          </div>
        ) : !team.data ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-line">
            {team.data.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar name={m.name} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {m.name}
                    {m.id === user?.id && <span className="ml-1 text-xs text-faint">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-mute">
                    {m.email} · joined {date(m.created_at)}
                  </p>
                </div>
                {!m.active && <Badge tone="danger">Disabled</Badge>}
                {isAdmin && m.id !== user?.id ? (
                  <select
                    aria-label={`Role for ${m.name}`}
                    className="input w-44"
                    value={m.role}
                    disabled={busy === m.id}
                    onChange={(e) =>
                      change(
                        m,
                        { role: e.target.value },
                        `${m.name} is now ${ROLE_LABELS[e.target.value as Member['role']]}.`,
                      )
                    }
                  >
                    {TEAM_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge tone="acc">{ROLE_LABELS[m.role]}</Badge>
                )}
                {isAdmin && m.id !== user?.id && (
                  <Menu
                    trigger={(open) => (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Actions for ${m.name}`}
                        onClick={open}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    )}
                    items={[
                      m.active
                        ? {
                            label: 'Disable access',
                            icon: <UserX className="h-4 w-4" />,
                            danger: true,
                            onSelect: () => change(m, { active: false }, `${m.name} disabled.`),
                          }
                        : {
                            label: 'Enable access',
                            icon: <UserCheck className="h-4 w-4" />,
                            onSelect: () => change(m, { active: true }, `${m.name} re-enabled.`),
                          },
                    ]}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-faint">
        Changing a role or access signs that person out so the new permissions apply right away.
      </p>
      {adding && (
        <AddMemberModal
          onClose={() => setAdding(false)}
          onSaved={(m) => {
            team.setData((l) => [...(l ?? []), m]);
            resetTeamCache();
            setAdding(false);
          }}
        />
      )}
    </Section>
  );
}

function AddMemberModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (m: Member) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'sales', phone: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errs.email = 'Enter a valid email.';
    if (form.password.length < 12) errs.password = 'Use at least 12 characters.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const m = await post<Member>('/team', {
        ...form,
        name: form.name.trim(),
        email: form.email.trim(),
      });
      toast.success(`${m.name} added. Share the password with them securely.`);
      onSaved({ ...m, created_at: new Date().toISOString() });
    } catch (err) {
      if (err instanceof ApiError) setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Add team member"
      description="They sign in with this email and password and can change the password later."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-member" loading={saving}>
            Add member
          </Button>
        </>
      }
    >
      <form id="add-member" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required error={errors.name}>
          <input className="input" value={form.name} maxLength={120} onChange={set('name')} />
        </Field>
        <Field label="Email" required error={errors.email}>
          <input
            type="email"
            className="input"
            value={form.email}
            autoComplete="off"
            onChange={set('email')}
          />
        </Field>
        <Field label="Role" error={errors.role}>
          <select className="input" value={form.role} onChange={set('role')}>
            {TEAM_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Phone" hint="Optional" error={errors.phone}>
          <input className="input" value={form.phone} maxLength={40} onChange={set('phone')} />
        </Field>
        <Field
          label="Temporary password"
          required
          hint="At least 12 characters"
          error={errors.password}
          className="sm:col-span-2"
        >
          <input
            type="password"
            className="input"
            value={form.password}
            autoComplete="new-password"
            onChange={set('password')}
          />
        </Field>
      </form>
    </Modal>
  );
}
