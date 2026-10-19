import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'shared-types',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
