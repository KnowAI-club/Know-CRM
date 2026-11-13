'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Building2, Mail, Phone, Pencil, Users } from 'lucide-react';
import { patch } from '@/lib/api';
import { date, money } from '@/lib/format';
import { Avatar, Button, Card, useToast } from '@/components/ui';
import { Milestones } from './Milestones';
import { Versions } from './Versions';
import type { ProjectDetail, Project } from './types';

export function OverviewTab({
  detail,
  onProject,
  onMilestones,
  isAdmin,
  openAccess,
}: {
  detail: ProjectDetail;
  onProject: (p: Project) => void;
  onMilestones: (m: ProjectDetail['milestones']) => void;
  isAdmin: boolean;
  openAccess: () => void;
}) {
  const toast = useToast();
  const { project, clientInfo, participants } = detail;
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(project.description);
  const [saving, setSaving] = useState(false);
  const contact = clientInfo.contact;
  const lead = clientInfo.lead;

  const saveDesc = async () => {
    setSaving(true);
    try {
      onProject(await patch<Project>(`/projects/${project.id}`, { description: desc }));
      setEditing(false);
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const openTasks = detail.tasks.filter((t) => !t.completed).length;
  const outstanding = detail.invoices.filter((i) => i.status !== 'void' && i.status !== 'draft').reduce((a, i) => a + i.balance, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card
          title="About this project"
          action={
            !editing && (
              <Button size="sm" variant="ghost" onClick={() => (setDesc(project.description), setEditing(true))}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            )
          }
        >
          {editing ? (
            <div>
              <textarea
                className="input"
                rows={5}
                value={desc}
                maxLength={20000}
                onChange={(e) => setDesc(e.target.value)}
                aria-label="Description"
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={saveDesc} loading={saving}>
                  Save
                </Button>
              </div>
            </div>
          ) : project.description ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{project.description}</p>
          ) : (
            <p className="text-sm text-mute">No description yet. Add scope, goals and context for the team.</p>
          )}
        </Card>
        <Milestones projectId={project.id} milestones={detail.milestones} onChange={onMilestones} />
        <Versions projectId={project.id} />
      </div>
      <div className="space-y-4">
        <Card title="At a glance">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-mute">Value</dt>
              <dd className="font-medium tabular-nums">{money(project.value, project.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-mute">Outstanding</dt>
              <dd className="font-medium tabular-nums">{money(outstanding, project.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-mute">Started</dt>
              <dd>{date(project.start_date || project.created_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-mute">Due</dt>
              <dd>{date(project.due_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-mute">Open tasks</dt>
              <dd>{openTasks}</dd>
            </div>
            <div>
              <dt className="text-xs text-mute">Type</dt>
              <dd>{project.project_type || '—'}</dd>
            </div>
            <div className="col-span-2">
              <dt className="mb-1 text-xs text-mute">Progress · {project.progress}%</dt>
              <dd className="h-1.5 overflow-hidden rounded-full bg-subtle">
                <div className="h-full rounded-full bg-acc" style={{ width: `${project.progress}%` }} />
              </dd>
            </div>
            {project.archive_reason && (
              <div className="col-span-2">
                <dt className="text-xs text-mute">Archive reason</dt>
                <dd>{project.archive_reason}</dd>
              </div>
            )}
          </dl>
        </Card>
        <Card title="Client" icon={<Building2 className="h-4 w-4" />}>
          {contact ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Avatar name={contact.name} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{contact.name}</p>
                  {contact.company && <p className="truncate text-xs text-mute">{contact.company}</p>}
                </div>
              </div>
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-mute hover:text-ink">
                  <Mail className="h-3.5 w-3.5" /> {contact.email}
                </a>
              )}
              {contact.phone && (
                <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-mute hover:text-ink">
                  <Phone className="h-3.5 w-3.5" /> {contact.phone}
                </a>
              )}
              {(contact.billing_name || contact.gstin) && (
                <div className="rounded-lg bg-subtle/60 p-2 text-xs text-mute">
                  {contact.billing_name && <p>Bills to {contact.billing_name}</p>}
                  {contact.gstin && <p>GSTIN {contact.gstin}</p>}
                </div>
              )}
              <Link href={`/clients/${contact.id}`} className="inline-block text-xs text-acc hover:underline">
                View client record
              </Link>
            </div>
          ) : (
            <p className="text-sm text-mute">No client linked.</p>
          )}
          {lead && (
            <div className="mt-3 border-t border-line pt-3 text-xs text-mute">
              Won from lead{' '}
              <Link href={`/leads/${lead.id}`} className="font-medium text-acc hover:underline">
                {lead.name}
              </Link>
              {lead.won_at && ` on ${date(lead.won_at)}`}
              {lead.owner_name && ` · owner ${lead.owner_name}`}
            </div>
          )}
        </Card>
        <Card title="Client portal" icon={<Users className="h-4 w-4" />}>
          {participants.length ? (
            <ul className="space-y-2">
              {participants.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <Avatar name={p.name} size="sm" />
                  <span className="truncate">{p.name}</span>
                  <span className="ml-auto truncate text-xs text-faint">{p.email}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mute">The client has no portal login for this project.</p>
          )}
          {isAdmin && (
            <Button size="sm" variant="secondary" className="mt-3" onClick={openAccess}>
              Manage access
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
}
