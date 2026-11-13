'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { patch } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useTeam } from '@/lib/team';
import { Button, Field, Modal, MoneyInput, useToast } from '@/components/ui';
import type { Project, ProjectStage } from './types';
import { fieldErrors } from './util';

export function ProjectEditModal({
  open,
  onClose,
  project,
  stages,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  stages: ProjectStage[];
  onSaved: (p: Project) => void;
}) {
  const { currency } = useSession();
  const team = useTeam();
  const toast = useToast();
  const init = () => ({
    name: project.name,
    stage: project.stage,
    value: project.value as number | null,
    dueDate: project.due_date ?? '',
    ownerId: project.owner_id,
    progress: project.progress,
    projectType: project.project_type,
    leadSource: project.lead_source,
    archiveReason: project.archive_reason,
  });
  const [form, setForm] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setForm(init());
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const archived = stages.find((s) => s.id === form.stage)?.category === 'archived';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setErrors({ name: 'Name the project.' });
    if (form.value === null) return setErrors({ value: 'Enter a valid amount.' });
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ...form, dueDate: form.dueDate || null };
      if (!archived) delete body.archiveReason;
      const p = await patch<Project>(`/projects/${project.id}`, body);
      onSaved(p);
      toast.success('Project updated');
      onClose();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof ReturnType<typeof init>>(k: K, v: ReturnType<typeof init>[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit project"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="edit-project" loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-project" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Name" required error={errors.name} className="sm:col-span-2">
          <input className="input" value={form.name} maxLength={500} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Stage" error={errors.stage}>
          <select className="input" value={form.stage} onChange={(e) => set('stage', e.target.value)}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Value" error={errors.value}>
          <MoneyInput value={form.value} onChange={(v) => set('value', v)} currency={project.currency || currency} />
        </Field>
        {archived && (
          <Field label="Archive reason" error={errors.archiveReason} className="sm:col-span-2">
            <input className="input" value={form.archiveReason} maxLength={500} onChange={(e) => set('archiveReason', e.target.value)} />
          </Field>
        )}
        <Field label="Due date" error={errors.dueDate}>
          <input className="input" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </Field>
        <Field label="Owner" error={errors.ownerId}>
          <select className="input" value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)}>
            {!team.some((u) => u.id === project.owner_id) && <option value={project.owner_id}>{project.owner_name}</option>}
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Progress · ${form.progress}%`} error={errors.progress} className="sm:col-span-2">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            className="w-full accent-[var(--color-acc)]"
            value={form.progress}
            onChange={(e) => set('progress', Number(e.target.value))}
          />
        </Field>
        <Field label="Project type" error={errors.projectType}>
          <input
            className="input"
            value={form.projectType}
            maxLength={100}
            placeholder="e.g. Website, Retainer"
            onChange={(e) => set('projectType', e.target.value)}
          />
        </Field>
        <Field label="Lead source" error={errors.leadSource}>
          <input className="input" value={form.leadSource} maxLength={100} onChange={(e) => set('leadSource', e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
