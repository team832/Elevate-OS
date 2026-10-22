import { describe, expect, it } from 'vitest';
import { safeRelativePath } from '../src/index';

describe('safeRelativePath (post-sign-in redirects)', () => {
  it.each([
    ['/ops/students?x=1', '/ops/students?x=1'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/\t/evil.example', '/'],
    ['/\n/evil.example', '/'],
    ['/ops\\..\\x', '/'],
    ['https://evil.example', '/'],
    ['ops', '/'],
    [undefined, '/'],
  ])('%j → %j', (input, expected) => {
    expect(safeRelativePath(input, '/')).toBe(expected);
  });
});
