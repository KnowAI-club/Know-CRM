'use client';
import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { post } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Avatar, Button, Empty, useToast } from '@/components/ui';
import type { Message } from './types';

/** Admin ↔ client conversation for one project. `side` decides which bubbles align right. */
export function MessageThread({
  projectId,
  messages,
  onChange,
  side,
  emptyText = 'No messages yet.',
}: {
  projectId: string;
  messages: Message[];
  onChange: (m: Message[]) => void;
  side: 'team' | 'client';
  emptyText?: string;
}) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  const send = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const m = await post<Message>(`/projects/${projectId}/messages`, { body: text });
      onChange([...messages, m]);
      setBody('');
    } catch (e) {
      toast.error(e);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="max-h-[55vh] min-h-40 space-y-3 overflow-y-auto p-4">
        {!messages.length ? (
          <Empty title="No messages" description={emptyText} />
        ) : (
          messages.map((m) => {
            const mine = side === 'client' ? m.author_role === 'client' : m.author_role !== 'client';
            return (
              <div key={m.id} className={cn('flex items-end gap-2', mine && 'flex-row-reverse')}>
                <Avatar name={m.author_name} size="sm" />
                <div
                  className={cn(
                    'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
                    mine ? 'rounded-br-md bg-acc text-acc-ink' : 'rounded-bl-md bg-subtle',
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={cn('mt-1 text-[11px]', mine ? 'text-acc-ink/70' : 'text-faint')}>
                    {m.author_name} · {dateTime(m.created_at)}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={end} />
      </div>
      <div className="flex items-end gap-2 border-t border-line p-3">
        <textarea
          className="input min-h-10 flex-1 resize-y"
          rows={2}
          value={body}
          maxLength={20000}
          placeholder="Write a message… (Ctrl/Cmd + Enter to send)"
          aria-label="Message"
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button onClick={send} loading={sending} disabled={!body.trim()} aria-label="Send message">
          <Send className="h-4 w-4" /> Send
        </Button>
      </div>
    </div>
  );
}
