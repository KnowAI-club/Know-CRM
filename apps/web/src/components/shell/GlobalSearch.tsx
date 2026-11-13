'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Search } from 'lucide-react';
import { get } from '@/lib/api';
import { cn } from '@/lib/cn';
import { NAV } from './nav';

interface Hit {
  id: string;
  title: string;
  sub: string;
  link: string;
  download?: string;
  archived?: boolean;
}
interface Group {
  key: string;
  total: number;
  more: boolean;
  items: Hit[];
}

const LABELS: Record<string, string> = {
  go: 'Go to',
  leads: 'Leads',
  projects: 'Projects',
  contacts: 'Clients',
  files: 'Files',
  tasks: 'Tasks',
  meetings: 'Meetings',
  notes: 'Notes',
  documents: 'Documents',
  reminders: 'Reminders',
  templates: 'Email templates',
};

function highlight(text: string, words: string[]): ReactNode {
  if (!words.length || !text) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
  return text.split(re).map((part, i) =>
    i % 2 ? (
      <mark key={i} className="rounded bg-acc-soft px-0.5 text-acc">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

/** Cmd/Ctrl+K command palette over the whole workspace. */
export function GlobalSearch({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 10);
    else {
      setQ('');
      setGroups([]);
    }
  }, [open]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setGroups([]);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      get<{ groups: Group[] }>(`/search?q=${encodeURIComponent(term)}`, ctrl.signal)
        .then((r) => {
          setGroups(r.groups);
          setActive(0);
        })
        .catch(() => undefined);
    }, 140);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const words = useMemo(() => q.toLowerCase().split(/\s+/).filter(Boolean), [q]);
  const goTo: Group | null = useMemo(() => {
    if (!words.length) return null;
    const items = NAV.flatMap((s) => s.items)
      .filter((i) => !i.adminOnly || isAdmin)
      .filter((i) => words.every((w) => i.label.toLowerCase().includes(w)))
      .map((i) => ({ id: i.href, title: i.label, sub: 'Page', link: i.href }));
    return items.length ? { key: 'go', total: items.length, more: false, items } : null;
  }, [words, isAdmin]);
  const all = [...(goTo ? [goTo] : []), ...groups];
  const flat = all.flatMap((g) => g.items);

  const openHit = (h: Hit) => {
    setOpen(false);
    router.push(h.link);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-line bg-card px-3 text-sm text-faint hover:border-acc/40"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 truncate text-left">Search leads, projects, clients…</span>
        <kbd className="hidden rounded border border-line px-1.5 text-[10px] text-mute sm:inline">⌘K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Search className="h-4 w-4 text-mute" />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false);
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, flat.length - 1));
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  }
                  if (e.key === 'Enter' && flat[active]) openHit(flat[active]!);
                }}
                placeholder="Search leads, projects, clients, files, tasks, meetings…"
                className="h-12 flex-1 bg-transparent text-sm outline-none"
                maxLength={100}
              />
            </div>
            <div className="max-h-[60vh] overflow-y-auto py-2">
              {q.trim().length >= 2 && all.length === 0 && <p className="px-4 py-8 text-center text-sm text-mute">No matches for “{q}”.</p>}
              {q.trim().length < 2 && <p className="px-4 py-8 text-center text-sm text-mute">Type at least two characters.</p>}
              {all.map((g) => (
                <div key={g.key} className="pb-1">
                  <p className="px-4 pt-2 pb-1 text-xs font-medium text-faint">
                    {LABELS[g.key] ?? g.key}
                    {g.more && ' · showing top results'}
                  </p>
                  {g.items.map((h) => {
                    const idx = flat.indexOf(h);
                    return (
                      <div
                        key={`${g.key}-${h.id}`}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => openHit(h)}
                        className={cn(
                          'mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2',
                          idx === active && 'bg-acc-soft',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className={cn('truncate text-sm font-medium', h.archived && 'text-mute line-through')}>
                            {highlight(h.title, words)}
                          </p>
                          {h.sub && <p className="truncate text-xs text-mute">{highlight(h.sub, words)}</p>}
                        </div>
                        {h.download && (
                          <a
                            href={h.download}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-md p-1 text-mute hover:text-ink"
                            aria-label="Download"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
