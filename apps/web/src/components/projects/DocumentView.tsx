import type { ReactNode } from 'react';
import { money } from '@/lib/format';
import type { Block } from './documentTypes';
import { serviceTotals } from './documentTypes';

/** Read-only rendering of document blocks. Slots let the portal render inputs for questions and signatures. */
export function DocumentView({
  title,
  blocks,
  renderQuestion,
  renderSignature,
}: {
  title: string;
  blocks: Block[];
  renderQuestion?: (b: Extract<Block, { type: 'question' }>) => ReactNode;
  renderSignature?: (b: Extract<Block, { type: 'signature' }>) => ReactNode;
}) {
  const totals = serviceTotals(blocks);
  const services = blocks.filter((b) => b.type === 'service');
  const lastService = services[services.length - 1];
  return (
    <article className="prose-crm mx-auto max-w-3xl">
      <h1 className="sr-only">{title}</h1>
      {blocks.map((b) => {
        switch (b.type) {
          case 'heading': {
            const H = `h${b.level}` as 'h1' | 'h2' | 'h3';
            const size = b.level === 1 ? 'text-2xl' : b.level === 2 ? 'text-xl' : 'text-base';
            return (
              <H key={b.id} className={`${size} mt-6 mb-2 font-semibold tracking-tight first:mt-0`}>
                {b.text}
              </H>
            );
          }
          case 'text':
            return (
              <p key={b.id} className="my-3 text-sm leading-relaxed whitespace-pre-wrap">
                {b.text}
              </p>
            );
          case 'service':
            return (
              <div key={b.id}>
                <div className="flex items-start gap-4 border-b border-line py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{b.name}</p>
                    {b.description && <p className="mt-0.5 text-xs whitespace-pre-wrap text-mute">{b.description}</p>}
                  </div>
                  <p className="text-xs whitespace-nowrap text-mute tabular-nums">
                    {b.quantity} × {money(b.unitPrice, b.currency)}
                  </p>
                  <p className="w-28 text-right text-sm font-medium tabular-nums">
                    {money(Math.round(b.quantity * b.unitPrice), b.currency)}
                  </p>
                </div>
                {b === lastService && totals.length > 0 && (
                  <div className="flex justify-end gap-6 py-3 text-sm">
                    <span className="text-mute">Total (before tax)</span>
                    <span className="font-semibold tabular-nums">{totals.map(([c, v]) => money(v, c)).join(' + ')}</span>
                  </div>
                )}
              </div>
            );
          case 'question':
            return (
              <div key={b.id} className="my-4 rounded-xl border border-line p-3">
                <p className="text-sm font-medium">
                  {b.label}
                  {b.required && <span className="text-danger"> *</span>}
                </p>
                {renderQuestion ? (
                  <div className="mt-2">{renderQuestion(b)}</div>
                ) : (
                  <p className="mt-1 text-xs text-faint">
                    {b.questionType === 'choice'
                      ? `Choice: ${b.options.join(' · ')}`
                      : b.questionType === 'long'
                        ? 'Long answer'
                        : 'Short answer'}
                  </p>
                )}
              </div>
            );
          case 'signature':
            return (
              <div key={b.id} className="my-6 rounded-xl border border-dashed border-line p-4">
                <p className="eyebrow mb-2">{b.label}</p>
                {renderSignature ? renderSignature(b) : <div className="h-10 border-b border-ink/40" />}
              </div>
            );
        }
      })}
    </article>
  );
}
