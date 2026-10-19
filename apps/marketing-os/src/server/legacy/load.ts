/**
 * Read the legacy extracts from data/legacy/marketing (repository root). Node I/O lives
 * here, outside the domain layer. Used by the seed and by tests.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LegacyMarketingData } from './types';

export function findLegacyMarketingDir(
  start = path.dirname(fileURLToPath(import.meta.url)),
): string {
  let dir = start;
  for (;;) {
    const candidate = path.join(dir, 'data', 'legacy', 'marketing');
    if (existsSync(path.join(candidate, 'accounts.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('data/legacy/marketing not found above ' + start);
    dir = parent;
  }
}

export function loadLegacyMarketingData(dir = findLegacyMarketingDir()): LegacyMarketingData {
  const read = <T>(name: string): T => JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as T;
  return {
    accounts: read('accounts.json'),
    rules: read('content-rules.json'),
    ideas: read('ideas.json'),
    placements: read('placements.json'),
    postAudit: read('post-audit.json'),
  };
}
