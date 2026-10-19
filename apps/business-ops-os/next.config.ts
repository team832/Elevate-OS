import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import type { NextConfig } from 'next';

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

/** The browser-facing platform origin (D-004), for Server Actions arriving through its rewrites. */
const platformHost = new URL(process.env.PLATFORM_URL || 'http://localhost:3000').host;

const nextConfig: NextConfig = {
  /** Business Ops OS lives under /ops — standalone on port 3003 and behind the platform's rewrite. */
  basePath: '/ops',
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  transpilePackages: [
    '@elevate/authentication',
    '@elevate/authorization',
    '@elevate/configuration',
    '@elevate/database',
    '@elevate/notifications',
    '@elevate/server-kit',
    '@elevate/shared-contracts',
    '@elevate/shared-types',
    '@elevate/shared-ui',
  ],
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  experimental: {
    serverActions: { allowedOrigins: [platformHost] },
  },
};

export default nextConfig;
