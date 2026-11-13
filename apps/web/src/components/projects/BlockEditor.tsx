'use client';
import { ArrowDown, ArrowUp, Heading, ListChecks, PenLine, Receipt, Trash2, Type } from 'lucide-react';
import { CURRENCIES } from '@know-crm/shared';
import { Button, Field, MoneyInput } from '@/components/ui';
import type { Block } from './documentTypes';
import { blockId } from './util';

const ADDERS: { type: Block['type']; label: string; icon: React.ReactNode }[] = [
  { type: 'heading', label: 'Heading', icon: <Heading className="h-3.5 w-3.5" /> },
  { type: 'text', label: 'Text', icon: <Type className="h-3.5 w-3.5" /> },
  { type: 'service', label: 'Service', icon: <Receipt className="h-3.5 w-3.5" /> },
  { type: 'question', label: 'Question', icon: <ListChecks className="h-3.5 w-3.5" /> },
  { type: 'signature', label: 'Signature', icon: <PenLine className="h-3.5 w-3.5" /> },
];

export function newBlock(type: Block['type'], currency: string): Block {
  const id = blockId();
  switch (type) {
    case 'heading':
      return { id, type, text: '', level: 2 };
    case 'text':
      return { id, type, text: '' };
    case 'service':
      return { id, type, name: '', description: '', quantity: 1, unitPrice: 0, currency };
    case 'question':
      return { id, type, label: '', questionType: 'short', required: false, options: [] };
    case 'signature':
      return { id, type, label: 'Client signature' };
  }
}

/** Editable list of document blocks with reorder and add controls. */
export function BlockEditor({
  blocks,
  onChange,
  currency,
  errors,
}: {
  blocks: Block[];
  onChange: (b: Block[]) => void;
  currency: string;
  errors: Record<string, string>;
}) {
  const set = (i: number, patch: Partial<Block>) => onChange(blocks.map((b, j) => (j === i ? ({ ...b, ...patch } as Block) : b)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const err = (i: number, key?: string) => errors[`blocks.${i}${key ? `.${key}` : ''}`] ?? (key ? undefined : errors[`blocks.${i}`]);

  const adder = (at: number) => (
    <div className="flex flex-wrap items-center gap-1">
      {ADDERS.map((a) => (
        <Button
          key={a.type}
          size="sm"
          variant="ghost"
          onClick={() => {
            const next = [...blocks];
            next.splice(at, 0, newBlock(a.type, currency));
            onChange(next);
          }}
        >
          {a.icon} {a.label}
        </Button>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      {blocks.map((b, i) => (
        <div key={b.id} className="card p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="eyebrow">{b.type}</span>
            <div className="ml-auto flex">
              <Button size="icon" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" aria-label="Move down" disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" aria-label="Delete block" onClick={() => onChange(blocks.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {b.type === 'heading' && (
            <div className="flex gap-2">
              <select
                className="input w-24"
                value={b.level}
                aria-label="Heading level"
                onChange={(e) => set(i, { level: Number(e.target.value) as 1 | 2 | 3 })}
              >
                <option value={1}>H1</option>
                <option value={2}>H2</option>
                <option value={3}>H3</option>
              </select>
              <div className="flex-1">
                <input
                  className="input font-semibold"
                  placeholder="Heading"
                  maxLength={200}
                  value={b.text}
                  onChange={(e) => set(i, { text: e.target.value })}
                  aria-label="Heading text"
                />
                {err(i, 'text') && <p className="mt-1 text-xs text-danger">{err(i, 'text')}</p>}
              </div>
            </div>
          )}
          {b.type === 'text' && (
            <textarea
              className="input"
              rows={4}
              placeholder="Write a paragraph…"
              maxLength={20000}
              value={b.text}
              onChange={(e) => set(i, { text: e.target.value })}
              aria-label="Text"
            />
          )}
          {b.type === 'service' && (
            <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_6rem]">
              <Field label="Service" error={err(i, 'name')}>
                <input className="input" maxLength={200} value={b.name} onChange={(e) => set(i, { name: e.target.value })} />
              </Field>
              <Field label="Unit price" error={err(i, 'unitPrice')}>
                <MoneyInput value={b.unitPrice} currency={b.currency} onChange={(v) => set(i, { unitPrice: v ?? 0 })} />
              </Field>
              <Field label="Quantity" error={err(i, 'quantity')}>
                <input
                  className="input"
                  type="number"
                  min={0.01}
                  step="any"
                  value={b.quantity}
                  onChange={(e) => set(i, { quantity: Number(e.target.value) })}
                />
              </Field>
              <Field label="Currency">
                <select className="input" value={b.currency} onChange={(e) => set(i, { currency: e.target.value })}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Description" className="sm:col-span-4">
                <textarea
                  className="input"
                  rows={2}
                  maxLength={5000}
                  value={b.description}
                  onChange={(e) => set(i, { description: e.target.value })}
                />
              </Field>
            </div>
          )}
          {b.type === 'question' && (
            <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
              <Field label="Question" error={err(i, 'label')}>
                <input className="input" maxLength={200} value={b.label} onChange={(e) => set(i, { label: e.target.value })} />
              </Field>
              <Field label="Answer type">
                <select
                  className="input"
                  value={b.questionType}
                  onChange={(e) => set(i, { questionType: e.target.value as 'short' | 'long' | 'choice' })}
                >
                  <option value="short">Short answer</option>
                  <option value="long">Long answer</option>
                  <option value="choice">Single choice</option>
                </select>
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" checked={b.required} onChange={(e) => set(i, { required: e.target.checked })} /> Required
              </label>
              {b.questionType === 'choice' && (
                <Field label="Options (one per line)" error={err(i)} className="sm:col-span-3">
                  <textarea
                    className="input"
                    rows={3}
                    value={b.options.join('\n')}
                    onChange={(e) =>
                      set(i, {
                        options: e.target.value
                          .split('\n')
                          .map((o) => o.trimStart())
                          .slice(0, 50),
                      })
                    }
                    onBlur={() => set(i, { options: b.options.map((o) => o.trim()).filter(Boolean) })}
                  />
                </Field>
              )}
            </div>
          )}
          {b.type === 'signature' && (
            <Field label="Signature label" error={err(i, 'label')}>
              <input className="input" maxLength={200} value={b.label} onChange={(e) => set(i, { label: e.target.value })} />
            </Field>
          )}
          {err(i) && b.type !== 'question' && <p className="mt-1 text-xs text-danger">{err(i)}</p>}
        </div>
      ))}
      <div className="rounded-xl border border-dashed border-line p-2">
        <p className="mb-1 px-2 text-xs text-faint">Add a block</p>
        {adder(blocks.length)}
      </div>
    </div>
  );
}
