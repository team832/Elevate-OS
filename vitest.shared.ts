/**
 * Settings every vitest project shares. Import into a workspace's
 * vitest.config.ts:  test: { ...sharedTest, name: 'my-project' }
 *
 * The env values are TEST-ONLY fixtures (not secrets): tests run against an
 * in-memory PGlite and never reach a real database or service.
 */
export const sharedTest = {
  environment: 'node' as const,
  include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  testTimeout: 30_000,
  hookTimeout: 60_000,
  env: {
    NODE_ENV: 'test' as const,
    LOG_LEVEL: 'error',
    DATABASE_URL: 'pglite://memory',
    SESSION_SECRET: 'test-only-session-secret-for-vitest-runs-0001',
    INTERNAL_SERVICE_TOKEN: 'test-only-internal-token-for-vitest-runs-0001',
  },
};
