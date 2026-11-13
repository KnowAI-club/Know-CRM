'use client';
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { post } from '@/lib/api';
import { Button, useToast } from '@/components/ui';

const ADD = '__add__';

/** Select over a shared lead option list (source / industry) with inline "Add new". */
export function OptionSelect({
  kind,
  value,
  options,
  onChange,
  onAdded,
  id,
  disabled,
}: {
  kind: 'source' | 'industry';
  value: string;
  options: string[];
  onChange: (v: string) => void;
  onAdded?: () => void;
  id?: string;
  disabled?: boolean;
}) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const list = value && !options.some((o) => o.toLowerCase() === value.toLowerCase()) ? [value, ...options] : options;

  const save = async () => {
    const label = text.trim();
    if (!label) return;
    setSaving(true);
    try {
      const row = await post<{ label: string }>('/lead-options', { kind, label });
      onChange(row.label);
      onAdded?.();
      setAdding(false);
      setText('');
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (adding)
    return (
      <div className="flex gap-1.5">
        <input
          id={id}
          className="input"
          autoFocus
          maxLength={300}
          value={text}
          placeholder={`New ${kind}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
            if (e.key === 'Escape') setAdding(false);
          }}
        />
        <Button size="icon" variant="soft" onClick={save} loading={saving} aria-label={`Save ${kind}`}>
          {!saving && <Check className="h-4 w-4" />}
        </Button>
        <Button size="icon" variant="ghost" onClick={() => setAdding(false)} aria-label="Cancel">
          <X className="h-4 w-4" />
        </Button>
      </div>
    );

  return (
    <select
      id={id}
      className="input"
      value={value}
      disabled={disabled}
      onChange={(e) => (e.target.value === ADD ? setAdding(true) : onChange(e.target.value))}
    >
      <option value="">Not set</option>
      {list.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      <option value={ADD}>+ Add new {kind}…</option>
    </select>
  );
}
