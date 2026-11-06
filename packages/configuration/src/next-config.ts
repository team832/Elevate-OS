import type { NextConfig } from 'next';
import { findRepoRoot, loadRootEnv } from './load-root-env';
import { securityHeaders } from './security-headers';
import { appOrigin } from './workspaces';

const SHARED_PACKAGES = [
  'authentication',
  'authorization',
  'configuration',
  'database',
  'notifications',
  'server-kit',
  'shared-contracts',
  'shared-types',
  'shared-ui',
].map((name) => `@elevate/${name}`);

/**
 * The next.config of all four apps (Next loads it through its next.config.ts require hook, so it
 * imports only node built-ins and these files). A module zone passes its basePath; the platform
 * passes none. `transpilePackages` and `experimental` add to the shared ones; anything else replaces.
 */
export function zoneConfig({
  basePath,
  transpilePackages = [],
  experimental,
  ...own
}: NextConfig & { env: { ELEVATE_BASE_PATH: string } }): NextConfig {
  const repoRoot = findRepoRoot() ?? process.cwd();
  // All apps read the ONE root .env, before anything below reads the environment; values already set
  // win. (@next/env cannot be used here: Next has already loaded the app directory and caches that result.)
  loadRootEnv(repoRoot);
  return {
    // Only `npm run release:package` sets this; dev, office and next start keep the normal output.
    ...(process.env.ELEVATE_RELEASE_STANDALONE ? { output: 'standalone' as const } : {}),
    ...(basePath
      ? {
          // On its own workspace origin (D-072) and behind the platform's rewrite.
          basePath,
          // The workspace origin's root opens the workspace (outside the basePath, so basePath: false).
          async redirects() {
            return [
              { source: '/', destination: basePath, basePath: false as const, permanent: false },
            ];
          },
        }
      : {}),
    reactStrictMode: true,
    poweredByHeader: false,
    // Static security headers on every response; the per-request CSP is set in each app's src/proxy.ts.
    async headers() {
      return [{ source: '/:path*', headers: securityHeaders() }];
    },
    turbopack: { root: repoRoot },
    outputFileTracingRoot: repoRoot,
    transpilePackages: [...SHARED_PACKAGES, ...transpilePackages],
    serverExternalPackages: ['@electric-sql/pglite', 'pg'],
    ...own,
    experimental: {
      // https://nextjs.org/docs/app/guides/memory-usage: a smaller webpack heap; next start loads
      // each page on its first request instead of all at start.
      webpackMemoryOptimizations: true,
      preloadEntriesOnStart: false,
      ...experimental,
      // The browser-facing platform origin (D-004), for Server Actions arriving through its rewrites.
      ...(basePath
        ? {
            serverActions: {
              allowedOrigins: [new URL(appOrigin('platform')).host],
              ...experimental?.serverActions,
            },
          }
        : {}),
    },
  };
}
