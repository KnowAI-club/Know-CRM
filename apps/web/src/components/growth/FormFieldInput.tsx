'use client';
import type { FormField } from './types';

/** Renders one lead-form question as an input (used by the public form and the builder preview). */
export function FormFieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormField;
  value: string | boolean | undefined;
  onChange: (v: string | boolean) => void;
  disabled?: boolean;
}) {
  const id = `q-${field.id}`;
  if (field.type === 'checkbox')
    return (
      <label htmlFor={id} className="flex items-start gap-2.5 text-sm">
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="mt-0.5 h-4 w-4 accent-[var(--acc)]"
        />
        <span>
          {field.label}
          {field.required && <span className="text-danger"> *</span>}
        </span>
      </label>
    );
  const text = typeof value === 'string' ? value : '';
  if (field.type === 'textarea')
    return <textarea id={id} className="input" rows={4} value={text} onChange={(e) => onChange(e.target.value)} disabled={disabled} maxLength={20000} />;
  if (field.type === 'select')
    return (
      <select id={id} className="input" value={text} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">Choose…</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  const type = field.type === 'phone' ? 'tel' : field.type === 'text' ? 'text' : field.type;
  return <input id={id} className="input" type={type} value={text} onChange={(e) => onChange(e.target.value)} disabled={disabled} maxLength={2000} />;
}
