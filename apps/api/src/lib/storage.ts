import { mkdir, writeFile, readFile, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { storageRoot } from '../config/env.js';

/**
 * Local disk object storage. Keys are generated server-side (never from user input)
 * so they cannot escape the storage root.
 */
function resolveKey(key: string) {
  if (!/^[a-z0-9-]+\/[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid storage key');
  return path.join(storageRoot, key);
}

export async function putObject(prefix: string, data: Buffer) {
  const key = `${prefix}/${randomUUID()}`;
  const file = resolveKey(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data, { flag: 'wx' });
  return key;
}

export const readObject = (key: string) => readFile(resolveKey(key));
export const streamObject = (key: string) => createReadStream(resolveKey(key));
export const objectExists = (key: string) =>
  stat(resolveKey(key)).then(
    () => true,
    () => false,
  );
export async function deleteObject(key: string) {
  await unlink(resolveKey(key)).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
  });
}
