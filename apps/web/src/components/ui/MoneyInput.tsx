'use client';
import { useEffect, useState } from 'react';
import { fromMinor, toMinor } from '@/lib/format';

/** Decimal amount input that reports minor units (or null while invalid). */
export function MoneyInput({
  value,
  onChange,
  currency = 'INR',
  placeholder = '0.00',
  id,
  disabled,
}: {
  value: number | null;
  onChange: (minor: number | null) => void;
  currency?: string;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value ? fromMinor(value) : '');
  useEffect(() => {
    if (toMinor(text) !== value) setText(value ? fromMinor(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs text-faint">{currency}</span>
      <input
        id={id}
        inputMode="decimal"
        className="input pl-12 text-right tabular-nums"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          onChange(toMinor(e.target.value));
        }}
      />
    </div>
  );
}
