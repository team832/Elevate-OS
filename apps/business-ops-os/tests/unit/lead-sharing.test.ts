/** F4-16 pickCounsellor (pure; REV-W4 probes adopted): turn order, skips, caps, fewest open. */
import { describe, expect, it } from 'vitest';
import { pickCounsellor, type SharingCounsellor } from '../../src/domain/lead-sharing';

const staff = (e: Record<string, readonly [active: boolean, today: number, open: number]>) =>
  new Map<string, SharingCounsellor>(
    Object.entries(e).map(([id, [active, today, open]]) => [id, { active, today, open }]),
  );
const rule = (
  mode: 'round_robin' | 'fewest_open',
  ids: string[],
  last: string | null,
  cap: number | null = null,
) => ({
  mode,
  counsellorStaffIds: ids,
  lastAssignedStaffId: last,
  dailyCap: cap,
});
const free = { a: [true, 0, 0], b: [true, 0, 0], c: [true, 0, 0] } as const;

describe('pickCounsellor', () => {
  it.each([
    [
      'round robin after the last one',
      rule('round_robin', ['a', 'b', 'c'], 'a'),
      staff({ ...free }),
      'b',
    ],
    [
      'round robin wraps to the top',
      rule('round_robin', ['a', 'b', 'c'], 'c'),
      staff({ ...free }),
      'a',
    ],
    [
      'skips an inactive one',
      rule('round_robin', ['a', 'b', 'c'], 'a'),
      staff({ ...free, b: [false, 0, 0] }),
      'c',
    ],
    [
      'everyone at the cap → nobody',
      rule('round_robin', ['a', 'b'], null, 2),
      staff({ a: [true, 2, 0], b: [true, 3, 0] }),
      null,
    ],
    [
      'a removed last one starts at the top',
      rule('round_robin', ['a', 'b'], 'z'),
      staff({ a: [true, 0, 0], b: [true, 0, 0] }),
      'a',
    ],
    [
      'fewest open, a tie to the first in turn',
      rule('fewest_open', ['a', 'b', 'c'], 'a'),
      staff({ a: [true, 0, 1], b: [true, 0, 3], c: [true, 0, 1] }),
      'c',
    ],
    [
      'an unknown staff id is skipped',
      rule('round_robin', ['gone', 'a'], null),
      staff({ a: [true, 0, 0] }),
      'a',
    ],
  ] as const)('%s', (_, r, counsellors, want) => {
    expect(pickCounsellor(r, counsellors)).toBe(want);
  });
});
