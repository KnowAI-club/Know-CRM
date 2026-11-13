'use client';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui';

/** Section wrapper with a heading, description and optional actions. */
export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-mute">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function ReadOnlyNote() {
  return (
    <Card>
      <p className="text-sm text-mute">Only workspace admins can change these settings.</p>
    </Card>
  );
}

export function ColorInput({ value, onChange, label = 'Colour' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-10 cursor-pointer rounded-lg border border-line bg-card p-1"
      />
    </span>
  );
}
