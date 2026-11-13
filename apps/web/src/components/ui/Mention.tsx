'use client';
import { Fragment, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTeam } from '@/lib/team';
import { cn } from '@/lib/cn';

const TOKEN = /@\[([^\]]{1,120})\]\(user:([0-9a-f-]{36})\)/g;

/** Renders text with `@[Name](user:id)` tokens as highlighted mentions. */
export function MentionText({ text, className }: { text: string; className?: string }) {
  const parts: (string | { name: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    parts.push(text.slice(last, m.index));
    parts.push({ name: m[1]! });
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return (
    <span className={cn('whitespace-pre-wrap', className)}>
      {parts.map((p, i) => (typeof p === 'string' ? <Fragment key={i}>{p}</Fragment> : <span key={i} className="mention">@{p.name}</span>))}
    </span>
  );
}

/** Textarea that offers teammates after typing `@`; inserts a mention token. Ctrl/Cmd+Enter submits. */
export function MentionTextarea({
  value,
  onChange,
  onSubmit,
  placeholder,
  rows = 3,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}) {
  const team = useTeam();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(0);
  const matches = useMemo(
    () => (query ? team.filter((u) => u.name.toLowerCase().includes(query.text.toLowerCase())).slice(0, 6) : []),
    [query, team],
  );

  const detect = (v: string, caret: number) => {
    const before = v.slice(0, caret);
    const m = /(^|\s)@([\w .-]{0,30})$/.exec(before);
    setQuery(m ? { start: caret - m[2]!.length - 1, text: m[2]! } : null);
    setActive(0);
  };
  const insert = (name: string, id: string) => {
    if (!query || !ref.current) return;
    const caret = ref.current.selectionStart;
    const token = `@[${name}](user:${id}) `;
    const next = value.slice(0, query.start) + token + value.slice(caret);
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = query.start + token.length;
      ref.current?.setSelectionRange(pos, pos);
      ref.current?.focus();
    });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => (a + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insert(matches[active]!.name, matches[active]!.id);
        return;
      }
      if (e.key === 'Escape') return setQuery(null);
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };
  return (
    <div className="relative">
      <textarea
        ref={ref}
        className="input"
        rows={rows}
        value={value}
        disabled={disabled}
        placeholder={placeholder ?? 'Write a comment. Type @ to mention a teammate.'}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={onKey}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
      />
      {matches.length > 0 && (
        <div className="absolute left-2 z-30 mt-1 w-60 rounded-xl border border-line bg-card p-1 shadow-lg">
          {matches.map((u, i) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insert(u.name, u.id);
              }}
              className={cn('flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left text-sm', i === active ? 'bg-acc-soft' : 'hover:bg-subtle')}
            >
              <span className="font-medium">{u.name}</span>
              <span className="text-xs text-mute">{u.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
