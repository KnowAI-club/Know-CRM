'use client';
import { useState } from 'react';
import { CURRENCIES } from '@know-crm/shared';
import { Button, Card, Field, useToast } from '@/components/ui';
import { ApiError, patch } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useTeam } from '@/lib/team';
import { fieldErrors } from '@/components/money/util';
import type { WorkspaceSettings } from '@/components/money/types';
import { Section } from './shared';

const ZONES: string[] = (() => {
  try {
    return (
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
        'timeZone',
      ) ?? []
    );
  } catch {
    return [];
  }
})();

export function GeneralSettings({
  settings,
  onSaved,
}: {
  settings: WorkspaceSettings;
  onSaved: (s: WorkspaceSettings) => void;
}) {
  const toast = useToast();
  const { refresh } = useSession();
  const team = useTeam();
  const [name, setName] = useState(settings.name);
  const [currency, setCurrency] = useState(settings.currency);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [owner, setOwner] = useState(settings.data.defaultLeadOwnerId ?? '');
  const [contactNumber, setContactNumber] = useState(settings.data.nurture?.contactNumber ?? '');
  const [bookingLink, setBookingLink] = useState(settings.data.nurture?.bookingLink ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const zones = ZONES.includes(timezone) ? ZONES : [timezone, ...ZONES];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name the workspace.';
    if (bookingLink && !/^https?:\/\/\S+$/.test(bookingLink.trim()))
      errs['nurture.bookingLink'] = 'Enter a full URL starting with http(s)://';
    if (contactNumber && !/^[+\d][\d\s()-]*$/.test(contactNumber.trim()))
      errs['nurture.contactNumber'] = 'Enter a valid phone number';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        timezone,
        defaultLeadOwnerId: owner,
        nurture: { contactNumber: contactNumber.trim(), bookingLink: bookingLink.trim() },
      };
      if (currency !== settings.currency) body.currency = currency;
      const next = await patch<WorkspaceSettings>('/settings', body);
      onSaved(next);
      await refresh();
      toast.success('Workspace settings saved.');
    } catch (err) {
      if (err instanceof ApiError) setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Workspace" description="Name, money and time settings used across the CRM.">
      <form onSubmit={save} className="space-y-5">
        <Card title="General">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Workspace name" required error={errors.name}>
              <input
                className="input"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Currency" hint="Locked once projects exist" error={errors.currency}>
              <select
                className="input"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Time zone"
              hint="Used for reminders, booking slots and nurture send times"
              error={errors.timezone}
            >
              <select
                className="input"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Default lead owner"
              hint="New leads from forms and bookings are assigned here"
              error={errors.defaultLeadOwnerId}
            >
              <select className="input" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">Nobody (unassigned)</option>
                {team.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Card>
        <Card title="Nurture emails">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Contact number"
              hint="Available as a sign-off in nurture emails"
              error={errors['nurture.contactNumber']}
            >
              <input
                className="input"
                value={contactNumber}
                maxLength={40}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="+91 98450 00000"
              />
            </Field>
            <Field
              label="Booking link"
              hint="Fills the {{booking_link}} merge field"
              error={errors['nurture.bookingLink']}
            >
              <input
                className="input"
                value={bookingLink}
                maxLength={300}
                onChange={(e) => setBookingLink(e.target.value)}
                placeholder="https://crm.example.com/book/…"
              />
            </Field>
          </div>
        </Card>
        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            Save changes
          </Button>
        </div>
      </form>
    </Section>
  );
}
