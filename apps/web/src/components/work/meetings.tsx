'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { get, patch, post } from '@/lib/api';
import { today } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';
import { Button, Field, Modal, useToast } from '@/components/ui';
import { MEETING_KINDS, formErrors, fromLocalInput, noticeLabel, toLocalInput, type MeetingKind } from './util';
import { splitTarget, useTargets, type TargetValue } from './useTargets';
import { TargetSelect } from './TargetSelect';
import { GuestEmails } from './GuestEmails';

export interface Meeting {
  id: string;
  title: string;
  kind: MeetingKind;
  start_at: string;
  duration_minutes: number;
  status: 'scheduled' | 'cancelled';
  sharing: 'internal' | 'client';
  location: string;
  meeting_url: string;
  source: 'crm' | 'booking' | 'upload';
  outcome: string | null;
  outcome_reason?: string;
  summary?: string;
  decisions?: string;
  transcript?: string;
  notifications: { channel: 'in_app' | 'email'; minutes: number }[];
  lead_id: string | null;
  lead_name?: string | null;
  project_id: string | null;
  project_name?: string | null;
  organizer_id: string;
  organizer_name?: string;
  participant_count?: number;
  booking_reservation_id?: string | null;
  mine?: boolean;
}

export interface Participant {
  email: string;
  user_id: string | null;
  name: string;
  role: string | null;
}

interface Person {
  id: string;
  name: string;
  role: string;
}

const NOTICE_PRESETS = [0, 10, 15, 30, 60, 120, 1440, 10080];

export function meetingEnd(m: Pick<Meeting, 'start_at' | 'duration_minutes'>) {
  return new Date(new Date(m.start_at).getTime() + m.duration_minutes * 60_000);
}

function nextSlot() {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return toLocalInput(d.toISOString());
}

