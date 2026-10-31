import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '../src/load-root-env';

const root = findRepoRoot()!;
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const manifests = [
  'package.json',
  ...['apps', 'packages'].flatMap((dir) =>
    readdirSync(path.join(root, dir)).map((name) => `${dir}/${name}/package.json`),
  ),
];
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

const looseDeps = (manifest: Record<string, Record<string, string>>) =>
  FIELDS.flatMap((field) =>
    Object.entries(manifest[field] ?? {})
      // npm always links an @elevate workspace package locally, so its "*" cannot float.
      .filter(([name, v]) => !EXACT.test(v) && !(name.startsWith('@elevate/') && v === '*'))
      .map(([name, v]) => `${name}@${v}`),
  );

describe('versions are fixed', () => {
  it('the check catches a range, a tag and a floating outside package', () => {
    expect(
      looseDeps({
        dependencies: { a: '^1.0.0', b: '1.0.0', '@elevate/x': '*', '@other/x': '*' },
        devDependencies: { c: 'latest' },
      }),
    ).toEqual(['a@^1.0.0', '@other/x@*', 'c@latest']);
  });

  it.each(manifests)('%s pins every dependency', (file) => {
    expect(looseDeps(JSON.parse(read(file)))).toEqual([]);
  });

  it('.nvmrc and packageManager name exact versions', () => {
    expect(read('.nvmrc').trim()).toMatch(EXACT);
    expect(JSON.parse(read('package.json')).packageManager).toMatch(/^npm@\d+\.\d+\.\d+$/);
  });
});
