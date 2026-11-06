/** Background jobs (D-133): every job starts off, and a job is due once per slot of its interval. */
import { describe, expect, it } from 'vitest';
import { jobSlot, resolveSettings, validateSettingChange } from '../../src/domain';
import { OPS_JOBS } from '../../src/server/schemas';

const at = (iso: string) => new Date(iso);

describe('job settings', () => {
  it.each(OPS_JOBS)('%s is off by default and Proposed', (job) => {
    const s = resolveSettings([])[`jobs.${job}`];
    expect(s.value.enabled).toBe(false);
    expect(s.value.everyMinutes).toBeGreaterThanOrEqual(5);
    expect(s.decisionState).toBe('proposed');
  });

  // Only intervals that divide a day, so runs fall at the same IST times every day (REV-3 M3).
  it.each([
    [5, true],
    [7, false],
    [10, true],
    [45, false],
    [180, true],
    [1440, true],
    [2880, false],
    [10_080, false],
  ])('every %i minutes is accepted: %s', (everyMinutes, ok) => {
    const r = validateSettingChange('jobs.housekeeping', { enabled: true, everyMinutes });
    expect(r.ok).toBe(ok);
    if (!r.ok) expect(r.message).toMatch(/^Every \(minutes\) must be one of 5, 10/);
  });
});

describe('due or not (jobSlot)', () => {
  // A job that last ran at `last` is due again at `now` when the two fall in different slots.
  it.each([
    ['2026-11-06T04:30:00Z', '2026-11-06T04:59:59Z', 60, false], // 10:00–10:29 IST, same hour
    ['2026-11-06T04:30:00Z', '2026-11-06T05:00:00Z', 60, false], // 10:00 → 10:30 IST: still the 10:00 slot
    ['2026-11-06T04:30:00Z', '2026-11-06T05:30:00Z', 60, true], // 11:00 IST
    ['2026-11-06T04:31:00Z', '2026-11-06T04:44:59Z', 15, false],
    ['2026-11-06T04:31:00Z', '2026-11-06T04:45:00Z', 15, true],
    ['2026-11-05T18:29:00Z', '2026-11-05T18:30:00Z', 1440, true], // 23:59 → 00:00 IST: a new day
    ['2026-11-05T18:30:00Z', '2026-11-06T18:29:59Z', 1440, false], // the whole IST day is one slot
  ])('last %s, now %s, every %i min → due %s', (last, now, every, due) => {
    expect(jobSlot(at(now), every).getTime() !== jobSlot(at(last), every).getTime()).toBe(due);
  });

  it('a daily slot starts at midnight IST', () => {
    expect(jobSlot(at('2026-11-06T10:00:00Z'), 1440).toISOString()).toBe(
      '2026-11-05T18:30:00.000Z',
    );
  });
});