/** Schedule a meeting, or edit an existing one. */
export function MeetingModal({
  open,
  onClose,
  meeting,
  participants,
  onSaved,
  defaultTarget = '',
}: {
  open: boolean;
  onClose: () => void;
  meeting?: Meeting | null;
  participants?: Participant[];
  onSaved: (m: Meeting) => void;
  defaultTarget?: TargetValue;
}) {
  const { user } = useSession();
  const toast = useToast();
  const targets = useTargets();
  const editing = !!meeting;
  const [people, setPeople] = useState<Person[]>([]);
  const [form, setForm] = useState({
    title: '',
    kind: 'video' as MeetingKind,
    startAt: '',
    durationMinutes: '30',
    target: '' as TargetValue,
    participantIds: [] as string[],
    externalEmails: [] as string[],
    location: '',
    meetingUrl: '',
    notifications: [] as { channel: 'in_app' | 'email'; minutes: number }[],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setGeneral('');
    if (meeting) {
      setForm({
        title: meeting.title,
        kind: meeting.kind,
        startAt: toLocalInput(meeting.start_at),
        durationMinutes: String(meeting.duration_minutes),
        target: meeting.project_id ? `project:${meeting.project_id}` : meeting.lead_id ? `lead:${meeting.lead_id}` : '',
        participantIds: (participants ?? []).filter((p) => p.user_id && p.user_id !== meeting.organizer_id).map((p) => p.user_id!),
        externalEmails: (participants ?? []).filter((p) => !p.user_id).map((p) => p.email),
        location: meeting.location,
        meetingUrl: meeting.meeting_url,
        notifications: meeting.notifications ?? [],
      });
    } else {
      setForm({
        title: '',
        kind: 'video',
        startAt: nextSlot(),
        durationMinutes: '30',
        target: defaultTarget,
        participantIds: [],
        externalEmails: [],
        location: '',
        meetingUrl: '',
        notifications: [{ channel: 'in_app', minutes: 15 }],
      });
    }
  }, [open, meeting, participants, defaultTarget]);

  const projectId = splitTarget(form.target).projectId;
  useEffect(() => {
    if (!open) return;
    get<Person[]>(`/reminders/recipients${projectId ? `?projectId=${projectId}` : ''}`).then(setPeople, () => setPeople([]));
  }, [open, projectId]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };
  const organizerId = meeting?.organizer_id ?? user?.id;
  const booked = !!meeting?.booking_reservation_id;
  const uploaded = meeting?.source === 'upload';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!form.title.trim()) local.title = 'Add a title.';
    const startAt = fromLocalInput(form.startAt);
    if (!startAt) local.startAt = 'Choose a start time.';
    const duration = Number(form.durationMinutes);
    if (!Number.isInteger(duration) || duration < 1 || duration > 480) local.durationMinutes = 'Between 1 and 480 minutes.';
    if (!editing && !form.target) local.target = 'Link the meeting to a lead or project.';
    if (form.meetingUrl && !/^https?:\/\/\S+$/i.test(form.meetingUrl.trim())) local.meetingUrl = 'Enter a full meeting link.';
    if (Object.keys(local).length) return setErrors(local);
    setSaving(true);
    setGeneral('');
    const body: Record<string, unknown> = {
      title: form.title.trim(),
      kind: form.kind,
      location: form.location.trim(),
      meetingUrl: form.meetingUrl.trim(),
      participantIds: form.participantIds,
      notifications: form.notifications,
    };
    if (!booked && !uploaded) Object.assign(body, { startAt, durationMinutes: duration });
    if (!booked) body.externalEmails = form.externalEmails;
    try {
      let saved: Meeting;
      if (meeting) saved = await patch<Meeting>(`/meetings/${meeting.id}`, body);
      else saved = await post<Meeting>('/meetings', { ...body, ...splitTarget(form.target) });
      toast.success(editing ? 'Meeting updated' : 'Meeting scheduled');
      onSaved(saved);
      onClose();
    } catch (err) {
      const f = formErrors(err, ['title', 'kind', 'startAt', 'durationMinutes', 'location', 'meetingUrl', 'participantIds', 'externalEmails', 'notifications']);
      setErrors(f.fields);
      setGeneral(f.general);
    } finally {
      setSaving(false);
    }
  };

  const toggleParticipant = (id: string) =>
    set('participantIds', form.participantIds.includes(id) ? form.participantIds.filter((x) => x !== id) : [...form.participantIds, id]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? 'Edit meeting' : 'Schedule a meeting'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="meeting-form" loading={saving}>
            {editing ? 'Save changes' : 'Schedule'}
          </Button>
        </>
      }
    >
      <form id="meeting-form" onSubmit={submit} className="space-y-4" noValidate>
        {general && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{general}</p>}
        <Field label="Title" required error={errors.title}>
          <input className="input" value={form.title} maxLength={200} onChange={(e) => set('title', e.target.value)} placeholder="Discovery call" />
        </Field>
        <Field label="With" required={!editing} error={errors.target} hint={editing ? 'A meeting stays with the lead or project it was scheduled for.' : undefined}>
          <TargetSelect targets={targets} value={form.target} onChange={(v) => set('target', v)} disabled={editing} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type" error={errors.kind}>
            <select className="input" value={form.kind} onChange={(e) => set('kind', e.target.value as MeetingKind)}>
              {MEETING_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Starts" required error={errors.startAt} hint={booked ? 'Reschedule bookings from the booking link.' : undefined}>
            <input type="datetime-local" className="input" value={form.startAt} disabled={booked || uploaded} onChange={(e) => set('startAt', e.target.value)} />
          </Field>
          <Field label="Length (minutes)" required error={errors.durationMinutes}>
            <input
              type="number"
              min={1}
              max={480}
              step={5}
              className="input"
              value={form.durationMinutes}
              disabled={booked || uploaded}
              onChange={(e) => set('durationMinutes', e.target.value)}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Meeting link" error={errors.meetingUrl}>
            <input className="input" type="url" value={form.meetingUrl} onChange={(e) => set('meetingUrl', e.target.value)} placeholder="https://" />
          </Field>
          <Field label={form.kind === 'phone' ? 'Phone number or notes' : 'Location'} error={errors.location}>
            <input className="input" value={form.location} maxLength={500} onChange={(e) => set('location', e.target.value)} />
          </Field>
        </div>
        <div>
          <span className="label">Team participants</span>
          {errors.participantIds && <span className="mb-1 block text-xs text-danger">{errors.participantIds}</span>}
          <div className="flex flex-wrap gap-1.5">
            {people
              .filter((p) => p.id !== organizerId)
              .map((p) => {
                const on = form.participantIds.includes(p.id);
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => toggleParticipant(p.id)}
                    aria-pressed={on}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs transition',
                      on ? 'border-acc bg-acc-soft text-acc' : 'border-line text-mute hover:text-ink',
                    )}
                  >
                    {p.name}
                    {p.role === 'client' ? ' · client' : ''}
                  </button>
                );
              })}
            {people.filter((p) => p.id !== organizerId).length === 0 && <span className="text-xs text-faint">No other team members.</span>}
          </div>
          <p className="mt-1 text-xs text-faint">The organizer is always included.</p>
        </div>
        <Field label="External guests" error={errors.externalEmails} hint={booked ? 'Guests of a booking are managed by the booking.' : 'Press Enter after each email.'}>
          <GuestEmails value={form.externalEmails} onChange={(v) => set('externalEmails', v)} disabled={booked} />
        </Field>
        <div>
          <span className="label">Notifications</span>
          {errors.notifications && <span className="mb-1 block text-xs text-danger">{errors.notifications}</span>}
          <div className="space-y-2">
            {form.notifications.map((n, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  className="input w-auto"
                  aria-label="Channel"
                  value={n.channel}
                  onChange={(e) =>
                    set(
                      'notifications',
                      form.notifications.map((x, j) => (j === i ? { ...x, channel: e.target.value as 'in_app' | 'email' } : x)),
                    )
                  }
                >
                  <option value="in_app">In-app</option>
                  <option value="email">Email</option>
                </select>
                <select
                  className="input w-auto"
                  aria-label="When"
                  value={n.minutes}
                  onChange={(e) =>
                    set(
                      'notifications',
                      form.notifications.map((x, j) => (j === i ? { ...x, minutes: Number(e.target.value) } : x)),
                    )
                  }
                >
                  {[...new Set([...NOTICE_PRESETS, n.minutes])]
                    .sort((a, b) => a - b)
                    .map((m) => (
                      <option key={m} value={m}>
                        {noticeLabel(m)}
                      </option>
                    ))}
                </select>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove notification"
                  onClick={() => set('notifications', form.notifications.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {form.notifications.length < 5 && (
              <Button variant="ghost" size="sm" onClick={() => set('notifications', [...form.notifications, { channel: 'in_app', minutes: 60 }])}>
                <Plus className="h-3.5 w-3.5" /> Add notification
              </Button>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** Record a meeting that already happened (summary, transcript or recording link). */
export function UploadMeetingModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (m: Meeting) => void }) {
  const toast = useToast();
  const targets = useTargets();
  const [form, setForm] = useState({ title: '', target: '' as TargetValue, date: '', participants: [] as string[], summary: '', transcript: '', recordingUrl: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setGeneral('');
    setForm({ title: '', target: '', date: today(), participants: [], summary: '', transcript: '', recordingUrl: '' });
  }, [open]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) return setErrors((e) => ({ ...e, transcript: 'Transcript files must be under 2 MB.' }));
    set('transcript', (await file.text()).slice(0, 500_000));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!form.title.trim()) local.title = 'Add a title.';
    if (!form.target) local.target = 'Link the meeting to a lead or project.';
    if (!form.date) local.date = 'Choose the meeting date.';
    else if (form.date > today()) local.date = 'Choose a past date.';
    if (!form.summary.trim() && !form.transcript.trim() && !form.recordingUrl.trim()) local.summary = 'Add a summary, transcript or recording link.';
    if (form.recordingUrl && !/^https?:\/\/\S+$/i.test(form.recordingUrl.trim())) local.recordingUrl = 'Enter a full link.';
    if (Object.keys(local).length) return setErrors(local);
    setSaving(true);
    setGeneral('');
    try {
      const saved = await post<Meeting>('/meetings/upload', {
        title: form.title.trim(),
        ...splitTarget(form.target),
        date: form.date,
        participants: form.participants,
        summary: form.summary,
        transcript: form.transcript,
        recordingUrl: form.recordingUrl.trim(),
      });
      toast.success('Past meeting saved');
      onSaved(saved);
      onClose();
    } catch (err) {
      const f = formErrors(err, ['title', 'date', 'participants', 'summary', 'transcript', 'recordingUrl']);
      setErrors(f.fields);
      setGeneral(f.general);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add a past meeting"
      description="Keep notes from a call that happened outside the CRM."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="upload-meeting-form" loading={saving}>
            Save meeting
          </Button>
        </>
      }
    >
      <form id="upload-meeting-form" onSubmit={submit} className="space-y-4" noValidate>
        {general && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{general}</p>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Title" required error={errors.title} className="sm:col-span-2">
            <input className="input" value={form.title} maxLength={200} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Date" required error={errors.date}>
            <input type="date" className="input" max={today()} value={form.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
        </div>
        <Field label="With" required error={errors.target}>
          <TargetSelect targets={targets} value={form.target} onChange={(v) => set('target', v)} />
        </Field>
        <Field label="Participants" error={errors.participants} hint="Team emails are matched to team members automatically.">
          <GuestEmails value={form.participants} onChange={(v) => set('participants', v)} />
        </Field>
        <Field label="Summary" error={errors.summary}>
          <textarea className="input min-h-28" value={form.summary} maxLength={20000} onChange={(e) => set('summary', e.target.value)} />
        </Field>
        <Field label="Transcript" error={errors.transcript} hint="Paste text or load a .txt / .vtt / .srt file.">
          <textarea className="input min-h-28 font-mono text-xs" value={form.transcript} maxLength={500000} onChange={(e) => set('transcript', e.target.value)} />
        </Field>
        <input
          type="file"
          accept=".txt,.vtt,.srt,.md,text/plain"
          onChange={(e) => void readFile(e.target.files?.[0])}
          className="block text-sm text-mute file:mr-3 file:rounded-lg file:border file:border-line file:bg-card file:px-3 file:py-1.5 file:text-sm file:text-ink"
          aria-label="Load transcript file"
        />
        <Field label="Recording link" error={errors.recordingUrl}>
          <input className="input" type="url" value={form.recordingUrl} onChange={(e) => set('recordingUrl', e.target.value)} placeholder="https://" />
        </Field>
      </form>
    </Modal>
  );
}
