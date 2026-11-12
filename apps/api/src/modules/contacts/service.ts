import { z } from 'zod';
import { GSTIN_PATTERN } from '@know-crm/shared';
import { one, query, transaction } from '../../db/pool.js';
import { badRequest } from '../../lib/errors.js';

export const ORIGINS = ['Website', 'Manual'] as const;
export type Origin = (typeof ORIGINS)[number];

const hasOrigin = (tags: string[]) => tags.some((t) => ORIGINS.some((o) => o.toLowerCase() === t.toLowerCase()));

/** Every contact carries exactly one origin tag (Website or Manual). */
export function withOrigin(tags: string[], origin: Origin) {
  if (hasOrigin(tags) || tags.length >= 20) return tags;
  return [origin, ...tags];
}

const optEmail = z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email').max(254)]).default('');
const txt = (max: number) => z.string().trim().max(max).default('');

export const contactSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(500),
  email: optEmail,
  company: txt(500),
  phone: txt(40),
  jobTitle: txt(200),
  website: z.union([z.literal(''), z.string().trim().url('Enter a full link starting with https://').max(500)]).default(''),
  address: txt(1000),
  tags: z
    .array(z.string().trim().min(1).max(40))
    .max(20, 'Use 20 tags or fewer')
    .default([])
    .transform((tags) => {
      const seen = new Set<string>();
      return tags.filter((t) => (seen.has(t.toLowerCase()) ? false : (seen.add(t.toLowerCase()), true)));
    }),
  businessName: txt(500),
  businessEmail: optEmail,
  personalEmail: optEmail,
  pocName: txt(500),
  pocRole: txt(500),
  pocEmail: optEmail,
  pocPhone: txt(40),
  billingName: txt(500),
  billingEmail: optEmail,
  billingAddress: txt(1000),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .default('')
    .refine((v) => !v || GSTIN_PATTERN.test(v), 'Enter a valid 15-character GSTIN.'),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .default('')
    .refine((v) => !v || /^[A-Z]{5}\d{4}[A-Z]$/.test(v), 'Enter a valid PAN.'),
  alternatePhones: z.array(z.string().trim().min(1).max(40)).max(5).default([]),
});
export type ContactInput = z.infer<typeof contactSchema>;

/** GSTIN embeds the PAN; keep them consistent. */
export function normalizeTax<T extends { gstin?: string; pan?: string }>(c: T) {
  if (c.gstin) {
    const pan = c.gstin.slice(2, 12);
    if (c.pan && c.pan !== pan) throw badRequest('PAN must match the PAN in GSTIN.');
    c.pan = pan;
  }
  return c;
}

export const COLUMNS: Record<keyof ContactInput, string> = {
  name: 'name', email: 'email', company: 'company', phone: 'phone', jobTitle: 'job_title', website: 'website',
  address: 'address', tags: 'tags', businessName: 'business_name', businessEmail: 'business_email',
  personalEmail: 'personal_email', pocName: 'poc_name', pocRole: 'poc_role', pocEmail: 'poc_email',
  pocPhone: 'poc_phone', billingName: 'billing_name', billingEmail: 'billing_email',
  billingAddress: 'billing_address', gstin: 'gstin', pan: 'pan', alternatePhones: 'alternate_phones',
};

export async function insertContact(c: ContactInput) {
  const keys = Object.keys(COLUMNS) as (keyof ContactInput)[];
  return (await one(
    `INSERT INTO contacts(${keys.map((k) => COLUMNS[k]).join(',')}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
    keys.map((k) => c[k]),
  ))!;
}

/**
 * Finds a contact by email or creates one. Never overwrites existing data:
 * only blank company/phone/website are filled and a missing origin tag added.
 */
export async function ensureContact(
  details: { name?: string; email: string; company?: string; phone?: string; website?: string },
  origin: Origin,
) {
  return transaction(async () => {
    const email = details.email.trim().toLowerCase();
    await query('SELECT pg_advisory_xact_lock(hashtext($1))', [`contact:${email}`]);
    const existing = await one(
      'SELECT * FROM contacts WHERE lower(email)=$1 ORDER BY created_at LIMIT 1',
      [email],
    );
    let website = (details.website ?? '').trim().split(/\s+/)[0] ?? '';
    if (website && !/^https?:\/\//.test(website)) website = `https://${website}`;
    if (website && !website.includes('.')) website = '';
    if (!existing) {
      return insertContact(
        contactSchema.parse({
          name: details.name?.trim() || email,
          email,
          company: details.company ?? '',
          phone: details.phone ?? '',
          website,
          tags: [origin],
        }),
      );
    }
    return (await one(
      `UPDATE contacts SET
         company = CASE WHEN company='' THEN $2 ELSE company END,
         phone = CASE WHEN phone='' THEN $3 ELSE phone END,
         website = CASE WHEN website='' THEN $4 ELSE website END,
         tags = $5, updated_at = now()
       WHERE id=$1 RETURNING *`,
      [existing.id, details.company ?? '', details.phone ?? '', website, withOrigin(existing.tags, origin)],
    ))!;
  });
}
