'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface MenuItem {
  label: ReactNode;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}

/** A small dropdown menu anchored to a trigger. */
export function Menu({
  trigger,
  items,
  align = 'right',
}: {
  trigger: (open: () => void) => ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="relative inline-block" ref={ref}>
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-40 mt-1 min-w-44 rounded-xl border border-line bg-card p-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, i) => (
            <button
              key={i}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-subtle disabled:opacity-50',
                item.danger ? 'text-danger' : 'text-ink',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
