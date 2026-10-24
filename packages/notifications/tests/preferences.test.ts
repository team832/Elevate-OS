/** Personal notification preferences read safely (only the allowed intervals; pop-ups default on). */
import { describe, expect, it } from 'vitest';
import { readNotificationPreferences } from '../src/index';

describe('readNotificationPreferences', () => {
  it.each([
    [{ notifications: { reminderIntervalHours: 8, popUps: false } }, 8, false],
    [{ notifications: { reminderIntervalHours: 24 } }, 24, true],
    [{ notifications: { reminderIntervalHours: 3 } }, null, true],
    [{ notifications: { reminderIntervalHours: 10_000 } }, null, true],
    [{ notifications: { reminderIntervalHours: '4' } }, null, true],
    [{ notifications: { reminderIntervalHours: null, popUps: 'no' } }, null, true],
    [{}, null, true],
    [null, null, true],
  ])('%j → %s, pop-ups %s', (settings, hours, popUps) =>
    expect(readNotificationPreferences(settings)).toEqual({ reminderIntervalHours: hours, popUps }),
  );
});
