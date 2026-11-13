'use client';
import { useEffect, useMemo, useState } from 'react';
import { Upload } from 'lucide-react';
import { post } from '@/lib/api';
import { Button, Field, Modal, Segmented, useToast } from '@/components/ui';

interface Row {
  name: string;
  company: string;
  email: string;
}
interface Result {
  added: number;
  skipped: { email: string; reason: string }[];
}

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, commas, newlines in quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === '\t' || c === ';') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Maps CSV rows to leads using a header row when present, else by position / email detection. */
function toRows(cells: string[][]) {
  if (!cells.length) return { rows: [] as Row[], invalid: [] as string[] };
  const head = cells[0]!.map((h) => h.toLowerCase());
  const hasHeader = head.some((h) => h.includes('email'));
  const col = (keys: string[]) => head.findIndex((h) => keys.some((k) => h.includes(k)));
  const idx = hasHeader
    ? { name: col(['name', 'full name', 'contact']), company: col(['company', 'organisation', 'organization', 'business']), email: col(['email']) }
    : null;
  const rows: Row[] = [];
  const invalid: string[] = [];
  for (const r of hasHeader ? cells.slice(1) : cells) {
    let name = '';
    let company = '';
    let email = '';
    if (idx) {
      name = idx.name >= 0 ? (r[idx.name] ?? '') : '';
      company = idx.company >= 0 ? (r[idx.company] ?? '') : '';
      email = r[idx.email] ?? '';
    } else {
      const e = r.findIndex((c) => EMAIL.test(c));
      email = e >= 0 ? r[e]! : '';
      const rest = r.filter((_, i) => i !== e);
      name = rest[0] ?? '';
      company = rest[1] ?? '';
    }
    if (!name && email) name = email.split('@')[0]!;
    if (!EMAIL.test(email) || !name) invalid.push(r.join(', '));
    else rows.push({ name: name.slice(0, 200), company: company.slice(0, 200), email: email.toLowerCase() });
  }
  return { rows, invalid };
}

export function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'one' | 'csv'>('one');
  const [one, setOne] = useState<Row>({ name: '', company: '', email: '' });
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const parsed = useMemo(() => toRows(parseCsv(text)), [text]);

  useEffect(() => {
    if (!open) return;
    setOne({ name: '', company: '', email: '' });
    setText('');
    setErrors({});
    setResult(null);
  }, [open]);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast.error('Choose a CSV under 2 MB.');
    setText(await file.text());
  };

  const submit = async () => {
    let leads: Row[];
    if (mode === 'one') {
      const errs: Record<string, string> = {};
      if (!one.name.trim()) errs.name = 'Name is required.';
      if (!EMAIL.test(one.email.trim())) errs.email = 'Enter a valid email.';
      setErrors(errs);
      if (Object.keys(errs).length) return;
      leads = [{ name: one.name.trim(), company: one.company.trim(), email: one.email.trim() }];
    } else {
      if (!parsed.rows.length) return toast.error('No valid rows to import.');
      if (parsed.rows.length > 1000) return toast.error('Import 1000 leads or fewer at a time.');
      leads = parsed.rows;
    }
    setSaving(true);
    try {
      const res = await post<Result>('/nurtures/leads', { source: mode === 'one' ? 'inbound' : 'imported', leads });
      onDone();
      if (mode === 'one' && !res.skipped.length) {
        toast.success(`${leads[0]!.name} added to the General list.`);
        onClose();
      } else setResult(res);
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add leads to Nurtures"
      description="New leads land in the General list, ready to be added to a sequence."
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} loading={saving} disabled={mode === 'csv' && !parsed.rows.length}>
              {mode === 'one' ? 'Add lead' : `Import ${parsed.rows.length || ''} leads`}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3 text-sm">
          <p>
            <span className="font-semibold">{result.added}</span> added
            {result.skipped.length > 0 && (
              <>
                , <span className="font-semibold">{result.skipped.length}</span> skipped
              </>
            )}
            .
          </p>
          {result.skipped.length > 0 && (
            <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-xl border border-line">
              {result.skipped.map((s, i) => (
                <li key={i} className="flex justify-between gap-3 px-3 py-2">
                  <span className="truncate">{s.email}</span>
                  <span className="shrink-0 text-mute">{s.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'one', label: 'One lead' },
              { value: 'csv', label: 'Paste or upload CSV' },
            ]}
          />
          {mode === 'one' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" required error={errors.name}>
                <input className="input" value={one.name} onChange={(e) => setOne({ ...one, name: e.target.value })} maxLength={200} />
              </Field>
              <Field label="Email" required error={errors.email}>
                <input className="input" type="email" value={one.email} onChange={(e) => setOne({ ...one, email: e.target.value })} maxLength={254} />
              </Field>
              <Field label="Company" className="sm:col-span-2">
                <input className="input" value={one.company} onChange={(e) => setOne({ ...one, company: e.target.value })} maxLength={200} />
              </Field>
            </div>
          ) : (
            <>
              <Field label="Rows" hint="Columns: name, company, email. A header row is detected automatically.">
                <textarea
                  className="input font-mono text-xs"
                  rows={8}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={'name,company,email\nAsha Rao,Rao Interiors,asha@example.com'}
                />
              </Field>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-acc hover:underline">
                <Upload className="h-4 w-4" /> Upload a .csv file
                <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => readFile(e.target.files?.[0])} />
              </label>
              {text.trim() && (
                <div className="rounded-xl border border-line text-sm">
                  <p className="border-b border-line px-3 py-2 text-xs text-mute">
                    {parsed.rows.length} ready{parsed.invalid.length > 0 && ` · ${parsed.invalid.length} rows without a valid name and email will be ignored`}
                  </p>
                  <ul className="max-h-48 divide-y divide-line overflow-y-auto">
                    {parsed.rows.slice(0, 50).map((r, i) => (
                      <li key={i} className="grid grid-cols-3 gap-2 px-3 py-1.5 text-xs">
                        <span className="truncate">{r.name}</span>
                        <span className="truncate text-mute">{r.company || '—'}</span>
                        <span className="truncate">{r.email}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
