'use client';
import { useState, type FormEvent } from 'react';
import { Clock, Download, Trash2 } from 'lucide-react';
import { del, get, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { date, today } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Field, Skeleton, Stat, useConfirm, useToast } from '@/components/ui';
import { fieldErrors, minutesLabel } from './util';

interface Entry {
  id: string;
  user_id: string;
  user_name: string;
  work_date: string;
  minutes: number;
  description: string;
  billable: boolean;
}

/** Parses "1:30", "1.5", "90m" or "2h" into minutes. */
function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2}):([0-5]\d)$/.exec(t))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = /^(\d+(?:\.\d+)?)\s*h$/.exec(t)) || (m = /^(\d+(?:\.\d+)?)$/.exec(t))) return Math.round(Number(m[1]) * 60);
  if ((m = /^(\d+)\s*m(in)?$/.exec(t))) return Number(m[1]);
  return null;
}

export function TimeTab({ projectId }: { projectId: string }) {
  const { user, isAdmin } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload, setData } = useLoad((s) => get<Entry[]>(`/projects/${projectId}/time-entries`, s), [projectId]);
  const [form, setForm] = useState({ workDate: today(), duration: '', description: '', billable: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const minutes = parseDuration(form.duration);
    if (!minutes || minutes > 1440) return setErrors({ minutes: 'Enter time like 1:30, 1.5 or 45m (max 24h).' });
    setSaving(true);
    try {
      const entry = await post<Entry>(`/projects/${projectId}/time-entries`, { workDate: form.workDate, minutes, description: form.description, billable: form.billable });
      setData((list) => [entry, ...(list ?? [])].sort((a, b) => b.work_date.localeCompare(a.work_date)));
      setForm({ ...form, duration: '', description: '' });
      setErrors({});
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (en: Entry) => {
    if (!(await confirm({ title: 'Remove time entry?', confirmLabel: 'Remove', danger: true }))) return;
    try {
      await del(`/time-entries/${en.id}`);
      setData((list) => list?.filter((x) => x.id !== en.id));
    } catch (e) {
      toast.error(e);
    }
  };

  const total = (data ?? []).reduce((a, e) => a + e.minutes, 0);
  const billable = (data ?? []).filter((e) => e.billable).reduce((a, e) => a + e.minutes, 0);
  const byPerson = Object.entries(
    (data ?? []).reduce<Record<string, number>>((acc, e) => ((acc[e.user_name] = (acc[e.user_name] ?? 0) + e.minutes), acc), {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Total logged" value={minutesLabel(total)} />
        <Stat label="Billable" value={minutesLabel(billable)} />
        <Stat label="Top contributor" value={byPerson[0]?.[0] ?? '—'} hint={byPerson[0] ? minutesLabel(byPerson[0][1]) : undefined} />
      </div>
      <Card
        title="Log time"
        icon={<Clock className="h-4 w-4" />}
        action={
          isAdmin && (
            <a href="/api/exports/time.csv" className="inline-flex items-center gap-1 text-xs text-mute hover:text-ink">
              <Download className="h-3.5 w-3.5" /> Export all (CSV)
            </a>
          )
        }
      >
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto_auto]" noValidate>
          <Field label="Date" error={errors.workDate}>
            <input className="input" type="date" max={today()} value={form.workDate} onChange={(e) => setForm({ ...form, workDate: e.target.value })} />
          </Field>
          <Field label="Duration" error={errors.minutes} hint="e.g. 1:30 or 45m">
            <input className="input" value={form.duration} placeholder="1:30" onChange={(e) => setForm({ ...form, duration: e.target.value })} />
          </Field>
          <Field label="What did you work on?" error={errors.description}>
            <input className="input" value={form.description} maxLength={1000} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 self-center text-sm sm:pt-5">
            <input type="checkbox" checked={form.billable} onChange={(e) => setForm({ ...form, billable: e.target.checked })} /> Billable
          </label>
          <Button type="submit" loading={saving} className="self-center sm:mt-5">
            Log
          </Button>
        </form>
      </Card>
      <Card title="Entries" bodyClassName="p-0">
        {error ? (
          <div className="p-4">
            <ErrorBox error={error} retry={reload} />
          </div>
        ) : loading && !data ? (
          <div className="p-4">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !data?.length ? (
          <Empty title="No time logged" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Person</th>
                  <th>Description</th>
                  <th className="text-right">Time</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap text-mute">{date(e.work_date)}</td>
                    <td>{e.user_name}</td>
                    <td className="text-mute">
                      {e.description || '—'} {!e.billable && <Badge className="ml-1">Non-billable</Badge>}
                    </td>
                    <td className="text-right tabular-nums">{minutesLabel(e.minutes)}</td>
                    <td className="w-10">
                      {(isAdmin || e.user_id === user?.id) && (
                        <Button size="icon" variant="ghost" aria-label="Remove entry" onClick={() => remove(e)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
