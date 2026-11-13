'use client';
import { ArrowDown, ArrowUp, Heading, ListChecks, PenLine, Plus, ShoppingBag, Trash2, Type } from 'lucide-react';
import { Button, Field, Menu, MoneyInput, NumberInput } from '@/components/ui';
import { uuid } from '@/components/money/util';

export type Block =
  | { id: string; type: 'heading'; text: string; level: 1 | 2 | 3 }
  | { id: string; type: 'text'; text: string }
  | {
      id: string;
      type: 'service';
      name: string;
      description: string;
      quantity: number;
      unitPrice: number;
      currency: string;
    }
  | {
      id: string;
      type: 'question';
      label: string;
      questionType: 'short' | 'long' | 'choice';
      required: boolean;
      options: string[];
    }
  | { id: string; type: 'signature'; label: string };

const LABEL: Record<Block['type'], string> = {
  heading: 'Heading',
  text: 'Text',
  service: 'Service',
  question: 'Question',
  signature: 'Signature',
};

export function newBlock(type: Block['type'], currency: string): Block {
  const id = `b_${uuid().slice(0, 8)}`;
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

/** Client-side checks mirroring the API's block rules; returns an error per block id. */
export function validateBlocks(blocks: Block[]) {
  const errors: Record<string, string> = {};
  for (const b of blocks) {
    if (b.type === 'heading' && !b.text.trim()) errors[b.id] = 'Headings need text.';
    if (b.type === 'service' && !b.name.trim()) errors[b.id] = 'Name the service.';
    if (b.type === 'service' && !(b.quantity > 0)) errors[b.id] = 'Quantity must be above 0.';
    if (b.type === 'question' && !b.label.trim()) errors[b.id] = 'Questions need a label.';
    if (b.type === 'question' && b.questionType === 'choice' && new Set(b.options.map((o) => o.trim()).filter(Boolean)).size < 2)
      errors[b.id] = 'A choice question needs at least two different options.';
    if (b.type === 'signature' && !b.label.trim()) errors[b.id] = 'Signature blocks need a label.';
  }
  return errors;
}

const ICON = {
  heading: Heading,
  text: Type,
  service: ShoppingBag,
  question: ListChecks,
  signature: PenLine,
};

/** Ordered list editor for proposal/contract/questionnaire blocks. */
export function BlocksEditor({
  blocks,
  onChange,
  currency,
  errors = {},
}: {
  blocks: Block[];
  onChange: (b: Block[]) => void;
  currency: string;
  errors?: Record<string, string>;
}) {
  const update = (id: string, patch: Partial<Block>) => onChange(blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...blocks];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  const add = (type: Block['type']) => onChange([...blocks, newBlock(type, currency)]);

  return (
    <div className="space-y-3">
      {blocks.length === 0 && <p className="rounded-lg bg-subtle px-3 py-4 text-center text-sm text-mute">Add a block to start.</p>}
      {blocks.map((b, i) => {
        const Icon = ICON[b.type];
        return (
          <div key={b.id} className="rounded-xl border border-line p-3">
            <div className="mb-2 flex items-center gap-2">
              <Icon className="h-4 w-4 text-acc" />
              <span className="flex-1 text-xs font-semibold text-mute uppercase">{LABEL[b.type]}</span>
              <Button size="icon" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" aria-label="Move down" disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" aria-label="Remove block" onClick={() => onChange(blocks.filter((x) => x.id !== b.id))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {b.type === 'heading' && (
              <div className="flex gap-2">
                <select
                  aria-label="Heading level"
                  className="input w-20"
                  value={b.level}
                  onChange={(e) => update(b.id, { level: Number(e.target.value) as 1 | 2 | 3 })}
                >
                  <option value={1}>H1</option>
                  <option value={2}>H2</option>
                  <option value={3}>H3</option>
                </select>
                <input
                  aria-label="Heading text"
                  className="input"
                  value={b.text}
                  maxLength={200}
                  onChange={(e) => update(b.id, { text: e.target.value })}
                />
              </div>
            )}
            {b.type === 'text' && (
              <textarea
                aria-label="Text"
                className="input"
                rows={4}
                value={b.text}
                maxLength={20000}
                onChange={(e) => update(b.id, { text: e.target.value })}
              />
            )}
            {b.type === 'service' && (
              <div className="grid gap-2 sm:grid-cols-[1fr_90px_160px]">
                <Field label="Service">
                  <input className="input" value={b.name} maxLength={200} onChange={(e) => update(b.id, { name: e.target.value })} />
                </Field>
                <Field label="Qty">
                  <NumberInput
                    step="any"
                    className="text-right"
                    value={b.quantity}
                    onChange={(e) => update(b.id, { quantity: Number(e.target.value) || 0 })}
                  />
                </Field>
                <Field label="Unit price">
                  <MoneyInput value={b.unitPrice} currency={b.currency} onChange={(v) => update(b.id, { unitPrice: v ?? 0 })} />
                </Field>
                <Field label="Description" className="sm:col-span-3">
                  <textarea
                    className="input min-h-9"
                    rows={2}
                    value={b.description}
                    maxLength={5000}
                    onChange={(e) => update(b.id, { description: e.target.value })}
                  />
                </Field>
              </div>
            )}
            {b.type === 'question' && (
              <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
                <input
                  aria-label="Question"
                  className="input"
                  placeholder="What is your launch date?"
                  value={b.label}
                  maxLength={200}
                  onChange={(e) => update(b.id, { label: e.target.value })}
                />
                <select
                  aria-label="Answer type"
                  className="input"
                  value={b.questionType}
                  onChange={(e) => update(b.id, { questionType: e.target.value as 'short' | 'long' | 'choice' })}
                >
                  <option value="short">Short answer</option>
                  <option value="long">Long answer</option>
                  <option value="choice">Choice</option>
                </select>
                {b.questionType === 'choice' && (
                  <textarea
                    aria-label="Options, one per line"
                    className="input sm:col-span-2"
                    rows={3}
                    placeholder="One option per line"
                    value={b.options.join('\n')}
                    onChange={(e) => update(b.id, { options: e.target.value.split('\n') })}
                  />
                )}
                <label className="flex items-center gap-2 text-sm text-mute">
                  <input type="checkbox" checked={b.required} onChange={(e) => update(b.id, { required: e.target.checked })} /> Required
                </label>
              </div>
            )}
            {b.type === 'signature' && (
              <input
                aria-label="Signature label"
                className="input"
                value={b.label}
                maxLength={200}
                onChange={(e) => update(b.id, { label: e.target.value })}
              />
            )}
            {errors[b.id] && <p className="mt-1 text-xs text-danger">{errors[b.id]}</p>}
          </div>
        );
      })}
      <Menu
        align="left"
        trigger={(open) => (
          <Button variant="soft" size="sm" onClick={open} disabled={blocks.length >= 100}>
            <Plus className="h-3.5 w-3.5" /> Add block
          </Button>
        )}
        items={(Object.keys(LABEL) as Block['type'][]).map((t) => {
          const Icon = ICON[t];
          return { label: LABEL[t], icon: <Icon className="h-4 w-4" />, onSelect: () => add(t) };
        })}
      />
    </div>
  );
}

/** Strips empty choice options before sending to the API. */
export const cleanBlocks = (blocks: Block[]) =>
  blocks.map((b) =>
    b.type === 'question'
      ? {
          ...b,
          options: b.questionType === 'choice' ? b.options.map((o) => o.trim()).filter(Boolean) : [],
        }
      : b,
  );
