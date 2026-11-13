export function StageDot({ color, label }: { color?: string | null; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color || 'var(--color-faint)' }} aria-hidden />
      {label}
    </span>
  );
}
