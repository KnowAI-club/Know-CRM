'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FolderKanban, Mail, MessageSquare, Phone, Trash2, UserRound } from 'lucide-react';
import { del, get, patch, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { date, money, relative } from '@/lib/format';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  MentionText,
  MentionTextarea,
  PageHeader,
  Skeleton,
  useConfirm,
  useToast,
} from '@/components/ui';
import { ContactFields } from '@/components/leads/ContactFields';
import { toBody, toForm, type Contact, type ContactKey } from '@/components/leads/contact';
import { fieldErrors, STATE_LABELS, STATE_TONES, type Lead } from '@/components/leads/types';

interface Project {
  id: string;
  name: string;
  contact_id: string;
  stage_label: string;
  stage_color: string;
  stage_category: string;
  value: number;
  currency: string;
  due_date: string | null;
  phase: string;
}
interface Comment {
  id: string;
  body: string;
  author_name: string;
  created_at: string;
}

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin } = useSession();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const contact = useLoad((s) => get<Contact>(`/contacts/${id}`, s), [id]);
  const projects = useLoad((s) => get<Project[]>('/projects', s).then((all) => all.filter((p) => p.contact_id === id)), [id]);
  const leads = useLoad(
    (s) =>
      get<Lead[]>('/leads', s).then((all) => {
        const email = contact.data?.email?.toLowerCase();
        return all.filter((l) => l.contact_id === id || (email && l.email.toLowerCase() === email));
      }),
    [id, contact.data?.email],
  );

  const base = useMemo(() => toForm(contact.data), [contact.data]);
  const [form, setForm] = useState(base);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setForm(base);
    setErrors({});
  }, [base]);

  if (contact.error) return <ErrorBox error={contact.error} retry={contact.reload} />;
  if (!contact.data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  const c = contact.data;
  const locked: ContactKey[] = isAdmin ? [] : (['email', 'phone'] as ContactKey[]).filter((k) => base[k]);
  const body = toBody(form, base);
  const dirty = Object.keys(body).length > 0;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setErrors({ name: 'Required' });
    setSaving(true);
    try {
      const updated = await patch<Contact>(`/contacts/${id}`, body);
      contact.setData(updated);
      toast.success('Contact saved');
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${c.name}?`,
      description: 'This permanently removes the contact and its comments. Contacts linked to leads or projects cannot be deleted.',
      confirmLabel: 'Delete contact',
      danger: true,
    });
    if (!ok) return;
    try {
      await del(`/contacts/${id}`);
      toast.success('Contact deleted');
      router.push('/clients');
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div>
      <PageHeader
        back={{ href: '/clients', label: 'Clients' }}
        eyebrow={c.company || 'Contact'}
        title={c.name}
        description={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            {c.email && (
              <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-ink">
                <Mail className="h-3.5 w-3.5" /> {c.email}
              </a>
            )}
            {c.phone && (
              <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 hover:text-ink">
                <Phone className="h-3.5 w-3.5" /> {c.phone}
              </a>
            )}
            <span>Added {date(c.created_at)}</span>
          </span>
        }
        actions={
          isAdmin ? (
            <Button variant="ghost" onClick={remove}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <form onSubmit={save} className="card min-w-0 p-4" noValidate>
          <div className="mb-4 flex flex-wrap gap-1">
            {c.tags.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
          <ContactFields form={form} onChange={setForm} errors={errors} locked={locked} />
          <div className="sticky bottom-0 -mx-4 mt-6 flex items-center justify-end gap-2 border-t border-line bg-card/95 px-4 py-3 backdrop-blur">
            {dirty && <span className="mr-auto text-xs text-mute">Unsaved changes</span>}
            <Button variant="secondary" disabled={!dirty || saving} onClick={() => (setForm(base), setErrors({}))}>
              Discard
            </Button>
            <Button type="submit" disabled={!dirty} loading={saving}>
              Save contact
            </Button>
          </div>
        </form>

        <aside className="space-y-4">
          <Card title="Projects" icon={<FolderKanban className="h-4 w-4" />} bodyClassName="p-0">
            {projects.error ? (
              <div className="p-4">
                <ErrorBox error={projects.error} retry={projects.reload} />
              </div>
            ) : !projects.data ? (
              <div className="p-4">
                <Skeleton className="h-12 w-full" />
              </div>
            ) : projects.data.length === 0 ? (
              <p className="p-4 text-sm text-mute">No projects yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {projects.data.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="block px-4 py-3 hover:bg-subtle">
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-mute">
                        <span className="inline-flex items-center gap-1">
                          <span className="h-2 w-2 rounded-full" style={{ background: p.stage_color }} />
                          {p.stage_label}
                        </span>
                        {p.value > 0 && <span>{money(p.value, p.currency)}</span>}
                        {p.due_date && <span>Due {date(p.due_date)}</span>}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Leads" icon={<UserRound className="h-4 w-4" />} bodyClassName="p-0">
            {!leads.data ? (
              <div className="p-4">
                <Skeleton className="h-12 w-full" />
              </div>
            ) : leads.data.length === 0 ? (
              <p className="p-4 text-sm text-mute">No leads linked to this contact.</p>
            ) : (
              <ul className="divide-y divide-line">
                {leads.data.map((l) => (
                  <li key={l.id}>
                    <Link href={`/leads/${l.id}`} className="flex items-center gap-2 px-4 py-3 hover:bg-subtle">
                      <span className="flex-1 truncate text-sm font-medium">{l.name}</span>
                      <Badge tone={STATE_TONES[l.state]}>{STATE_LABELS[l.state]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <ContactComments contactId={id} />
        </aside>
      </div>
    </div>
  );
}

function ContactComments({ contactId }: { contactId: string }) {
  const toast = useToast();
  const { data, error, reload, setData } = useLoad((s) => get<Comment[]>(`/contacts/${contactId}/comments`, s), [contactId]);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const send = async () => {
    if (!body.trim() || saving) return;
    setSaving(true);
    try {
      const c = await post<Comment>(`/contacts/${contactId}/comments`, { body: body.trim() });
      setData((cur) => [c, ...(cur ?? [])]);
      setBody('');
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title="Comments" icon={<MessageSquare className="h-4 w-4" />}>
      <div className="space-y-2">
        <MentionTextarea value={body} onChange={setBody} onSubmit={send} rows={2} />
        <div className="flex justify-end">
          <Button size="sm" onClick={send} loading={saving} disabled={!body.trim()}>
            Post
          </Button>
        </div>
      </div>
      <div className="mt-4">
        {error ? (
          <ErrorBox error={error} retry={reload} />
        ) : !data ? (
          <Skeleton className="h-12 w-full" />
        ) : data.length === 0 ? (
          <Empty title="No comments yet" description="Mention a teammate with @ to loop them in." />
        ) : (
          <ul className="space-y-4">
            {data.map((c) => (
              <li key={c.id} className="flex gap-3">
                <Avatar name={c.author_name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-mute">
                    <span className="font-medium text-ink">{c.author_name}</span> · {relative(c.created_at)}
                  </p>
                  <MentionText text={c.body} className="mt-0.5 block text-sm" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
