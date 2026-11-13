'use client';
import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Password input with a show/hide toggle. */
export function PasswordInput({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  const Icon = shown ? EyeOff : Eye;
  return (
    <div className="relative">
      <input {...props} type={shown ? 'text' : 'password'} className={cn('input pr-9', className)} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-faint hover:text-ink"
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
      >
        <Icon className="h-4 w-4" />
      </button>
    </div>
  );
}
