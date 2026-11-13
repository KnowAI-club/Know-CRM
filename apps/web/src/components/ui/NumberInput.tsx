'use client';
import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const BLOCKED = new Set(['-', '+', 'e', 'E']);

/**
 * Numeric input with native up/down steppers. Never negative by default (min 0);
 * signs and exponents cannot be typed, and the mouse wheel does not change it.
 */
export function NumberInput({ className, min = 0, onKeyDown, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <input
      {...props}
      type="number"
      min={min}
      className={cn('input tabular-nums', className)}
      onKeyDown={(e) => {
        if (BLOCKED.has(e.key)) e.preventDefault();
        onKeyDown?.(e);
      }}
      onWheel={(e) => e.currentTarget.blur()}
    />
  );
}
