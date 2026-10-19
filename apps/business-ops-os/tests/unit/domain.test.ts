import { describe, expect, it } from 'vitest';
import { MODULES } from '@elevate/shared-types';
import { MODULE, modulePath } from '../../src/domain';

describe('Business Ops OS domain skeleton', () => {
  it('uses the basePath from D-004', () => {
    expect(MODULE.basePath).toBe(MODULES['ops'].basePath);
  });
  it('builds in-module paths', () => {
    expect(modulePath()).toBe('/ops');
    expect(modulePath('/a/b/')).toBe('/ops/a/b');
  });
});
