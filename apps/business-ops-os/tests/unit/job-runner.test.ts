/** The runner keeps ticking whatever a tick does (REV-3 M5), and starts once per process. */
import { afterEach, expect, it, vi } from 'vitest';
import { getDb } from '@elevate/database';
import { startJobRunner } from '../../src/server/job-runner';

vi.mock('@elevate/database', async (load) => ({
  ...(await load<typeof import('@elevate/database')>()),
  getDb: vi.fn(() => {
    throw new Error('DATABASE_URL must start with postgres://, postgresql:// or pglite://');
  }),
}));

afterEach(() => vi.useRealTimers());

it('schedules the next tick even when a tick throws at once (bad DATABASE_URL)', async () => {
  vi.useFakeTimers();
  startJobRunner();
  startJobRunner();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(getDb).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(70_000);
  expect(getDb).toHaveBeenCalledTimes(2);
});
