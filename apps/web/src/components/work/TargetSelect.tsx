'use client';
import type { Targets, TargetValue } from './useTargets';

/** One select listing open leads and live projects. */
export function TargetSelect({
  targets,
  value,
  onChange,
  id,
  disabled,
  allowNone = false,
  only,
}: {
  targets: Targets;
  value: TargetValue;
  onChange: (v: TargetValue) => void;
  id?: string;
  disabled?: boolean;
  allowNone?: boolean;
  only?: 'lead' | 'project';
}) {
  return (
    <select id={id} className="input" value={value} disabled={disabled || !targets.loaded} onChange={(e) => onChange(e.target.value as TargetValue)}>
      <option value="">{targets.loaded ? (allowNone ? 'Not linked' : 'Choose a lead or project…') : 'Loading…'}</option>
      {only !== 'lead' && targets.projects.length > 0 && (
        <optgroup label="Projects">
          {targets.projects.map((p) => (
            <option key={p.id} value={`project:${p.id}`}>
              {p.name}
              {p.sub ? ` · ${p.sub}` : ''}
            </option>
          ))}
        </optgroup>
      )}
      {only !== 'project' && targets.leads.length > 0 && (
        <optgroup label="Leads">
          {targets.leads.map((l) => (
            <option key={l.id} value={`lead:${l.id}`}>
              {l.name}
              {l.sub ? ` · ${l.sub}` : ''}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
