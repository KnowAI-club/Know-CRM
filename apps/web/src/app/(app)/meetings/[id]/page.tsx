'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Bell, CalendarClock, ExternalLink, Eye, EyeOff, MoreHorizontal, Pencil, Plus, Trash2, Users, XCircle } from 'lucide-react';
import { ApiError, del, get, patch, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { dateTime, time } from '@/lib/format';
import { Avatar, Badge, Button, Card, Empty, ErrorBox, Menu, PageHeader, Spinner, useConfirm, useToast } from '@/components/ui';
import { MeetingModal, meetingEnd, type Meeting, type Participant } from '@/components/work/meetings';
import { MeetingRecord, type NextStep } from '@/components/work/MeetingRecord';
import { MeetingFiles, type MeetingFile } from '@/components/work/MeetingFiles';
import { ReminderModal, ReminderRow, type Reminder } from '@/components/work/reminders';
import { KindIcon } from '@/components/work/MeetingItem';
import { useNow } from '@/components/work/useNow';
import { MEETING_KINDS, noticeLabel, outcomeLabel } from '@/components/work/util';

interface Detail {
  meeting: Meeting;
  participants: Participant[];
  nextSteps: NextStep[];
  files: MeetingFile[];
}

export default function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload, setData } = useLoad((s) => get<Detail>(`/meetings/${id}`, s), [id]);
  const reminders = useLoad((s) => get<Reminder[]>(`/reminders?meetingId=${id}`, s), [id]);
  const [editing, setEditing] = useState(false);
  const [newReminder, setNewReminder] = useState(false);
  const [editReminder, setEditReminder] = useState<Reminder | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow();

  if (error)
    return (
      <>
        <PageHeader title="Meeting" back={{ href: '/meetings', label: 'Meetings' }} />
        {error instanceof ApiError && error.status === 404 ? (
          <Card>
            <Empty title="Meeting not found" description="It may have been deleted." />
          </Card>
        ) : (
          <ErrorBox error={error} retry={reload} />
        )}
      </>
    );
  if (loading && !data) return <Spinner />;
  if (!data) return null;

  const { meeting: m, participants } = data;
  const merge = (p: Partial<Meeting>) => setData((d) => (d ? { ...d, meeting: { ...d.meeting, ...p } } : d));
  const cancelled = m.status === 'cancelled';
  const upload = m.source === 'upload';
  const future = new Date(m.start_at).getTime() > now;
  const live = !cancelled && !upload && now >= new Date(m.start_at).getTime() - 10 * 60_000 && now <= meetingEnd(m).getTime();
  const target = m.project_id
    ? { label: 'Project', name: m.project_name, href: `/projects/${m.project_id}` }
    : m.lead_id
      ? { label: 'Lead', name: m.lead_name, href: `/leads/${m.lead_id}` }
      : null;
  const upsertReminder = (r: Reminder) => reminders.setData((rows) => [r, ...(rows ?? []).filter((x) => x.id !== r.id)]);
  const manual = (reminders.data ?? []).filter((r) => !r.auto_notice);
  const auto = (reminders.data ?? []).filter((r) => r.auto_notice && r.status === 'pending');

  const toggleSharing = async () => {
    setBusy(true);
    try {
      const next = m.sharing === 'client' ? 'internal' : 'client';
      await patch(`/meetings/${m.id}/sharing`, { sharing: next });
      merge({ sharing: next });
      toast.success(next === 'client' ? 'Shared with the client' : 'Meeting is internal');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    const ok = await confirm({
      title: 'Cancel this meeting?',
      description: m.booking_reservation_id ? 'The booking is cancelled too and its time slot is released.' : 'Participants keep it in their history as cancelled.',
      confirmLabel: 'Cancel meeting',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const row = await post<Meeting>(`/meetings/${m.id}/cancel`);
      merge({ status: row.status });
      reminders.reload();
      toast.success('Meeting cancelled');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this meeting?', description: 'Its notes, transcript and files are removed permanently.', confirmLabel: 'Delete', danger: true })))
      return;
    try {
      await del(`/meetings/${m.id}`);
      toast.success('Meeting deleted');
      router.push('/meetings');
    } catch (e) {
      toast.error(e);
    }
  };

  const menu = [
    ...(!cancelled ? [{ label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(true) }] : []),
    ...(m.project_id && !cancelled
      ? [
          {
            label: m.sharing === 'client' ? 'Make internal' : 'Share with client',
            icon: m.sharing === 'client' ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />,
            onSelect: toggleSharing,
            disabled: busy,
          },
        ]
      : []),
    ...(!cancelled && !upload && future ? [{ label: 'Cancel meeting', icon: <XCircle className="h-4 w-4" />, danger: true, onSelect: cancel, disabled: busy }] : []),
    ...(upload ? [{ label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: remove }] : []),
  ];

  return (
    <>
      <PageHeader
        back={{ href: '/meetings', label: 'Meetings' }}
        eyebrow={upload ? 'Past meeting' : MEETING_KINDS.find((k) => k.value === m.kind)?.label}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className={cancelled ? 'text-mute line-through' : ''}>{m.title}</span>
            {cancelled && <Badge>Cancelled</Badge>}
            {m.outcome && <Badge tone={m.outcome === 'attended' ? 'ok' : 'warn'}>{outcomeLabel(m.outcome)}</Badge>}
            {m.sharing === 'client' && <Badge tone="info">Shared with client</Badge>}
            {m.source === 'booking' && <Badge tone="violet">Booked online</Badge>}
          </span>
        }
        actions={
          <>
            {m.meeting_url && !cancelled && (
              <Button variant={live ? 'primary' : 'secondary'} onClick={() => window.open(m.meeting_url, '_blank', 'noopener,noreferrer')}>
                <ExternalLink className="h-4 w-4" /> {upload ? 'Open recording' : 'Join'}
              </Button>
            )}
            {menu.length > 0 && (
              <Menu
                trigger={(open) => (
                  <Button variant="secondary" size="icon" onClick={open} aria-label="Meeting actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                )}
                items={menu}
              />
            )}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <MeetingRecord
            meeting={m}
            nextSteps={data.nextSteps}
            onSaved={(p, steps) => {
              setData((d) => (d ? { ...d, meeting: { ...d.meeting, ...p }, nextSteps: steps } : d));
              reminders.reload();
            }}
          />
          {upload && m.transcript && (
            <Card title="Transcript">
              <details>
                <summary className="cursor-pointer text-sm text-mute">Show transcript ({m.transcript.length.toLocaleString()} characters)</summary>
                <pre className="mt-3 max-h-[60vh] overflow-auto text-xs whitespace-pre-wrap">{m.transcript}</pre>
              </details>
            </Card>
          )}
          <MeetingFiles meetingId={m.id} files={data.files} onChange={(files) => setData((d) => (d ? { ...d, files } : d))} />
        </div>
        <div className="space-y-5">
          <Card title="Details" icon={<CalendarClock className="h-4 w-4" />}>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-mute">When</dt>
                <dd>
                  {upload ? (
                    new Date(m.start_at).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                  ) : (
                    <>
                      {dateTime(m.start_at)} – {time(meetingEnd(m).toISOString())}
                      <span className="text-mute"> · {m.duration_minutes} min</span>
                    </>
                  )}
                </dd>
              </div>
              {target && (
                <div>
                  <dt className="text-xs text-mute">{target.label}</dt>
                  <dd>
                    <Link href={target.href} className="text-acc hover:underline">
                      {target.name}
                    </Link>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-mute">Type</dt>
                <dd className="flex items-center gap-1.5">
                  <KindIcon kind={m.kind} className="h-3.5 w-3.5 text-mute" />
                  {MEETING_KINDS.find((k) => k.value === m.kind)?.label}
                </dd>
              </div>
              {m.location && (
                <div>
                  <dt className="text-xs text-mute">{m.kind === 'phone' ? 'Phone' : 'Location'}</dt>
                  <dd className="break-words">{m.location}</dd>
                </div>
              )}
              {m.meeting_url && (
                <div>
                  <dt className="text-xs text-mute">{upload ? 'Recording' : 'Link'}</dt>
                  <dd className="truncate">
                    <a href={m.meeting_url} target="_blank" rel="noreferrer noopener" className="text-acc hover:underline">
                      {m.meeting_url}
                    </a>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-mute">Organizer</dt>
                <dd>{m.organizer_name}</dd>
              </div>
              {!upload && m.notifications?.length > 0 && (
                <div>
                  <dt className="text-xs text-mute">Notifications</dt>
                  <dd className="flex flex-wrap gap-1">
                    {m.notifications.map((n) => (
                      <Badge key={`${n.channel}${n.minutes}`}>
                        {n.channel === 'email' ? 'Email' : 'In-app'} · {noticeLabel(n.minutes)}
                      </Badge>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </Card>
          <Card title={`Participants (${participants.length})`} icon={<Users className="h-4 w-4" />} bodyClassName="px-4 py-2">
            <ul className="divide-y divide-line">
              {participants.map((p) => (
                <li key={p.email} className="flex items-center gap-2.5 py-2">
                  <Avatar name={p.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{p.name}</p>
                    {p.name !== p.email && <p className="truncate text-xs text-mute">{p.email}</p>}
                  </div>
                  {p.user_id === m.organizer_id ? <Badge tone="acc">Organizer</Badge> : !p.user_id ? <Badge>Guest</Badge> : p.role === 'client' ? <Badge tone="info">Client</Badge> : null}
                </li>
              ))}
            </ul>
          </Card>
          <Card
            title="Reminders"
            icon={<Bell className="h-4 w-4" />}
            action={
              !cancelled ? (
                <Button size="sm" variant="ghost" onClick={() => setNewReminder(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              ) : undefined
            }
            bodyClassName="px-4 py-1"
          >
            {reminders.error ? (
              <div className="py-3">
                <ErrorBox error={reminders.error} retry={reminders.reload} />
              </div>
            ) : manual.length === 0 && auto.length === 0 ? (
              <p className="py-3 text-sm text-mute">{reminders.loading ? 'Loading…' : 'No reminders for this meeting.'}</p>
            ) : (
              <div className="divide-y divide-line">
                {manual.map((r) => (
                  <ReminderRow key={r.id} reminder={r} onChange={upsertReminder} onEdit={setEditReminder} showTarget={false} />
                ))}
                {auto.length > 0 && (
                  <p className="py-2.5 text-xs text-mute">
                    {auto.length} automatic notification{auto.length === 1 ? '' : 's'} scheduled from the meeting settings.
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
      <MeetingModal
        open={editing}
        onClose={() => setEditing(false)}
        meeting={m}
        participants={participants}
        onSaved={() => {
          void reload();
          reminders.reload();
        }}
      />
      <ReminderModal
        open={newReminder}
        onClose={() => setNewReminder(false)}
        onSaved={upsertReminder}
        fixed={{ meetingId: m.id, label: `For “${m.title}”` }}
      />
      <ReminderModal open={!!editReminder} reminder={editReminder} onClose={() => setEditReminder(null)} onSaved={upsertReminder} fixed={{ meetingId: m.id }} />
    </>
  );
}
