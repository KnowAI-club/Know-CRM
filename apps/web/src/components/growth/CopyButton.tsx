'use client';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui';
import { absoluteUrl } from './util';

/** Copies an app-relative path as an absolute link. */
export function CopyLinkButton({ path, label = 'Copy link', size = 'sm' }: { path: string; label?: string; size?: 'sm' | 'md' }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(absoluteUrl(path));
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch {
      window.prompt('Copy this link', absoluteUrl(path));
    }
  };
  return (
    <Button variant="secondary" size={size} onClick={copy} aria-live="polite">
      {done ? <Check className="h-3.5 w-3.5 text-acc" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? 'Copied' : label}
    </Button>
  );
}
