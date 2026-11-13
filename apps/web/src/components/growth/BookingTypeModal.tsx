'use client';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { patch, post } from '@/lib/api';
import { Button, Field, Modal, useToast } from '@/components/ui';
import { browserZone, fieldErrors, WEEKDAYS } from './util';

export interface Window {
  day: number;
  start: string;
  end: string;
}
export interface BookingType {
  id: string;
  token: string;
  host_id: string;
  host_name: string;
  title: string;
  description: string;
  timezone: string;
  duration: number;
  buffer_before: number;
  buffer_after: number;
  minimum_notice: number;
  horizon: number;
  availability: Window[];
  location: string;
  active: boolean;
  upcoming: number;
}

const DEFAULT_WINDOWS: Window[] = [1, 2, 3, 4, 5].map((day) => ({ day, start: '10:00', end: '17:00' }));
const DURATIONS = [15, 30, 45, 60, 90, 120];
const NOTICE = [
  { v: 0, l: 'No notice' },
  { v: 60, l: '1 hour' },
  { v: 120, l: '2 hours' },
  { v: 240, l: '4 hours' },
  { v: 720, l: '12 hours' },
  { v: 1440, l: '1 day' },
  { v: 2880, l: '2 days' },
  { v: 10080, l: '1 week' },
];

function zones() {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['Asia/Kolkata', 'UTC'];
  }
}

/** Create or edit a booking page, including its weekly availability. */
export function BookingTypeModal({ open, type, onClose, onSaved }: { open: boolean; type: BookingType | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const allZones = useMemo(() => zones(), []);
  const blank = () => ({
    title: '',
    description: '',
    location: '',
    timezone: allZones.includes('Asia/Kolkata') ? 'Asia/Kolkata' : browserZone(),
    duration: 30,
    bufferBefore: 0,
    bufferAfter: 0,
    minimumNotice: 120,
    horizon: 30,
    availability: DEFAULT_WINDOWS,
  });
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      type
        ? {
            title: type.title,
            description: type.description,
            location: type.location,
            timezone: type.timezone,
            duration: type.duration,
            bufferBefore: type.buffer_before,
            bufferAfter: type.buffer_after,
            minimumNotice: type.minimum_notice,
            horizon: type.horizon,
            availability: type.availability.map((w) => ({ ...w })),
          }
        : blank(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setWindow = (i: number, w: Partial<Window>) => set('availability', form.availability.map((x, j) => (j === i ? { ...x, ...w } : x)));

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.title.trim()) errs.title = 'Add a title.';
    if (!form.availability.length) errs.availability = 'Add at least one availability window.';
    form.availability.forEach((w, i) => {
      if (w.start >= w.end) errs[`availability.${i}`] = 'Each window must end after it starts.';
      else if (form.availability.slice(0, i).some((o) => o.day === w.day && o.start < w.end && w.start < o.end))
        errs[`availability.${i}`] = 'Windows on the same day cannot overlap.';
    });
    if (!(form.horizon >= 1 && form.horizon <= 365)) errs.horizon = 'Between 1 and 365 days.';
    return errs;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    const body = {
      ...form,
      title: form.title.trim(),
      description: form.description.trim(),
      location: form.location.trim(),
      availability: [...form.availability].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start)),
    };
    try {
      if (type) await patch(`/booking/types/${type.id}`, body);
      else await post('/booking/types', body);
      toast.success(type ? 'Booking page saved.' : 'Booking page created.');
      onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={type ? 'Edit booking page' : 'New booking page'}
      description="Visitors pick an open time; a lead, meeting and intake project are created for you."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="booking-type" loading={saving}>
            {type ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <form id="booking-type" onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Title" required error={errors.title}>
          <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Intro call" maxLength={200} />
        </Field>
        <Field label="Description" error={errors.description}>
          <textarea className="input" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={5000} />
        </Field>
        <Field label="Location or call link" hint="Shown to the visitor and on the meeting." error={errors.location}>
          <input className="input" value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Video call link sent after booking" maxLength={1000} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Duration" error={errors.duration}>
            <select className="input" value={form.duration} onChange={(e) => set('duration', Number(e.target.value))}>
              {[...new Set([...DURATIONS, form.duration])].sort((a, b) => a - b).map((d) => (
                <option key={d} value={d}>
                  {d} min
                </option>
              ))}
            </select>
          </Field>
          <Field label="Minimum notice" error={errors.minimumNotice}>
            <select className="input" value={form.minimumNotice} onChange={(e) => set('minimumNotice', Number(e.target.value))}>
              {[...NOTICE, ...(NOTICE.some((n) => n.v === form.minimumNotice) ? [] : [{ v: form.minimumNotice, l: `${form.minimumNotice} min` }])].map((n) => (
                <option key={n.v} value={n.v}>
                  {n.l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Book up to (days ahead)" error={errors.horizon}>
            <input className="input" type="number" min={1} max={365} value={form.horizon} onChange={(e) => set('horizon', Number(e.target.value))} />
          </Field>
          <Field label="Buffer before (min)" error={errors.bufferBefore}>
            <input className="input" type="number" min={0} max={240} step={5} value={form.bufferBefore} onChange={(e) => set('bufferBefore', Number(e.target.value))} />
          </Field>
          <Field label="Buffer after (min)" error={errors.bufferAfter}>
            <input className="input" type="number" min={0} max={240} step={5} value={form.bufferAfter} onChange={(e) => set('bufferAfter', Number(e.target.value))} />
          </Field>
          <Field label="Time zone" error={errors.timezone}>
            <select className="input" value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {(allZones.includes(form.timezone) ? allZones : [form.timezone, ...allZones]).map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div>
          <p className="label">Weekly availability</p>
          <div className="space-y-2">
            {form.availability.map((w, i) => (
              <div key={i}>
                <div className="flex flex-wrap items-center gap-2">
                  <select className="input w-36" value={w.day} onChange={(e) => setWindow(i, { day: Number(e.target.value) })} aria-label="Day">
                    {WEEKDAYS.map((d, n) => (
                      <option key={d} value={n}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <input className="input w-28" type="time" value={w.start} onChange={(e) => setWindow(i, { start: e.target.value })} aria-label="From" />
                  <span className="text-sm text-mute">to</span>
                  <input className="input w-28" type="time" value={w.end} onChange={(e) => setWindow(i, { end: e.target.value })} aria-label="To" />
                  <Button variant="ghost" size="icon" onClick={() => set('availability', form.availability.filter((_, j) => j !== i))} aria-label="Remove window">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {errors[`availability.${i}`] && <p className="mt-1 text-xs text-danger">{errors[`availability.${i}`]}</p>}
              </div>
            ))}
          </div>
          {errors.availability && <p className="mt-1 text-xs text-danger">{errors.availability}</p>}
          <Button
            className="mt-2"
            variant="soft"
            size="sm"
            disabled={form.availability.length >= 28}
            onClick={() => {
              const last = form.availability.at(-1);
              set('availability', [...form.availability, { day: last ? (last.day + 1) % 7 : 1, start: last?.start ?? '10:00', end: last?.end ?? '17:00' }]);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add window
          </Button>
        </div>
      </form>
    </Modal>
  );
}
