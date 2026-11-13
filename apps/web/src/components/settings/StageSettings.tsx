'use client';
import { useState } from 'react';
import { ArrowDown, ArrowUp, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { PROJECT_CATEGORIES } from '@know-crm/shared';
import { Badge, Button, Card, ErrorBox, Field, Modal, Spinner, useConfirm, useToast } from '@/components/ui';
import { ApiError, del, get, patch, post, put } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { titleCase } from '@/lib/format';
import { fieldErrors } from '@/components/money/util';
import { ColorInput, Section } from './shared';

interface ProjectStage {
  id: string;
  label: string;
  color: string;
  category: (typeof PROJECT_CATEGORIES)[number];
  position: number;
  system: boolean;
  project_count: number;
}
interface LeadStage {
  id: string;
  label: string;
  color: string;
  kind: 'open' | 'won';
  position: number;
  system: boolean;
  project_stage_id: string | null;
  project_stage_label: string | null;
  lead_count: number;
}

function useReorder<T extends { id: string }>(path: string, setData: (fn: (d: T[] | undefined) => T[] | undefined) => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const move = async (list: T[], i: number, d: -1 | 1) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    setData(() => next);
    setBusy(true);
    try {
      const saved = await put<T[]>(path, { stageIds: next.map((s) => s.id) });
      setData(() => saved);
    } catch (e) {
      setData(() => list);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return { move, busy };
}

/* ───────────── Lead stages ───────────── */

export function LeadStageSettings() {
  const toast = useToast();
  const confirm = useConfirm();
  const stages = useLoad((s) => get<LeadStage[]>('/lead-stages', s), []);
  const projectStages = useLoad((s) => get<ProjectStage[]>('/project-stages', s), []);
  const [editing, setEditing] = useState<LeadStage | 'new' | null>(null);
  const { move, busy } = useReorder<LeadStage>('/lead-stages/order', stages.setData);

  const remove = async (s: LeadStage) => {
    if (!(await confirm({ title: `Delete “${s.label}”?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await del(`/lead-stages/${s.id}`);
      await stages.reload();
      toast.success('Stage deleted.');
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Section
      title="Lead pipeline stages"
      description="Columns on the leads board. “Won” stages create a project in the chosen project stage."
      actions={
        <Button onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> Add stage
        </Button>
      }
    >
      <Card bodyClassName="p-0">
        {stages.error ? (
          <div className="p-4">
            <ErrorBox error={stages.error} retry={stages.reload} />
          </div>
        ) : !stages.data ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-line">
            {stages.data.map((s, i, list) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {s.label}
                    {s.system && <Lock className="ml-1.5 inline h-3 w-3 text-faint" aria-label="System stage" />}
                  </p>
                  <p className="text-xs text-mute">
                    {s.lead_count} lead{s.lead_count === 1 ? '' : 's'}
                    {s.kind === 'won' && s.project_stage_label && ` · creates project in ${s.project_stage_label}`}
                  </p>
                </div>
                <Badge tone={s.kind === 'won' ? 'ok' : 'neutral'}>{s.kind === 'won' ? 'Won' : 'Open'}</Badge>
                <div className="flex">
                  <Button size="icon" variant="ghost" aria-label="Move up" disabled={i === 0 || busy} onClick={() => move(list, i, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Move down"
                    disabled={i === list.length - 1 || busy}
                    onClick={() => move(list, i, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={`Edit ${s.label}`} onClick={() => setEditing(s)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete ${s.label}`}
                    disabled={s.system || s.lead_count > 0}
                    title={s.system ? 'System stages cannot be deleted' : s.lead_count ? 'Move leads out first' : undefined}
                    onClick={() => remove(s)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && (
        <LeadStageModal
          stage={editing === 'new' ? null : editing}
          projectStages={(projectStages.data ?? []).filter((p) => p.category === 'inquiry' || p.category === 'in_progress')}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void stages.reload();
          }}
        />
      )}
    </Section>
  );
}

function LeadStageModal({
  stage,
  projectStages,
  onClose,
  onSaved,
}: {
  stage: LeadStage | null;
  projectStages: ProjectStage[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [label, setLabel] = useState(stage?.label ?? '');
  const [color, setColor] = useState(stage?.color ?? '#9ca7cf');
  const [kind, setKind] = useState<'open' | 'won'>(stage?.kind ?? 'open');
  const [projectStageId, setProjectStageId] = useState(stage?.project_stage_id ?? projectStages[0]?.id ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const kindLocked = !!stage && (stage.system || stage.lead_count > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!label.trim()) errs.label = 'Required';
    if (kind === 'won' && !projectStageId) errs.projectStageId = 'Choose where won leads go.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const body = {
        label: label.trim(),
        color,
        kind,
        projectStageId: kind === 'won' ? projectStageId : null,
      };
      if (stage) await patch(`/lead-stages/${stage.id}`, body);
      else await post('/lead-stages', body);
      toast.success('Stage saved.');
      onSaved();
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
      size="sm"
      title={stage ? 'Edit lead stage' : 'Add lead stage'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="lead-stage" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form id="lead-stage" onSubmit={submit} className="space-y-4">
        <div className="flex items-end gap-3">
          <Field label="Label" required error={errors.label} className="flex-1">
            <input className="input" value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <ColorInput value={color} onChange={setColor} />
        </div>
        <Field label="Behaviour" hint={kindLocked ? 'Only unused custom stages can change behaviour.' : undefined} error={errors.kind}>
          <select className="input" value={kind} disabled={kindLocked} onChange={(e) => setKind(e.target.value as 'open' | 'won')}>
            <option value="open">Open: lead is still being worked</option>
            <option value="won">Won: moving here closes the deal</option>
          </select>
        </Field>
        {kind === 'won' && (
          <Field label="Create project in" required error={errors.projectStageId}>
            <select className="input" value={projectStageId} onChange={(e) => setProjectStageId(e.target.value)}>
              <option value="">Choose a project stage…</option>
              {projectStages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </form>
    </Modal>
  );
}

/* ───────────── Project stages ───────────── */

const CATEGORY_HELP: Record<string, string> = {
  inquiry: 'Not started yet',
  in_progress: 'Active delivery',
  completed: 'Delivered / live',
  archived: 'Hidden from boards',
};

export function ProjectStageSettings() {
  const toast = useToast();
  const confirm = useConfirm();
  const stages = useLoad((s) => get<ProjectStage[]>('/project-stages', s), []);
  const [editing, setEditing] = useState<ProjectStage | 'new' | null>(null);
  const { move, busy } = useReorder<ProjectStage>('/project-stages/order', stages.setData);

  const remove = async (s: ProjectStage) => {
    if (!(await confirm({ title: `Delete “${s.label}”?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await del(`/project-stages/${s.id}`);
      await stages.reload();
      toast.success('Stage deleted.');
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Section
      title="Project stages"
      description="Columns on the projects board. The category decides how reports treat each stage."
      actions={
        <Button onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> Add stage
        </Button>
      }
    >
      <Card bodyClassName="p-0">
        {stages.error ? (
          <div className="p-4">
            <ErrorBox error={stages.error} retry={stages.reload} />
          </div>
        ) : !stages.data ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-line">
            {stages.data.map((s, i, list) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {s.label}
                    {s.system && <Lock className="ml-1.5 inline h-3 w-3 text-faint" aria-label="System stage" />}
                  </p>
                  <p className="text-xs text-mute">
                    {s.project_count} project{s.project_count === 1 ? '' : 's'}
                  </p>
                </div>
                <Badge tone="neutral">{titleCase(s.category)}</Badge>
                <div className="flex">
                  <Button size="icon" variant="ghost" aria-label="Move up" disabled={i === 0 || busy} onClick={() => move(list, i, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Move down"
                    disabled={i === list.length - 1 || busy}
                    onClick={() => move(list, i, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={`Edit ${s.label}`} onClick={() => setEditing(s)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete ${s.label}`}
                    disabled={s.system || s.project_count > 0}
                    onClick={() => remove(s)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && (
        <ProjectStageModal
          stage={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void stages.reload();
          }}
        />
      )}
    </Section>
  );
}

function ProjectStageModal({ stage, onClose, onSaved }: { stage: ProjectStage | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [label, setLabel] = useState(stage?.label ?? '');
  const [color, setColor] = useState(stage?.color ?? '#7da397');
  const [category, setCategory] = useState<ProjectStage['category']>(stage?.category ?? 'in_progress');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const categoryLocked = !!stage && (stage.system || stage.project_count > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return setErrors({ label: 'Required' });
    setSaving(true);
    try {
      const body = { label: label.trim(), color, ...(categoryLocked ? {} : { category }) };
      if (stage) await patch(`/project-stages/${stage.id}`, body);
      else await post('/project-stages', { ...body, category });
      toast.success('Stage saved.');
      onSaved();
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
      size="sm"
      title={stage ? 'Edit project stage' : 'Add project stage'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="project-stage" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form id="project-stage" onSubmit={submit} className="space-y-4">
        <div className="flex items-end gap-3">
          <Field label="Label" required error={errors.label} className="flex-1">
            <input className="input" value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <ColorInput value={color} onChange={setColor} />
        </div>
        <Field
          label="Category"
          hint={categoryLocked ? 'Move projects out (or use a custom stage) to change the category.' : undefined}
          error={errors.category}
        >
          <select
            className="input"
            value={category}
            disabled={categoryLocked}
            onChange={(e) => setCategory(e.target.value as ProjectStage['category'])}
          >
            {PROJECT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {titleCase(c)} · {CATEGORY_HELP[c]}
              </option>
            ))}
          </select>
        </Field>
      </form>
    </Modal>
  );
}
