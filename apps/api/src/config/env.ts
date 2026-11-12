import { z } from 'zod';
import path from 'node:path';

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(4010),
  APP_ORIGIN: z.string().url().default('http://127.0.0.1:3010'),
  COOKIE_SECURE: bool(false),
  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SCHEMA: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,62}$/)
    .default('public'),
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
  MAIL_ENABLED: bool(true),
  SMTP_HOST: z.string().default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().default(1030),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Know CRM <no-reply@know-crm.local>'),
  WORKER_ENABLED: bool(true),
  WORKER_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(60),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
    console.warn('[config] COOKIE_SECURE=false in production; enable it behind HTTPS.');
  }
  return env;
}

export const env = load();

/** Absolute storage directory (relative paths resolve from the repository root). */
export const storageRoot = path.resolve(
  path.isAbsolute(env.STORAGE_DIR)
    ? env.STORAGE_DIR
    : path.join(import.meta.dirname, '../../../..', env.STORAGE_DIR),
);
