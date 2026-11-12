import { z } from 'zod';
import { badRequest } from './errors.js';

/** Parses input with a zod schema, raising a 400 with field messages on failure. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    const first = result.error.issues[0];
    const label = first?.path.length ? `${first.path.join('.')}: ` : '';
    throw badRequest(`${label}${first?.message ?? 'Invalid input'}`, { fields });
  }
  return result.data;
}

/** Common reusable field schemas. */
export const zs = {
  id: z.coerce.number().int().positive(),
  text: (max = 500) => z.string().trim().max(max),
  required: (max = 500) => z.string().trim().min(1, 'Required').max(max),
  optionalText: (max = 500) =>
    z
      .string()
      .trim()
      .max(max)
      .optional()
      .nullable()
      .transform((v) => (v ? v : null)),
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
  optionalEmail: z
    .union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email').max(254)])
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  datetime: z.string().datetime({ offset: true }),
  money: z.coerce.number().min(0).max(1e12),
};

export const idParam = z.object({ id: zs.id });
