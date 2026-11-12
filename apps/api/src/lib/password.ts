import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const digest = await scryptAsync(password, salt, 64);
  return `${salt}:${digest.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(':');
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = await scryptAsync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Used to keep login timing constant when the email is unknown. */
export const dummyHash = `${'0'.repeat(32)}:${'0'.repeat(128)}`;

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
