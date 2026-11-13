'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Eye, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { fillMerge, MERGE_FIELDS } from '@know-crm/shared';
import { del, post, put } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/cn';
import { Button, Card, Field, PageHeader, useConfirm, useToast } from '@/components/ui';
import { fieldErrors } from '@/components/growth/util';
import type { Sequence } from './types';

interface EmailDraft {
  key: string;
  id?: string;
  day: number;
  sendTime: string;
  sender: 'owner' | 'team' | 'person';
  senderName: string;
  subject: string;
  preview: string;
  body: string;
  signature: string;
  note: string;
}

let seq = 0;
const blankEmail = (day: number, sendTime = '10:30'): EmailDraft => ({
  key: `e${++seq}`,
  day,
  sendTime,
  sender: 'owner',
  senderName: '',
  subject: '',
  preview: '',
  body: '',
  signature: '',
  note: '',
});

const SENDERS = [
  { value: 'owner', label: 'Lead owner' },
  { value: 'team', label: 'Workspace (team)' },
  { value: 'person', label: 'Named person' },
] as const;

/** Create or edit a nurture sequence (saved as a whole document). */
export function SequenceEditor({ initial }: { initial?: Sequence }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { user, workspace } = useSession();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [status, setStatus] = useState<'active' | 'draft'>(initial?.status ?? 'draft');
  const [stopOnReply, setStopOnReply] = useState(initial?.stop_on_reply ?? true);
  const [weeklyCap, setWeeklyCap] = useState(initial?.weekly_cap ?? false);
  const [emails, setEmails] = useState<EmailDraft[]>(() =>
    initial
      ? initial.emails.map((e) => ({
          key: `e${++seq}`,
          id: e.id,
          day: e.day,
          sendTime: e.send_time,
          sender: e.sender,
          senderName: e.sender_name,
          subject: e.subject,
          preview: e.preview,
          body: e.body,
          signature: e.signature,
          note: e.note,
        }))
      : [blankEmail(0)],
  );
  const [previewing, setPreviewing] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const bodies = useRef<Record<string, HTMLTextAreaElement | null>>({});

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const sample: Record<string, string> = {
    first_name: 'Asha',
    company: 'Sample Co',
    industry: 'Retail',
    problem: 'slow manual reporting',
    owner_name: user?.name ?? 'You',
    booking_link: workspace?.data?.nurture?.bookingLink ?? '',
    revisit_month: new Date().toLocaleDateString('en-IN', { month: 'long' }),
  };
  const touch = () => setDirty(true);
  const update = (key: string, p: Partial<EmailDraft>) => {
    setEmails((list) => list.map((e) => (e.key === key ? { ...e, ...p } : e)));
    touch();
  };
  const move = (i: number, dir: -1 | 1) => {
    setEmails((list) => {
      const next = [...list];
      const [a, b] = [next[i]!, next[i + dir]!];
      // Keep days ascending: swapping order swaps content but keeps each slot's day.
      next[i] = { ...b, day: a.day, sendTime: a.sendTime };
      next[i + dir] = { ...a, day: b.day, sendTime: b.sendTime };
      return next;
    });
    touch();
  };
  const insertField = (key: string, field: string) => {
    const el = bodies.current[key];
    const token = `{{${field}}}`;
    const email = emails.find((e) => e.key === key);
    if (!email) return;
    const start = el?.selectionStart ?? email.body.length;
    const end = el?.selectionEnd ?? email.body.length;
    update(key, { body: email.body.slice(0, start) + token + email.body.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name the sequence.';
    if (!emails.length) errs.emails = 'Add at least one email.';
    emails.forEach((e, i) => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(e.sendTime)) errs[`emails.${i}.sendTime`] = 'Use HH:MM';
      if (!(e.day >= 0 && e.day <= 365)) errs[`emails.${i}.day`] = 'Day 0–365.';
      else if (i > 0 && e.day < emails[i - 1]!.day) errs[`emails.${i}.day`] = 'Must be the same day as the previous email or later.';
      if (status === 'active' && (!e.subject.trim() || !e.body.trim()))
        errs[`emails.${i}`] = 'Needs a subject and a body before the sequence can be active.';
      if (status === 'active' && e.sender === 'person' && !e.senderName.trim()) errs[`emails.${i}.senderName`] = 'Add a sender name.';
    });
    return errs;
  };

  const save = async () => {
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) return toast.error('Check the highlighted fields.');
    setSaving(true);
    const body = {
      name: name.trim(),
      description: description.trim(),
      status,
      stopOnReply,
      weeklyCap,
      emails: emails.map(({ key: _key, ...e }) => ({
        ...e,
        day: Number(e.day),
        senderName: e.sender === 'person' ? e.senderName.trim() : '',
      })),
    };
    try {
      const res = initial
        ? await put<{ id: string }>(`/nurtures/sequences/${initial.id}`, body)
        : await post<{ id: string }>('/nurtures/sequences', body);
      setDirty(false);
      toast.success('Sequence saved.');
      router.push(`/nurtures/sequences/${res.id}`);
    } catch (e) {
      setErrors(fieldErrors(e));
      toast.error(e);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!initial) return;
    if (!(await confirm({ title: `Delete ${initial.name}?`, description: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })))
      return;
    try {
      await del(`/nurtures/sequences/${initial.id}`);
      setDirty(false);
      toast.success('Sequence deleted.');
      router.push('/nurtures');
    } catch (e) {
      toast.error(e);
    }
  };

  const test = async (e: EmailDraft) => {
    if (!e.subject.trim() || !e.body.trim()) return toast.error('Add a subject and a body to send a test.');
    setTesting(e.key);
    try {
      const res = await post<{ to: string }>('/nurtures/test-email', { subject: e.subject, body: e.body, signature: e.signature });
      toast.success(`Test sent to ${res.to}.`);
    } catch (err) {
      toast.error(err);
    } finally {
      setTesting(null);
    }
  };

  const missing = (k: string) => `[${k}]`;

  return (
    <>
      <PageHeader
        back={initial ? { href: `/nurtures/sequences/${initial.id}`, label: initial.name } : { href: '/nurtures', label: 'Nurtures' }}
        eyebrow="Nurture sequence"
        title={initial ? 'Edit sequence' : 'New sequence'}
        actions={
          <>
            {initial && (
              <Button variant="ghost" onClick={remove}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
            <Button onClick={save} loading={saving}>
              Save sequence
            </Button>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <Card>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" required error={errors.name} className="sm:col-span-2">
                <input
                  className="input"
                  value={name}
                  onChange={(e) => (setName(e.target.value), touch())}
                  maxLength={100}
                  placeholder="Reconnecting with quiet leads"
                />
              </Field>
              <Field label="Description" error={errors.description} className="sm:col-span-2">
                <input
                  className="input"
                  value={description}
                  onChange={(e) => (setDescription(e.target.value), touch())}
                  maxLength={500}
                  placeholder="Who this is for"
                />
              </Field>
            </div>
          </Card>
          {emails.map((e, i) => {
            const showPreview = previewing.has(e.key);
            const err = errors[`emails.${i}`];
            return (
              <Card
                key={e.key}
                className={cn(err && 'border-danger/50')}
                title={`Email ${i + 1}`}
                action={
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPreviewing((s) => {
                          const n = new Set(s);
                          if (n.has(e.key)) n.delete(e.key);
                          else n.add(e.key);
                          return n;
                        })
                      }
                    >
                      {showPreview ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      {showPreview ? 'Edit' : 'Preview'}
                    </Button>
                    <Button variant="ghost" size="sm" loading={testing === e.key} onClick={() => test(e)}>
                      <Send className="h-3.5 w-3.5" /> Test
                    </Button>
                    <Button variant="ghost" size="icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={i === emails.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={emails.length === 1}
                      onClick={() => {
                        setEmails((l) => l.filter((x) => x.key !== e.key));
                        touch();
                      }}
                      aria-label="Remove email"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                }
              >
                {err && <p className="mb-3 text-sm text-danger">{err}</p>}
                {showPreview ? (
                  <div className="rounded-xl border border-line p-4 text-sm">
                    <p className="text-xs text-mute">Subject</p>
                    <p className="font-semibold">{fillMerge(e.subject, sample, missing) || '(no subject)'}</p>
                    {e.preview && <p className="mt-0.5 text-xs text-faint">{fillMerge(e.preview, sample, missing)}</p>}
                    <div className="mt-3 border-t border-line pt-3 whitespace-pre-line">
                      {fillMerge(e.body, sample, missing) || '(empty)'}
                    </div>
                    {e.signature && (
                      <div className="mt-3 border-t border-dashed border-line pt-3 whitespace-pre-line text-mute">
                        {fillMerge(e.signature, sample, missing)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-4">
                      <Field label="Day" hint="0 = the day they join" error={errors[`emails.${i}.day`]}>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          max={365}
                          value={e.day}
                          onChange={(ev) => update(e.key, { day: Number(ev.target.value) })}
                        />
                      </Field>
                      <Field label="Send at (IST)" error={errors[`emails.${i}.sendTime`]}>
                        <input
                          className="input"
                          type="time"
                          value={e.sendTime}
                          onChange={(ev) => update(e.key, { sendTime: ev.target.value })}
                        />
                      </Field>
                      <Field label="From" className={e.sender === 'person' ? '' : 'sm:col-span-2'}>
                        <select
                          className="input"
                          value={e.sender}
                          onChange={(ev) => update(e.key, { sender: ev.target.value as EmailDraft['sender'] })}
                        >
                          {SENDERS.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {e.sender === 'person' && (
                        <Field label="Sender name" error={errors[`emails.${i}.senderName`]}>
                          <input
                            className="input"
                            value={e.senderName}
                            onChange={(ev) => update(e.key, { senderName: ev.target.value })}
                            maxLength={80}
                          />
                        </Field>
                      )}
                    </div>
                    <Field label="Subject" error={errors[`emails.${i}.subject`]}>
                      <input
                        className="input"
                        value={e.subject}
                        onChange={(ev) => update(e.key, { subject: ev.target.value })}
                        maxLength={300}
                      />
                    </Field>
                    <Field label="Preview text" hint="Shown after the subject in most inboxes.">
                      <input
                        className="input"
                        value={e.preview}
                        onChange={(ev) => update(e.key, { preview: ev.target.value })}
                        maxLength={200}
                      />
                    </Field>
                    <div>
                      <label className="label" htmlFor={`body-${e.key}`}>
                        Body
                      </label>
                      <textarea
                        id={`body-${e.key}`}
                        ref={(el) => {
                          bodies.current[e.key] = el;
                        }}
                        className="input"
                        rows={7}
                        value={e.body}
                        onChange={(ev) => update(e.key, { body: ev.target.value })}
                        maxLength={20000}
                      />
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {MERGE_FIELDS.map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => insertField(e.key, f)}
                            className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-mute hover:border-acc hover:text-acc"
                          >
                            {`{{${f}}}`}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Signature">
                        <textarea
                          className="input"
                          rows={2}
                          value={e.signature}
                          onChange={(ev) => update(e.key, { signature: ev.target.value })}
                          maxLength={2000}
                        />
                      </Field>
                      <Field label="Internal note" hint="Only your team sees this.">
                        <textarea
                          className="input"
                          rows={2}
                          value={e.note}
                          onChange={(ev) => update(e.key, { note: ev.target.value })}
                          maxLength={2000}
                        />
                      </Field>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
          {errors.emails && <p className="text-sm text-danger">{errors.emails}</p>}
          <Button
            variant="secondary"
            disabled={emails.length >= 30}
            onClick={() => {
              const last = emails.at(-1);
              setEmails((l) => [...l, blankEmail(last ? last.day + 3 : 0, last?.sendTime)]);
              touch();
            }}
          >
            <Plus className="h-4 w-4" /> Add email
          </Button>
        </div>
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card title="Settings">
            <div className="space-y-4 text-sm">
              <div>
                <p className="label">Status</p>
                <div className="flex gap-2">
                  {(['draft', 'active'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => (setStatus(s), touch())}
                      aria-pressed={status === s}
                      className={cn(
                        'flex-1 rounded-lg border px-3 py-1.5 text-sm capitalize',
                        status === s ? 'border-acc bg-acc-soft text-acc' : 'border-line text-mute',
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-faint">Only active sequences can take new leads.</p>
              </div>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={stopOnReply}
                  onChange={(e) => (setStopOnReply(e.target.checked), touch())}
                  className="mt-0.5 h-4 w-4 accent-[var(--acc)]"
                />
                <span>
                  Stop on reply
                  <span className="block text-xs text-mute">Pause the remaining emails once a lead replies.</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={weeklyCap}
                  onChange={(e) => (setWeeklyCap(e.target.checked), touch())}
                  className="mt-0.5 h-4 w-4 accent-[var(--acc)]"
                />
                <span>
                  One email per week
                  <span className="block text-xs text-mute">Space emails at least 7 days apart.</span>
                </span>
              </label>
            </div>
          </Card>
          <p className="px-1 text-xs text-faint">
            Emails are not sent automatically. When an email is due it shows in the In sequence tab, where you send it from your own inbox
            and mark it sent.
          </p>
        </div>
      </div>
    </>
  );
}
