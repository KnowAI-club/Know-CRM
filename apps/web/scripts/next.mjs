// Starts Next.js with the repository-root .env loaded and the configured port.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const rootEnv = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const mode = process.argv[2] === 'start' ? 'start' : 'dev';
const port = process.env.WEB_PORT || '3010';
// Run Next's CLI with the current node binary: spawning `npx` fails on Windows (npx.cmd needs a shell).
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, mode, '-p', port, '-H', '127.0.0.1'], {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code) => process.exit(code ?? 0));
