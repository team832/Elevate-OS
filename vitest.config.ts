import { defineConfig } from 'vitest/config';

/**
 * Root test runner: one vitest project per workspace (each has its own
 * vitest.config.ts built from vitest.shared.ts). `npm test` runs them all;
 * `npx vitest run --project database` runs one.
 */
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
  },
});
