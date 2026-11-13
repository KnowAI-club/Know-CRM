'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CalendarCheck2, Clock, MapPin } from 'lucide-react';
import { ApiError, get, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { Button, ErrorBox, Field, Spinner } from '@/components/ui';
import { PublicFrame } from '@/components/growth/PublicFrame';
import { SlotPicker, type Slot } from '@/components/growth/SlotPicker';
import { browserZone, fieldErrors, minutesLabel, newId, randomHex } from '@/components/growth/util';

interface BookingPage {
  id: string;
  token: string;
  title: string;
  description: string;
  timezone: string;
  duration: number;
  location: string;
  horizon: number;
  host_name?: string;
  workspace?: string;
}

interface Confirmation {
  reservation: { start_at: string; end_at: string; name: string; email: string };
  managementPath: string;
}

export default function PublicBookingPage() {
  const { token } = useParams<{ token: string }>();
  const page = useLoad((s) => get<BookingPage>(`/public/booking/${token}`, s), [token]);
  const [startAt, setStartAt] = useState<string | null>(null);
  const [step, setStep] = useState<'pick' | 'details'>('pick');
  const [form, setForm] = useState({ name: '', email: '', website: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<Confirmation | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  // Retrying the identical request reuses its ids so a lost response cannot double-book.
  const attempt = useRef<{ key: string; requestId: string; secret: string } | null>(null);

  if (page.loading && !page.data) return <PublicFrame><Spinner /></PublicFrame>;
  if (page.error || !page.data)
    return (
      <PublicFrame>
        <div className="card p-8 text-center">
          <p className="font-semibold">This booking link is unavailable</p>
          <p className="mt-1 text-sm text-mute">It may have been turned off. Please contact the person who shared it.</p>
        </div>
      </PublicFrame>
    );
  const t = page.data;
  const zone = browserZone();
  const when = (iso: string) =>
    new Date(iso).toLocaleString('en-IN', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Enter your name.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errs.email = 'Enter a valid email.';
    setErrors(errs);
    setFormError('');
    if (Object.keys(errs).length || !startAt) return;
    const key = JSON.stringify([startAt, form.name.trim(), form.email.trim().toLowerCase()]);
    if (attempt.current?.key !== key) attempt.current = { key, requestId: newId(), secret: randomHex(32) };
    setSaving(true);
    try {
      const res = await post<Confirmation>(`/public/booking/${token}/reservations`, {
        requestId: attempt.current.requestId,
        managementSecret: attempt.current.secret,
        name: form.name.trim(),
        email: form.email.trim(),
        startAt,
        website: form.website,
      });
      setDone(res);
    } catch (err) {
      setErrors(fieldErrors(err));
      if (err instanceof ApiError && err.status === 409) {
        setFormError(`${err.message} Please choose another time.`);
        attempt.current = null;
        setStartAt(null);
        setStep('pick');
        setPickerKey((k) => k + 1);
      } else setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (done)
    return (
      <PublicFrame workspace={t.workspace}>
        <div className="card p-6 sm:p-8">
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-acc-soft text-acc">
            <CalendarCheck2 className="h-5 w-5" />
          </div>
          <p className="eyebrow">Booked</p>
          <h1 className="mt-1 text-xl font-semibold">You&apos;re confirmed</h1>
          <p className="mt-2 text-sm text-mute">
            {t.title} with {t.host_name} on <span className="font-medium text-ink">{when(done.reservation.start_at)}</span>. A confirmation
            email is on its way to {done.reservation.email}.
          </p>
          <div className="mt-5 rounded-xl border border-line bg-subtle p-4 text-sm">
            <p className="font-medium">Need to change it?</p>
            <p className="mt-1 text-mute">Keep this private link to reschedule or cancel later.</p>
            <Link href={done.managementPath} className="mt-2 inline-block break-all text-acc underline">
              {typeof window !== 'undefined' ? window.location.origin : ''}
              {done.managementPath}
            </Link>
          </div>
        </div>
      </PublicFrame>
    );

  return (
    <PublicFrame workspace={t.workspace} wide>
      <div className="card overflow-hidden">
        <div className="border-b border-line p-6">
          <p className="eyebrow">{t.host_name}</p>
          <h1 className="mt-1 text-xl font-semibold">{t.title}</h1>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-mute">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-4 w-4" /> {minutesLabel(t.duration)}
            </span>
            {t.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4" /> {t.location}
              </span>
            )}
          </div>
          {t.description && <p className="mt-3 text-sm whitespace-pre-line text-mute">{t.description}</p>}
        </div>
        <div className="p-6">
          {formError && (
            <div className="mb-4">
              <ErrorBox error={formError} />
            </div>
          )}
          {step === 'pick' ? (
            <>
              <SlotPicker
                key={pickerKey}
                timezone={t.timezone}
                horizon={t.horizon}
                value={startAt}
                onChange={setStartAt}
                loadSlots={(date, signal) => get<Slot[]>(`/public/booking/${token}/slots?date=${date}`, signal)}
              />
              <div className="mt-6 flex justify-end">
                <Button disabled={!startAt} onClick={() => setStep('details')}>
                  Continue
                </Button>
              </div>
            </>
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <div className="rounded-xl bg-acc-soft px-4 py-3 text-sm text-acc">{startAt && when(startAt)}</div>
              <Field label="Your name" required error={errors.name}>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  autoComplete="name"
                  maxLength={200}
                />
              </Field>
              <Field label="Email" required error={errors.email}>
                <input
                  className="input"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  autoComplete="email"
                  maxLength={254}
                />
              </Field>
              {/* Honeypot: hidden from people, filled by bots. */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                className="absolute -left-[9999px] h-0 w-0 opacity-0"
                aria-hidden
              />
              <div className="flex justify-between gap-2 pt-2">
                <Button variant="ghost" onClick={() => setStep('pick')} disabled={saving}>
                  Back
                </Button>
                <Button type="submit" loading={saving}>
                  Confirm booking
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </PublicFrame>
  );
}
