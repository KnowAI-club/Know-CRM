import type { NextConfig } from 'next';
import { existsSync } from 'node:fs';

const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const api = process.env.API_INTERNAL_URL || 'http://127.0.0.1:4010';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@know-crm/shared'],
  // The browser always talks to the same origin; Next proxies API calls to Express.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};

export default config;
