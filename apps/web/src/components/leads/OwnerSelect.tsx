'use client';
import { useTeam } from '@/lib/team';

/** Picker over active team members. */
export function OwnerSelect({
  value,
  onChange,
  id,
  emptyLabel = 'Unassigned',
  disabled,
  extra,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  emptyLabel?: string | null;
  disabled?: boolean;
  /** Keeps a current (possibly deactivated) member visible. */
  extra?: { id: string; name: string } | null;
}) {
  const team = useTeam();
  const list =
    extra && extra.id && !team.some((u) => u.id === extra.id) ? [...team, { ...extra, email: '', role: 'sales' as const }] : team;
  return (
    <select id={id} className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {emptyLabel !== null && <option value="">{emptyLabel}</option>}
      {list.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );
}
