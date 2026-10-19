import { describe, expect, it } from 'vitest';
import { MODULES } from '@elevate/shared-types';
import { MODULE, modulePath } from '../../src/domain';

describe('Academic OS domain skeleton', () => {
  it('uses the basePath from D-004', () => {
    expect(MODULE.basePath).toBe(MODULES['academic'].basePath);
  });
  it('builds in-module paths', () => {
    expect(modulePath()).toBe('/academic');
    expect(modulePath('/a/b/')).toBe('/academic/a/b');
  });
});
