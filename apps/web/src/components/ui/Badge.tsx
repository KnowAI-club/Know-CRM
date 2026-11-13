import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'acc' | 'warn' | 'danger' | 'info' | 'ok' | 'violet';
const tones: Record<Tone, string> = {
  neutral: 'bg-subtle text-mute',
  acc: 'bg-acc-soft text-acc',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  ok: 'bg-ok-soft text-ok',
  violet: 'bg-violet-soft text-violet',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
