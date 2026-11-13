import type { ReactNode } from 'react';

/** Calm, centred layout for pages visitors open without signing in. */
export function PublicFrame({ workspace, children, wide }: { workspace?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-bg px-4 py-10 sm:py-16">
      <div className={wide ? 'mx-auto max-w-3xl' : 'mx-auto max-w-xl'}>
        {workspace && (
          <div className="mb-6 flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-acc text-sm font-bold text-acc-ink">
              {workspace.slice(0, 1).toUpperCase()}
            </span>
            <span className="text-sm font-semibold">{workspace}</span>
          </div>
        )}
        {children}
        <p className="mt-8 text-center text-xs text-faint">Powered by KnowBook CRM</p>
      </div>
    </div>
  );
}
