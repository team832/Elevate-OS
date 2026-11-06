import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NextConfig } from 'next';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { findRepoRoot } from '../src/load-root-env';

const root = findRepoRoot()!;
// A throwaway repo whose .env sets every value the configs read: the same result on any machine,
// and proof that the .env is read before those values are used.
const repo = mkdtempSync(path.join(tmpdir(), 'zone-config-'));
const DOTENV = {
  PLATFORM_URL: 'http://platform.test:4003',
  BUSINESS_OPS_OS_URL: 'http://ops.test:4000',
  ACADEMIC_OS_URL: 'http://academic.test:4001',
  MARKETING_OS_URL: 'http://marketing.test:4002',
  ELEVATE_RELEASE_STANDALONE: '1',
};
writeFileSync(path.join(repo, 'package.json'), '{"workspaces":[]}');
writeFileSync(
  path.join(repo, '.env'),
  Object.entries(DOTENV)
    .map((pair) => pair.join('='))
    .join('\n'),
);

/** An app's config as plain data: its functions called, the repo path made portable. */
async function load(app: string, release: boolean) {
  for (const key of Object.keys(DOTENV)) vi.stubEnv(key, undefined);
  // A variable already set (even blank) wins over the .env.
  if (!release) vi.stubEnv('ELEVATE_RELEASE_STANDALONE', '');
  vi.spyOn(process, 'cwd').mockReturnValue(repo);
  vi.resetModules();
  const url = pathToFileURL(path.join(root, 'apps', app, 'next.config.ts')).href;
  const { headers, redirects, rewrites, ...config } = (
    (await import(url)) as { default: NextConfig }
  ).default;
  vi.restoreAllMocks();
  const plain = {
    ...config,
    // Next reads it as a set.
    transpilePackages: config.transpilePackages?.toSorted(),
    headers: await headers?.(),
    redirects: await redirects?.(),
    rewrites: await rewrites?.(),
  };
  return JSON.parse(JSON.stringify(plain).replaceAll(JSON.stringify(repo).slice(1, -1), '<repo>'));
}

const cases = ['business-ops-os', 'academic-os', 'marketing-os', 'platform'].flatMap((app) =>
  [true, false].map((release) => [app, release] as const),
);
/** The four configs as they were before the shared zoneConfig(), captured by this same load(). */
const OLD = JSON.parse(readFileSync(new URL('./next-config.old.json', import.meta.url), 'utf8'));
// The only change: Next's memory-usage guide, https://nextjs.org/docs/app/guides/memory-usage
const ADDED = { webpackMemoryOptimizations: true, preloadEntriesOnStart: false };

afterEach(() => vi.unstubAllEnvs());
afterAll(() => rmSync(repo, { recursive: true }));

it.each(cases)(
  'apps/%s (release %s) keeps its old config, plus the memory flags',
  async (app, release) => {
    const old = OLD[`${app}${release ? ' release' : ''}`];
    expect(await load(app, release)).toEqual({
      ...old,
      experimental: { ...old.experimental, ...ADDED },
    });
  },
);
