'use client';
import { useEffect, useState } from 'react';
import { post } from '@/lib/api';
import { Button, Field, Modal, useToast } from '@/components/ui';

const REASONS = ['No response after sequence', 'Not a fit', 'Asked not to be contacted', 'Bounced email', 'Went with someone else'];

/** Moves one or more parked nurture leads to Discard with a reason. */
export function DiscardModal({ leads, onClose, onDone }: { leads: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setReason('');
    setError('');
  }, [leads]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return setError('Add a reason.');
    setSaving(true);
    let done = 0;
    try {
      for (const l of leads) {
        await post(`/nurtures/leads/${l.id}/discard`, { reason: reason.trim() });
        done++;
      }
      toast.success(done === 1 ? `${leads[0]!.name} moved to Discard.` : `${done} leads moved to Discard.`);
      onDone();
    } catch (err) {
      toast.error(err);
      if (done) onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={leads.length > 0}
      onClose={onClose}
      size="sm"
      title={leads.length === 1 ? `Discard ${leads[0]!.name}?` : `Discard ${leads.length} leads?`}
      description="Discarded leads leave any sequence and can be restored later."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" type="submit" form="discard-form" loading={saving}>
            Discard
          </Button>
        </>
      }
    >
      <form id="discard-form" onSubmit={submit} className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className="rounded-full border border-line px-2.5 py-1 text-xs text-mute hover:border-acc hover:text-acc"
            >
              {r}
            </button>
          ))}
        </div>
        <Field label="Reason" required error={error}>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
        </Field>
      </form>
    </Modal>
  );
}
