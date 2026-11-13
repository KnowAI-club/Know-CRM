'use client';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/api';

type Kind = 'success' | 'error' | 'info';
interface Item {
  id: number;
  kind: Kind;
  text: string;
}
interface ToastApi {
  success: (text: string) => void;
  error: (e: unknown) => void;
  info: (text: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const push = useCallback((kind: Kind, text: string) => {
    const id = ++seq;
    setItems((list) => [...list.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  const api: ToastApi = {
    success: (t) => push('success', t),
    info: (t) => push('info', t),
    error: (e) => push('error', errorMessage(e)),
  };
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((i) => (
          <div
            key={i.id}
            className={cn(
              'pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm shadow-lg',
              i.kind === 'error' ? 'border-danger/30 bg-danger-soft text-danger' : 'border-line bg-card text-ink',
            )}
          >
            {i.kind === 'error' ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-acc" />
            )}
            <span className="flex-1">{i.text}</span>
            <button
              onClick={() => setItems((l) => l.filter((x) => x.id !== i.id))}
              aria-label="Dismiss"
              className="text-mute hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast must be used inside ToastProvider');
  return v;
}
