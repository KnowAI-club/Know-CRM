'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { CalendarClock, Clock, MapPin } from 'lucide-react';
import { get, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { Badge, Button, ErrorBox, Spinner } from '@/components/ui';
import { useConfirm, useToast } from '@/components/ui';
import { PublicFrame } from '@/components/growth/PublicFrame';
import { SlotPicker, type Slot } from '@/components/growth/SlotPicker';
import { browserZone, minutesLabel } from '@/components/growth/util';

interface Managed {
  reservation: { id: string; name: string; email: string; start_at: string; end_at: string; status: string };
  session: { title: string; description: string; timezone: string; duration: number; location: string; horizon: number };
}

export default function ManageBookingPage() {
  const { secret } = useParams<{ secret: string }>();
  const { data, error, loading, reload } = useLoad((s) => get<Managed>(`/public/booking/manage/${secret}`, s), [secret]);
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState<'view' | 'reschedule'>('view');
  const [startAt, setStartAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [now] = useState(() => Date.now());

  if (loading && !data) return <PublicFrame><Spinner /></PublicFrame>;
  if (error || !data)
    return (
      <PublicFrame>
        <div className="card p-8 text-center">
          <p className="font-semibold">Booking not found</p>
          <p className="mt-1 text-sm text-mute">Check that you opened the full link from your confirmation.</p>
        </div>
      </PublicFrame>
    );
  const { reservation: r, session: s } = data;
  const zone = browserZone();
  const when = (iso: string) =>
    new Date(iso).toLocaleString('en-IN', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const started = new Date(r.start_at).getTime() <= now;
  const cancelled = r.status === 'cancelled';

  const cancel = async () => {
    if (!(await confirm({ title: 'Cancel this booking?', description: 'Your host will be told and the time will be released.', confirmLabel: 'Cancel booking', danger: true })))
      return;
    setBusy(true);
    setActionError('');
    try {
      await post(`/public/booking/manage/${secret}/cancel`);
      toast.success('Booking cancelled.');
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const reschedule = async () => {
    if (!startAt) return;
    setBusy(true);
    setActionError('');
    try {
      await post(`/public/booking/manage/${secret}/reschedule`, { startAt });
      toast.success('Booking moved.');
      setMode('view');
      setStartAt(null);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicFrame wide={mode === 'reschedule'}>
      <div className="card overflow-hidden">
        <div className="border-b border-line p-6">
          <div className="flex items-center gap-2">
            <p className="eyebrow flex-1">Your booking</p>
            {cancelled ? <Badge tone="danger">Cancelled</Badge> : started ? <Badge>Past</Badge> : <Badge tone="ok">Confirmed</Badge>}
          </div>
          <h1 className="mt-1 text-xl font-semibold">{s.title}</h1>
          <div className="mt-3 space-y-1.5 text-sm text-mute">
            <p className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" /> <span className={cancelled ? 'line-through' : 'text-ink'}>{when(r.start_at)}</span>
            </p>
            <p className="flex items-center gap-2">
              <Clock className="h-4 w-4" /> {minutesLabel(s.duration)}
            </p>
            {s.location && (
              <p className="flex items-center gap-2">
                <MapPin className="h-4 w-4" /> {s.location}
              </p>
            )}
          </div>
          <p className="mt-3 text-sm text-mute">
            Booked for {r.name} ({r.email})
          </p>
        </div>
        <div className="p-6">
          {actionError && (
            <div className="mb-4">
              <ErrorBox error={actionError} />
            </div>
          )}
          {cancelled ? (
            <p className="text-sm text-mute">This booking was cancelled. You can make a new one from the original booking link.</p>
          ) : started ? (
            <p className="text-sm text-mute">This meeting has already started. Contact your host for any changes.</p>
          ) : mode === 'view' ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setMode('reschedule')}>Reschedule</Button>
              <Button variant="secondary" onClick={cancel} loading={busy}>
                Cancel booking
              </Button>
            </div>
          ) : (
            <>
              <SlotPicker
                timezone={s.timezone}
                horizon={s.horizon}
                value={startAt}
                onChange={setStartAt}
                loadSlots={(date, signal) => get<Slot[]>(`/public/booking/manage/${secret}/slots?date=${date}`, signal)}
              />
              <div className="mt-6 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setMode('view')} disabled={busy}>
                  Back
                </Button>
                <Button disabled={!startAt} loading={busy} onClick={reschedule}>
                  Move to this time
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </PublicFrame>
  );
}
