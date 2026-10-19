import { describe, expect, it } from 'vitest';
import { MODULES } from '@elevate/shared-types';
import { MODULE, modulePath } from '../../src/domain';

describe('Marketing OS domain skeleton', () => {
  it('uses the basePath from D-004', () => {
    expect(MODULE.basePath).toBe(MODULES['marketing'].basePath);
  });
  it('builds in-module paths', () => {
    expect(modulePath()).toBe('/marketing');
    expect(modulePath('/a/b/')).toBe('/marketing/a/b');
  });
});
