/** Mentions are stored inline as @[Display Name](user:<uuid>). */
export const MENTION_PATTERN = /@\[([^\]\n]{1,120})\]\(user:([0-9a-f-]{36})\)/gi;

export function mentionIds(text: string) {
  return [...new Set([...text.matchAll(MENTION_PATTERN)].map((m) => m[2]!.toLowerCase()))];
}

export function plainMentions(text: string) {
  return text.replace(MENTION_PATTERN, (_m, name: string) => `@${name}`);
}
