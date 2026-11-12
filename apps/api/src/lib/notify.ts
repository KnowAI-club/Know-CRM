import { many, one, query } from '../db/pool.js';
import { mentionIds, plainMentions } from '@know-crm/shared';

export interface NotifyInput {
  userId: string | null | undefined;
  title: string;
  body?: string;
  link?: string;
  kind?: string;
}

/** In-app notification honouring each user's per-kind preference. */
export async function notify({ userId, title, body = '', link = '', kind = 'general' }: NotifyInput) {
  if (!userId) return;
  const muted = await one(
    'SELECT 1 FROM notification_preferences WHERE user_id=$1 AND kind=$2 AND in_app=false',
    [userId, kind],
  );
  if (muted) return;
  await query(
    'INSERT INTO notifications(user_id,kind,title,body,link) VALUES($1,$2,$3,$4,$5)',
    [userId, kind, title.slice(0, 300), body.slice(0, 2000), link.startsWith('/') ? link : ''],
  );
}

/** Notifies teammates newly @mentioned in `after` (compared with `before`). */
export async function notifyMentions(opts: {
  author: { id: string; name: string };
  before?: string;
  after: string;
  where: string;
  link: string;
}) {
  const previous = new Set(mentionIds(opts.before ?? ''));
  const ids = mentionIds(opts.after).filter((id) => !previous.has(id) && id !== opts.author.id);
  if (!ids.length) return;
  const users = await many<{ id: string }>(
    `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND role <> 'client' AND disabled_at IS NULL`,
    [ids],
  );
  for (const u of users)
    await notify({
      userId: u.id,
      kind: 'mention',
      title: `${opts.author.name} mentioned you in ${opts.where}`,
      body: plainMentions(opts.after).slice(0, 300),
      link: opts.link,
    });
}
