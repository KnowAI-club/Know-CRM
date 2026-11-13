'use client';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

interface Options {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}
type ConfirmFn = (o: Options) => Promise<boolean>;
const Ctx = createContext<ConfirmFn | null>(null);

/** Promise-based confirmation dialog: `if (await confirm({...})) …`. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<Options | null>(null);
  const resolver = useRef<(v: boolean) => void>(() => undefined);
  const confirm = useCallback<ConfirmFn>(
    (o) =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setOpts(o);
      }),
    [],
  );
  const close = (v: boolean) => {
    resolver.current(v);
    setOpts(null);
  };
  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal
        open={!!opts}
        onClose={() => close(false)}
        title={opts?.title ?? ''}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant={opts?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {opts?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        <div className="text-sm text-mute">{opts?.description}</div>
      </Modal>
    </Ctx.Provider>
  );
}

export function useConfirm() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useConfirm must be used inside ConfirmProvider');
  return v;
}
