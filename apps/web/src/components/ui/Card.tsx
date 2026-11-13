import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({
  title,
  action,
  children,
  className,
  bodyClassName,
  icon,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  icon?: ReactNode;
}) {
  return (
    <section className={cn('card', className)}>
      {(title || action) && (
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          {icon && (
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-acc-soft text-acc">
              {icon}
            </span>
          )}
          <h3 className="flex-1 text-sm font-semibold">{title}</h3>
          {action}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'acc' | 'warn' | 'danger';
}) {
  const color = tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-ink';
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-mute">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tracking-tight', color)}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-faint">{hint}</p>}
    </div>
  );
}
