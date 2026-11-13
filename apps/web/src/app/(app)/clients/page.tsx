'use client';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MessageSquare, Plus, Search, Upload, Users } from 'lucide-react';
import { ApiError, get, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { plural, relative } from '@/lib/format';
import { Badge, Button, Empty, ErrorBox, Modal, PageHeader, Skeleton, useToast } from '@/components/ui';
import { ContactFields } from '@/components/leads/ContactFields';
import { csvToContacts, parseCsv, toBody, toForm, type Contact } from '@/components/leads/contact';
import { fieldErrors } from '@/components/leads/types';

const LEAD_BADGE = {
  won: { tone: 'ok', label: 'Client' },
  open: { tone: 'acc', label: 'Open lead' },
  dropped: { tone: 'neutral', label: 'Archived lead' },
} as const;

export default function ClientsPage() {
  const { data, error, loading, reload } = useLoad((s) => get<Contact[]>('/contacts', s), []);
  const router = useRouter();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'clients' | 'leads' | 'none'>('all');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((c) => {
      if (filter === 'clients' && !c.projects?.length && c.lead_status !== 'won') return false;
      if (filter === 'leads' && c.lead_status !== 'open') return false;
      if (filter === 'none' && (c.projects?.length || c.lead_status)) return false;
      if (!term) return true;
      return [c.name, c.email, c.company, c.phone, ...(c.tags ?? [])].some((v) => v?.toLowerCase().includes(term));
    });
  }, [data, q, filter]);

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Clients"
        description="Every person and company you work with, with their projects and conversations."
        actions={
          <>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <Upload className="h-4 w-4" /> Import CSV
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New contact
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            className="input pl-9"
            placeholder="Search name, email, company, tag"
            aria-label="Search contacts"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select className="input w-auto" aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">All contacts</option>
          <option value="clients">Clients with projects</option>
          <option value="leads">Open leads</option>
          <option value="none">No lead or project</option>
        </select>
        {data && <span className="ml-auto text-xs text-mute">{plural(rows.length, 'contact')}</span>}
      </div>

      {error ? (
        <ErrorBox error={error} retry={reload} />
      ) : loading && !data ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <div className="card">
          <Empty
            icon={<Users className="h-5 w-5" />}
            title={q || filter !== 'all' ? 'No contacts match' : 'No contacts yet'}
            description={q || filter !== 'all' ? undefined : 'Contacts are created from leads, bookings and forms, or add one yourself.'}
          />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th className="hidden md:table-cell">Phone</th>
                <th>Status</th>
                <th>Projects</th>
                <th className="hidden lg:table-cell">Last interaction</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => router.push(`/clients/${c.id}`)}>
                  <td>
                    <Link href={`/clients/${c.id}`} className="font-medium hover:text-acc" onClick={(e) => e.stopPropagation()}>
                      {c.name}
                    </Link>
                    <p className="text-xs text-mute">{c.email || '—'}</p>
                  </td>
                  <td className="text-mute">{c.company || '—'}</td>
                  <td className="hidden whitespace-nowrap text-mute md:table-cell">{c.phone || '—'}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1">
                      {c.lead_status && <Badge tone={LEAD_BADGE[c.lead_status].tone}>{LEAD_BADGE[c.lead_status].label}</Badge>}
                      {(c.tags ?? []).slice(0, 2).map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                      {!!c.comment_count && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-faint">
                          <MessageSquare className="h-3 w-3" /> {c.comment_count}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="text-mute">
                    {c.projects?.length ? <span className="line-clamp-1">{c.projects.map((p) => p.name).join(', ')}</span> : '—'}
                  </td>
                  <td className="hidden whitespace-nowrap text-mute lg:table-cell">{relative(c.last_interaction_at ?? c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateContact open={creating} onClose={() => setCreating(false)} />
      <ImportContacts open={importing} onClose={() => setImporting(false)} onDone={reload} />
    </div>
  );
}

function CreateContact({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState(() => toForm());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const close = () => {
    setForm(toForm());
    setErrors({});
    onClose();
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setErrors({ name: 'Required' });
    setSaving(true);
    try {
      const c = await post<Contact>('/contacts', toBody(form));
      toast.success('Contact created');
      close();
      router.push(`/clients/${c.id}`);
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
      onClose={close}
      title="New contact"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="create-contact" loading={saving}>
            Create contact
          </Button>
        </>
      }
    >
      <form id="create-contact" onSubmit={submit} noValidate>
        <ContactFields form={form} onChange={setForm} errors={errors} compact />
      </form>
    </Modal>
  );
}

function ImportContacts({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState('');
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [problems, setProblems] = useState<{ row: number; message: string }[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setFile('');
    setRecords([]);
    setColumns([]);
    setProblems([]);
    setError('');
    if (input.current) input.current.value = '';
  };
  const close = () => {
    reset();
    onClose();
  };

  const read = async (f: File | undefined) => {
    reset();
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return setError('Choose a CSV under 2 MB.');
    const { records: recs, columns: cols } = csvToContacts(parseCsv(await f.text()));
    setFile(f.name);
    if (!cols.includes('name')) return setError('The first row must include a “Name” column.');
    if (!recs.length) return setError('No rows found under the header.');
    if (recs.length > 1000) return setError('Import up to 1,000 contacts at a time.');
    setRecords(recs);
    setColumns(cols);
  };

  const submit = async () => {
    setSaving(true);
    setProblems([]);
    try {
      const r = await post<{ created: number; skipped: number }>('/contacts/import', { rows: records });
      toast.success(`Imported ${plural(r.created, 'contact')}${r.skipped ? `, skipped ${r.skipped} existing` : ''}`);
      onDone();
      close();
    } catch (err) {
      const rows = err instanceof ApiError ? (err.details as { rows?: { row: number; message: string }[] } | undefined)?.rows : undefined;
      if (rows?.length) setProblems(rows);
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import contacts"
      description="Upload a CSV with a header row. Existing emails are skipped."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={!records.length || Boolean(error && !problems.length)}>
            Import {records.length ? plural(records.length, 'contact') : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="w-full rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-mute hover:border-acc/50 hover:text-ink"
        >
          <Upload className="mx-auto mb-2 h-5 w-5" />
          {file || 'Choose a .csv file'}
        </button>
        <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void read(e.target.files?.[0])} />
        <p className="text-xs text-mute">
          Recognised columns: Name (required), Email, Company, Phone, Job title, Website, Address, Tags, GSTIN, PAN, Billing name, Billing
          email, Billing address.
        </p>
        {columns.length > 0 && (
          <p className="text-sm">
            Ready to import <strong>{records.length}</strong> rows using: {columns.join(', ')}.
          </p>
        )}
        {error && (
          <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        {problems.length > 0 && (
          <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-danger">
            {problems.map((p) => (
              <li key={p.row}>
                Row {p.row + 1}: {p.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
