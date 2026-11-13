'use client';
import { useEffect, useState } from 'react';
import { post } from '@/lib/api';
import { Button, Modal, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { SequenceSummary } from './types';

/** Starts a nurture sequence for one or more parked leads. */
export function AssignModal({
  leadIds,
  sequences,
  onClose,
  onDone,
}: {
  leadIds: string[];
  sequences: SequenceSummary[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const active = sequences.filter((s) => s.status === 'active');
  const [sequenceId, setSequenceId] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setSequenceId(''), [leadIds]);

  const submit = async () => {
    if (!sequenceId) return;
    setSaving(true);
    try {
      await post('/nurtures/assignments', leadIds.length === 1 ? { leadId: leadIds[0], sequenceId } : { leadIds, sequenceId });
      toast.success(leadIds.length === 1 ? 'Sequence started.' : `${leadIds.length} leads added to the sequence.`);
      onDone();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={leadIds.length > 0}
      onClose={onClose}
      title={leadIds.length === 1 ? 'Start a sequence' : `Add ${leadIds.length} leads to a sequence`}
      description="Emails are not sent automatically — each one shows up as due so you can send it and mark it sent."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!sequenceId} loading={saving}>
            Start sequence
          </Button>
        </>
      }
    >
      {active.length === 0 ? (
        <p className="text-sm text-mute">There are no active sequences. Create one or switch a draft to active first.</p>
      ) : (
        <div className="space-y-2" role="radiogroup">
          {active.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={sequenceId === s.id}
              onClick={() => setSequenceId(s.id)}
              className={cn(
                'w-full rounded-xl border p-3 text-left transition',
                sequenceId === s.id ? 'border-acc bg-acc-soft' : 'border-line hover:border-acc/50',
              )}
            >
              <p className="text-sm font-medium">{s.name}</p>
              <p className="text-xs text-mute">
                {s.email_count !== undefined && `${s.email_count} emails · `}
                {s.description}
              </p>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
