'use client';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { get } from '@/lib/api';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Chip input for external guest emails with suggestions from contacts and leads. */
export function GuestEmails({
  value,
  onChange,
  disabled,
  id,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
  id?: string;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<{ email: string; name: string }[]>([]);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) return setSuggestions([]);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      get<{ email: string; name: string }[]>(`/meetings/guest-suggestions?q=${encodeURIComponent(q)}`, ctrl.signal)
        .then((rows) => setSuggestions(rows.filter((r) => !value.includes(r.email))))
        .catch(() => undefined);
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [text, value]);

  const add = (raw: string) => {
    const email = raw.trim().toLowerCase().replace(/[,;]$/, '');
    if (!email) return;
    if (!EMAIL.test(email)) return setError(`“${email}” is not a valid email.`);
    if (value.length >= 50) return setError('Up to 50 guests.');
    if (!value.includes(email)) onChange([...value, email]);
    setText('');
    setError('');
    setSuggestions([]);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ';', 'Tab'].includes(e.key) && text.trim()) {
      e.preventDefault();
      add(text);
    } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
  };

  return (
    <div className="relative">
      <div className="input flex h-auto min-h-9 flex-wrap items-center gap-1.5 py-1.5">
        {value.map((email) => (
          <span key={email} className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-xs">
            {email}
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== email))}
                aria-label={`Remove ${email}`}
                className="text-mute hover:text-ink"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        <input
          id={id}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
          onKeyDown={onKey}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setTimeout(() => setFocused(false), 150);
            if (text.trim()) add(text);
          }}
          placeholder={value.length ? '' : 'name@company.com'}
          className="min-w-32 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      {focused && suggestions.length > 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-line bg-card p-1 shadow-lg">
          {suggestions.map((s) => (
            <button
              type="button"
              key={s.email}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(s.email)}
              className="flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left hover:bg-subtle"
            >
              <span className="text-sm">{s.name || s.email}</span>
              {s.name && <span className="text-xs text-mute">{s.email}</span>}
            </button>
          ))}
        </div>
      )}
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </div>
  );
}
