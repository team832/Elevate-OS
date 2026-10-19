/**
 * `npm run docs:permissions` — regenerate the role × permission matrix in
 * docs/SECURITY_AND_PERMISSIONS.md from @elevate/authorization.
 * `npm run docs:permissions -- --check` exits 1 when the document is stale
 * (run by the Integration wave; module teams change permissions in their own
 * file and Integration refreshes the doc).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MATRIX_BEGIN, MATRIX_END, renderPermissionMatrix } from '@elevate/authorization';
import { findRepoRoot } from '@elevate/configuration/node';

const root = findRepoRoot() ?? process.cwd();
const file = path.join(root, 'docs', 'SECURITY_AND_PERMISSIONS.md');
const text = readFileSync(file, 'utf8');
const start = text.indexOf(MATRIX_BEGIN);
const end = text.indexOf(MATRIX_END);
if (start === -1 || end === -1 || end < start) {
  console.error(`docs:permissions — markers not found in ${file}`);
  process.exit(1);
}
const updated = `${text.slice(0, start + MATRIX_BEGIN.length)}\n${renderPermissionMatrix()}\n${text.slice(end)}`;
if (process.argv.includes('--check')) {
  if (updated !== text) {
    console.error(
      'docs:permissions — docs/SECURITY_AND_PERMISSIONS.md is out of date; run npm run docs:permissions',
    );
    process.exit(1);
  }
  console.log('docs:permissions — matrix is up to date.');
} else {
  writeFileSync(file, updated);
  console.log('docs:permissions — matrix written to docs/SECURITY_AND_PERMISSIONS.md');
}
