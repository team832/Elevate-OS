import { expect, it, vi } from 'vitest';
import { LoadError } from '../../src/ui/shell';

it('a value PostgreSQL refuses (?q=%00) shows its message and logs no error (API-001)', () => {
  const log = vi.spyOn(console, 'error');
  const view = LoadError({ error: Object.assign(new Error('pg'), { code: '22021' }) });
  expect(view.props.description).toContain('not valid');
  expect(log).not.toHaveBeenCalled();
});
