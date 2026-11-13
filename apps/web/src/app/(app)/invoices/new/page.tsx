'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, ErrorBox, Field, PageHeader, Spinner } from '@/components/ui';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { InvoiceEditor } from '@/components/money/InvoiceEditor';
import type { WorkspaceSettings } from '@/components/money/types';

interface ProjectOption {
  id: string;
  name: string;
  currency: string;
  contact_name: string;
  company?: string | null;
  stage_category: string;
}

function NewInvoice() {
  const router = useRouter();
  const params = useSearchParams();
  const projectId = params.get('projectId') ?? '';
  const projects = useLoad((s) => get<ProjectOption[]>('/projects', s), []);
  const settings = useLoad((s) => get<WorkspaceSettings>('/settings', s), []);
  const project = projects.data?.find((p) => p.id === projectId);
  const back = projectId ? { href: `/projects/${projectId}`, label: 'Back to project' } : { href: '/invoices', label: 'Invoices' };

  if (projects.error || settings.error)
    return (
      <ErrorBox
        error={projects.error ?? settings.error}
        retry={() => {
          void projects.reload();
          void settings.reload();
        }}
      />
    );
  if (!projects.data || !settings.data) return <Spinner />;
  const choices = projects.data.filter((p) => p.stage_category !== 'archived');

  return (
    <>
      <PageHeader
        back={back}
        eyebrow="New invoice"
        title={project ? project.name : 'Choose a project'}
        description={
          project
            ? `Billed to ${project.company || project.contact_name}`
            : 'Invoices belong to a project so payments roll up to the client.'
        }
      />
      <Card className="mb-5">
        <Field label="Project" required>
          <select
            className="input max-w-md"
            value={projectId}
            onChange={(e) => router.replace(e.target.value ? `/invoices/new?projectId=${e.target.value}` : '/invoices/new')}
          >
            <option value="">Select a project…</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.company || p.contact_name}
              </option>
            ))}
          </select>
        </Field>
        {projectId && !project && <p className="mt-2 text-sm text-danger">That project was not found or is archived.</p>}
      </Card>
      {project && (
        <InvoiceEditor
          key={project.id}
          projectId={project.id}
          currency={project.currency}
          billing={settings.data.data.billing}
          onSaved={(inv) => router.replace(`/invoices/${inv.id}`)}
        />
      )}
    </>
  );
}

export default function NewInvoicePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <NewInvoice />
    </Suspense>
  );
}
