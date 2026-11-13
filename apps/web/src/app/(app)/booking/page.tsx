'use client';
import { useState } from 'react';
import Link from 'next/link';
import { CalendarClock, Clock, ExternalLink, MoreHorizontal, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { del, get, patch, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { Badge, Button, Empty, ErrorBox, Menu, PageHeader, Segmented, Skeleton, Spinner, Tabs, useConfirm, useToast } from '@/components/ui';
import { CopyLinkButton } from '@/components/growth/CopyButton';
import { BookingTypeModal, type BookingType } from '@/components/growth/BookingTypeModal';
import { minutesLabel, publicBookingPath, WEEKDAYS } from '@/components/growth/util';

interface Reservation {
  id: string;
  name: string;
  email: string;
  start_at: string;
  end_at: string;
  status: string;
  title: string;
  timezone: string;
  host_id: string;
  host_name: string;
  meeting_id: string | null;
}

function availabilitySummary(t: BookingType) {
  const days = [...new Set(t.availability.map((w) => w.day))].sort();
  return days.map((d) => WEEKDAYS[d]!.slice(0, 3)).join(', ');
}

export default function BookingPage() {
  const [tab, setTab] = useState<'pages' | 'reservations'>('pages');
  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Booking"
        description="Let prospects book a call from your open times. Each booking creates a lead, a meeting and an intake project."
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'pages', label: 'Booking pages' },
          { value: 'reservations', label: 'Bookings' },
        ]}
      />
      {tab === 'pages' ? <Pages /> : <Reservations />}
    </>
  );
}

function Pages() {
  const toast = useToast();
  const confirm = useConfirm();
  const { user, isAdmin } = useSession();
  const { data, error, loading, reload } = useLoad((s) => get<BookingType[]>('/booking/types', s));
  const [editing, setEditing] = useState<BookingType | null>(null);
  const [open, setOpen] = useState(false);

  const toggle = async (t: BookingType) => {
    try {
      await patch(`/booking/types/${t.id}`, { active: !t.active });
      toast.success(t.active ? 'Booking page turned off.' : 'Booking page is live.');
      await reload();
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async (t: BookingType) => {
    if (!(await confirm({ title: `Delete ${t.title}?`, description: 'The link will stop working. Pages with bookings are kept — turn them off instead.', confirmLabel: 'Delete', danger: true })))
      return;
    try {
      await del(`/booking/types/${t.id}`);
      toast.success('Booking page deleted.');
      await reload();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> New booking page
        </Button>
      </div>
      {error ? (
        <ErrorBox error={error} retry={reload} />
      ) : loading && !data ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : !data?.length ? (
        <div className="card">
          <Empty
            icon={<CalendarClock className="h-5 w-5" />}
            title="No booking pages yet"
            description="Create one with your weekly availability, then share the link."
            action={<Button onClick={() => setOpen(true)}>New booking page</Button>}
          />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((t) => {
            const canEdit = isAdmin || t.host_id === user?.id;
            return (
              <div key={t.id} className="card flex flex-col p-5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{t.title}</p>
                    <p className="text-xs text-mute">Host: {t.host_name}</p>
                  </div>
                  {t.active ? <Badge tone="ok">Live</Badge> : <Badge>Off</Badge>}
                  {canEdit && (
                    <Menu
                      trigger={(o) => (
                        <Button variant="ghost" size="icon" onClick={o} aria-label="Booking page actions">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      )}
                      items={[
                        {
                          label: 'Edit',
                          icon: <Pencil className="h-4 w-4" />,
                          onSelect: () => {
                            setEditing(t);
                            setOpen(true);
                          },
                        },
                        { label: t.active ? 'Turn off' : 'Turn on', icon: <Power className="h-4 w-4" />, onSelect: () => toggle(t) },
                        { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onSelect: () => remove(t), danger: true },
                      ]}
                    />
                  )}
                </div>
                {t.description && <p className="mt-2 line-clamp-2 text-sm text-mute">{t.description}</p>}
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> {minutesLabel(t.duration)}
                  </span>
                  <span>{availabilitySummary(t)}</span>
                  <span>{t.timezone}</span>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
                  <span className="text-mute">{t.upcoming} upcoming</span>
                  <span className="flex-1" />
                  {t.active && (
                    <>
                      <a href={publicBookingPath(t.token)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-mute hover:text-ink">
                        <ExternalLink className="h-3.5 w-3.5" /> Open
                      </a>
                      <CopyLinkButton path={publicBookingPath(t.token)} />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <BookingTypeModal
        open={open}
        type={editing}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          void reload();
        }}
      />
    </>
  );
}

function Reservations() {
  const toast = useToast();
  const confirm = useConfirm();
  const { user, isAdmin } = useSession();
  const { data, error, loading, reload } = useLoad((s) => get<Reservation[]>('/booking/reservations', s));
  const [view, setView] = useState<'upcoming' | 'past' | 'cancelled'>('upcoming');
  const [busy, setBusy] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Spinner />;
  const list = (data ?? [])
    .filter((r) =>
      view === 'cancelled' ? r.status === 'cancelled' : r.status !== 'cancelled' && (view === 'upcoming' ? new Date(r.end_at).getTime() >= now : new Date(r.end_at).getTime() < now),
    )
    .sort((a, b) => (view === 'upcoming' ? 1 : -1) * (new Date(a.start_at).getTime() - new Date(b.start_at).getTime()));

  const cancel = async (r: Reservation) => {
    if (!(await confirm({ title: `Cancel ${r.name}'s booking?`, description: 'The guest is emailed and the meeting is cancelled.', confirmLabel: 'Cancel booking', danger: true })))
      return;
    setBusy(r.id);
    try {
      await post(`/booking/reservations/${r.id}/cancel`);
      toast.success('Booking cancelled.');
      await reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="mb-4">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'past', label: 'Past' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
        />
      </div>
      {list.length === 0 ? (
        <div className="card">
          <Empty title={`No ${view} bookings`} />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Guest</th>
                <th className="hidden md:table-cell">Booking page</th>
                <th className="hidden md:table-cell">Host</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">
                    <p className={r.status === 'cancelled' ? 'text-mute line-through' : 'font-medium'}>
                      {new Date(r.start_at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </td>
                  <td>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-mute">{r.email}</p>
                  </td>
                  <td className="hidden md:table-cell">{r.title}</td>
                  <td className="hidden md:table-cell">{r.host_name}</td>
                  <td className="text-right whitespace-nowrap">
                    {r.meeting_id && (
                      <Link href={`/meetings/${r.meeting_id}`} className="mr-2 text-xs text-acc hover:underline">
                        Meeting
                      </Link>
                    )}
                    {view === 'upcoming' && (isAdmin || r.host_id === user?.id) && (
                      <Button variant="ghost" size="sm" loading={busy === r.id} onClick={() => cancel(r)}>
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
