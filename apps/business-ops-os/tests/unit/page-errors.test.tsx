import { expect, it, vi } from 'vitest';
import { load } from '../../src/ui/frame';

it('a value PostgreSQL refuses (?q=%00) shows its message and logs no error (API-001)', async () => {
  const log = vi.spyOn(console, 'error');
  const r = await load(async () => {
    throw Object.assign(new Error('pg'), { code: '22021' });
  });
  expect(r.ok).toBe(false);
  expect(log).not.toHaveBeenCalled();
});
