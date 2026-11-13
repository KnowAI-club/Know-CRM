'use client';
import { useParams } from 'next/navigation';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { ErrorBox, Spinner } from '@/components/ui';
import { SequenceEditor } from '@/components/nurtures/SequenceEditor';
import type { Sequence } from '@/components/nurtures/types';

export default function EditSequencePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useLoad((s) => get<Sequence>(`/nurtures/sequences/${id}`, s), [id]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Spinner />;
  return <SequenceEditor key={data.id} initial={data} />;
}
