/** scripts/validation/secret-scan.mjs on a temp folder: secrets under quoted keys (JSON) are found too. */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

const REPO = path.resolve(import.meta.dirname, '../../../..');
// Made at run time, so this file holds no secret-looking value itself.
const value = `Q7${randomBytes(24).toString('hex')}`;

it.each([
  ['an unquoted key', 'a.env.txt', `SESSION_SECRET="${value}"`, true],
  ['a Google OAuth client file', 'client.json', `{"web":{"client_secret":"${value}"}}`, true],
  ['a quoted key in code', 'b.js', `const c = { 'SESSION_SECRET': '${value}' };`, true],
  ['a JSON password', 'd.json', `{ "password": "${value}" }`, true],
  ['a test-only placeholder', 'e.json', `{ "password": "test-only-${value}" }`, false],
])('%s (%s)', (_name, file, text, found) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'secret-scan-'));
  try {
    writeFileSync(path.join(dir, file), `${text}\n`);
    const r = spawnSync(process.execPath, ['scripts/validation/secret-scan.mjs', '--path', dir], {
      cwd: REPO,
      encoding: 'utf8',
    });
    expect(r.status).toBe(found ? 1 : 0);
    expect(r.stdout + r.stderr).not.toContain(value);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
