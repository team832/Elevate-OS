import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Find the monorepo root: the nearest ancestor whose package.json declares
 * `workspaces`. Returns undefined when not inside the repo.
 */
export function findRepoRoot(start: string = process.cwd()): string | undefined {
  let dir = path.resolve(start);
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const json = JSON.parse(readFileSync(pkg, 'utf8')) as { workspaces?: unknown };
        if (json.workspaces) return dir;
      } catch {
        // unreadable package.json — keep walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Load `<repo root>/.env` into `process.env` for scripts (Next.js apps load it
 * through `@next/env` in next.config.ts). Variables that are already set are
 * never overwritten. Returns the file path loaded, or undefined.
 */
export function loadRootEnv(start?: string): string | undefined {
  const root = findRepoRoot(start);
  if (!root) return undefined;
  const file = path.join(root, '.env');
  if (!existsSync(file)) return undefined;
  const parsed = parseEnv(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
  }
  return file;
}
