import { cn } from '@/lib/cn';

const palette = [
  'bg-acc-soft text-acc',
  'bg-info-soft text-info',
  'bg-warn-soft text-warn',
  'bg-violet-soft text-violet',
  'bg-ok-soft text-ok',
];

export function initials(name?: string | null) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function Avatar({ name, size = 'md' }: { name?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const hash = [...(name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0);
  const dim = { sm: 'h-6 w-6 text-[10px]', md: 'h-8 w-8 text-xs', lg: 'h-11 w-11 text-sm' }[size];
  return (
    <span
      title={name || undefined}
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold', dim, palette[hash % palette.length])}
    >
      {initials(name)}
    </span>
  );
}
