import { defineProject } from 'vitest/config';
import { sharedTest } from '../../vitest.shared.ts';

export default defineProject({
  test: { ...sharedTest, name: 'database' },
});
