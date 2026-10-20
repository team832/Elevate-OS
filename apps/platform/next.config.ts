import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import type { NextConfig } from 'next';
import { securityHeaders } from '@elevate/configuration/security-headers';

/** Walk up from the app directory to the workspace root (the package.json with "workspaces"). */
function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg) && 'workspaces' in JSON.parse(readFileSync(pkg, 'utf8'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

const repoRoot = findRepoRoot(process.cwd());
// All apps read the ONE root .env; values already in the environment win.
// (@next/env cannot be used here: Next has already loaded the app directory and caches that result.)
const rootEnvFile = path.join(repoRoot, '.env');
if (existsSync(rootEnvFile)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(rootEnvFile, 'utf8')))) {
    if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
  }
}

const zone = (name: string, fallback: string) => (process.env[name] || fallback).replace(/\/$/, '');
const marketing = zone('MARKETING_OS_URL', 'http://localhost:3001');
const academic = zone('ACADEMIC_OS_URL', 'http://localhost:3002');
const ops = zone('BUSINESS_OPS_OS_URL', 'http://localhost:3003');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Static security headers on every response; the per-request CSP is set in src/proxy.ts.
  async headers() {
    return [
      // Module zones are excluded: their own app sets these headers and its CSP (src/proxy.ts).
      { source: '/((?!marketing(?:/|$)|academic(?:/|$)|ops(?:/|$)).*)', headers: securityHeaders() },
    ];
  },
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  transpilePackages: [
    '@elevate/authentication',
    '@elevate/authorization',
    '@elevate/configuration',
    '@elevate/database',
    '@elevate/server-kit',
    '@elevate/shared-contracts',
    '@elevate/shared-types',
    '@elevate/shared-ui',
    '@elevate/notifications',
    // The overview reads the modules' server services with the signed-in user
    // (apps/platform/src/server/overview-adapter.ts); only their ./server entries are imported.
    '@elevate/business-ops-os',
    '@elevate/academic-os',
    '@elevate/marketing-os',
  ],
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  /**
   * Multi-zone routing (D-004): the platform serves `/`, and forwards each
   * module's base path to its own app. The browser stays on this origin, so
   * the `elevate_session` cookie reaches every zone. Rewrites are resolved at
   * build/start time from the *_OS_URL variables.
   */
  async rewrites() {
    return [
      { source: '/marketing', destination: `${marketing}/marketing` },
      { source: '/marketing/:path+', destination: `${marketing}/marketing/:path+` },
      { source: '/academic', destination: `${academic}/academic` },
      { source: '/academic/:path+', destination: `${academic}/academic/:path+` },
      { source: '/ops', destination: `${ops}/ops` },
      { source: '/ops/:path+', destination: `${ops}/ops/:path+` },
    ];
  },
};

export default nextConfig;
