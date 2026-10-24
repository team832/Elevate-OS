/** Marketing calendar rules (brief 23 Oct 2026 §12): workflow, derived states, view windows. */
import { describe, expect, it } from 'vitest';
import * as schema from '@elevate/database';
import type { IsoDate } from '@elevate/shared-types';
import {
  CALENDAR_ITEM_TYPES,
  CALENDAR_STATUSES,
  CHANNELS,
  EFFORT_SIZES,
  calendarActionsFrom,
  calendarStates,
  calendarWindow,
  istTime,
  nextCalendarStatus,
  type CalendarAction,
  type CalendarStatus,
} from '../../src/domain/calendar';

describe('calendar vocabulary mirrors the schema file', () => {
  it('types, statuses, channels and effort sizes match', () => {
    expect(schema.MARKETING_CALENDAR_ITEM_TYPES).toEqual(CALENDAR_ITEM_TYPES);
    expect(schema.MARKETING_CALENDAR_STATUSES).toEqual(CALENDAR_STATUSES);
    expect(schema.MARKETING_CHANNELS).toEqual(CHANNELS);
    expect(schema.MARKETING_EFFORT_SIZES).toEqual(EFFORT_SIZES);
  });
});

describe('calendar workflow', () => {
  it.each([
    ['idea', 'plan', 'planned'],
    ['planned', 'start', 'in_production'],
    ['in_production', 'submit', 'submitted'],
    ['submitted', 'approve', 'approved'],
    ['submitted', 'request_changes', 'changes_requested'],
    ['changes_requested', 'start', 'in_production'],
    ['changes_requested', 'submit', 'submitted'],
    ['approved', 'schedule', 'scheduled'],
    ['approved', 'publish', 'published'],
    ['scheduled', 'publish', 'published'],
    ['scheduled', 'cancel', 'cancelled'],
    ['idea', 'cancel', 'cancelled'],
  ] as const)('%s --%s--> %s', (from, action, to) => {
    expect(nextCalendarStatus(from, action)).toBe(to);
  });

  it.each([
    ['planned', 'approve'],
    ['in_production', 'publish'],
    ['submitted', 'schedule'],
    ['planned', 'publish'],
    ['published', 'cancel'],
    ['cancelled', 'plan'],
    ['approved', 'approve'],
  ] as const)('%s cannot %s', (from, action) => {
    expect(nextCalendarStatus(from, action as CalendarAction)).toBeNull();
  });

  it('approval never publishes: approve leads to approved, publish is its own action', () => {
    expect(calendarActionsFrom('submitted')).toEqual(['approve', 'request_changes', 'cancel']);
    expect(calendarActionsFrom('approved')).toEqual(['schedule', 'publish', 'cancel']);
    expect(calendarActionsFrom('published')).toEqual([]);
  });

  it.each([
    ['planned', 'Not submitted', 'Not published'],
    ['submitted', 'Awaiting review', 'Not published'],
    ['changes_requested', 'Changes requested', 'Not published'],
    ['approved', 'Approved', 'Not published'],
    ['scheduled', 'Approved', 'Scheduled, not yet published'],
    ['published', 'Approved', 'Published'],
  ] as const)('%s reads as review "%s" and publication "%s"', (status, review, publication) => {
    expect(calendarStates(status as CalendarStatus)).toEqual({ review, publication });
  });
});

describe('calendar windows', () => {
  it.each([
    ['month', '2026-10-23', '2026-10-01', '2026-10-31', '2026-09-01', '2026-11-01'],
    ['list', '2026-12-05', '2026-12-01', '2026-12-31', '2026-11-01', '2027-01-01'],
    ['month', '2027-02-10', '2027-02-01', '2027-02-28', '2027-01-01', '2027-03-01'],
    ['week', '2026-10-23', '2026-10-19', '2026-10-25', '2026-10-12', '2026-10-26'],
  ] as const)('%s around %s runs %s to %s', (view, date, from, to, prev, next) => {
    expect(calendarWindow(view, date as IsoDate)).toEqual({ from, to, prev, next });
  });

  it('keeps the IST time of day', () => {
    expect(istTime(new Date('2026-10-23T13:30:00Z'))).toBe('19:00');
  });
});
