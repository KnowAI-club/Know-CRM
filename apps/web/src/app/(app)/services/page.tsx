'use client';
import { useState } from 'react';
import { Archive, ArchiveRestore, Package, Pencil, Plus } from 'lucide-react';
import { Badge, Button, Card, Empty, ErrorBox, Field, Modal, MoneyInput, PageHeader, Segmented, Spinner, useToast } from '@/components/ui';
import { ApiError, get, patch, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { money } from '@/lib/format';
import { fieldErrors } from '@/components/money/util';
import type { Service } from '@/components/money/types';

export default function ServicesPage() {
  const { currency } = useSession();
  const toast = useToast();
  const services = useLoad((s) => get<Service[]>('/services', s), []);
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const list = (services.data ?? []).filter((s) => (view === 'archived' ? s.archived : !s.archived));

  const toggleArchive = async (s: Service) => {
    setBusy(s.id);
    try {
      const saved = await patch<Service>(`/services/${s.id}`, { archived: !s.archived });
      services.setData((l) => l?.map((x) => (x.id === saved.id ? saved : x)));
      toast.success(saved.archived ? 'Service archived.' : 'Service restored.');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Service catalog"
        description="Reference prices you can drop into invoices and proposals."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> Add service
          </Button>
        }
      />
      <div className="mb-4">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
      </div>
      {services.error ? (
        <ErrorBox error={services.error} retry={services.reload} />
      ) : !services.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card>
          <Empty
            icon={<Package className="h-5 w-5" />}
            title={view === 'archived' ? 'No archived services' : 'No services yet'}
            description={view === 'archived' ? undefined : 'Add the services you sell with a default price.'}
            action={view === 'active' && <Button onClick={() => setEditing('new')}>Add service</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => (
            <div key={s.id} className="card flex flex-col p-4">
              <div className="flex items-start gap-2">
                <p className="flex-1 font-medium">{s.name}</p>
                {s.archived && <Badge>Archived</Badge>}
              </div>
              <p className="mt-1 line-clamp-3 flex-1 text-sm text-mute">{s.description || 'No description'}</p>
              <div className="mt-3 flex items-center gap-1 border-t border-line pt-3">
                <p className="flex-1 text-sm">
                  <span className="font-semibold tabular-nums">{money(s.unit_price, s.currency)}</span>{' '}
                  <span className="text-mute">/ {s.unit}</span>
                </p>
                <Button size="icon" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={s.archived ? 'Restore' : 'Archive'}
                  title={s.archived ? 'Restore' : 'Archive'}
                  loading={busy === s.id}
                  onClick={() => toggleArchive(s)}
                >
                  {busy !== s.id && (s.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />)}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <ServiceModal
          service={editing === 'new' ? null : editing}
          currency={currency}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            services.setData((l) => [...(l ?? []).filter((x) => x.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ServiceModal({
  service,
  currency,
  onClose,
  onSaved,
}: {
  service: Service | null;
  currency: string;
  onClose: () => void;
  onSaved: (s: Service) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(service?.name ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [unit, setUnit] = useState(service?.unit ?? 'project');
  const [price, setPrice] = useState<number | null>(service?.unit_price ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name the service.';
    if (price === null) errs.unitPrice = 'Enter a valid price.';
    if (!unit.trim()) errs.unit = 'Required';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const body = { name: name.trim(), description, unit: unit.trim(), unitPrice: price };
      const saved = service ? await patch<Service>(`/services/${service.id}`, body) : await post<Service>('/services', body);
      toast.success('Service saved.');
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={service ? 'Edit service' : 'Add service'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="service-form" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form id="service-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required error={errors.name} className="sm:col-span-2">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Price" required error={errors.unitPrice}>
          <MoneyInput value={price} currency={service?.currency ?? currency} onChange={setPrice} />
        </Field>
        <Field label="Per" hint="e.g. project, month, hour" error={errors.unit}>
          <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={100} />
        </Field>
        <Field label="Description" className="sm:col-span-2" error={errors.description}>
          <textarea className="input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10000} />
        </Field>
      </form>
    </Modal>
  );
}
