'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck } from 'lucide-react';
import { get, post } from '@/lib/api';
import { relative } from '@/lib/format';
import { cn } from '@/lib/cn';

interface Notification {
  id: string;
  title: string;
  body: string;
  link: string;
  kind: string;
  read: boolean;
  created_at: string;
}

export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const load = () =>
    get<{ items: Notification[] }>('/notifications')
      .then((r) => setItems(r.items))
      .catch(() => undefined);
  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const unread = items.filter((i) => !i.read).length;
  const markRead = async (ids?: string[]) => {
    await post('/notifications/read', ids ? { ids } : {}).catch(() => undefined);
    await load();
  };
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-mute hover:bg-subtle hover:text-ink"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
      >
        <Bell className="h-4.5 w-4.5" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(92vw,380px)] rounded-xl border border-line bg-card shadow-xl">
          <div className="flex items-center border-b border-line px-4 py-2.5">
            <p className="flex-1 text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button onClick={() => markRead()} className="inline-flex items-center gap-1 text-xs text-acc hover:underline">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 && <p className="px-4 py-10 text-center text-sm text-mute">You are all caught up.</p>}
            {items.map((n) => {
              const body = (
                <div className={cn('flex gap-3 px-4 py-3 hover:bg-subtle', !n.read && 'bg-acc-soft/40')}>
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-acc')} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{n.title}</p>
                    {n.body && <p className="line-clamp-2 text-xs text-mute">{n.body}</p>}
                    <p className="mt-0.5 text-xs text-faint">{relative(n.created_at)}</p>
                  </div>
                </div>
              );
              return n.link ? (
                <Link
                  key={n.id}
                  href={n.link}
                  onClick={() => {
                    setOpen(false);
                    if (!n.read) void markRead([n.id]);
                  }}
                  className="block border-b border-line last:border-0"
                >
                  {body}
                </Link>
              ) : (
                <div key={n.id} className="border-b border-line last:border-0" onClick={() => !n.read && markRead([n.id])}>
                  {body}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
