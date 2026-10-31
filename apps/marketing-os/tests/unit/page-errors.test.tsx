import { expect, it } from 'vitest';
import { Section } from '../../src/ui/shell';

it('a value PostgreSQL refuses (?q=%00) shows its message (API-001)', async () => {
  const view = await Section({
    load: async () => {
      throw Object.assign(new Error('pg'), { code: '22021' });
    },
  });
  expect(view.props.description).toContain('not valid');
});
