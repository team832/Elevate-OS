/** Task reminder windows, the personal-preference rule and notification states (brief 23 Oct 2026 §8). */
import { describe, expect, it } from 'vitest';
import { isRelativeLink } from '@elevate/notifications';
import { deadlineInstant } from '../../src/domain/staff-tasks';
import { noticeStates, remindersDue, type ReminderTask } from '../../src/domain/task-notices';

const H = 3_600_000;
const HR = { dueSoonHours: 24, overdueRepeatHours: 24, unacknowledgedHours: 4 };
const task: ReminderTask = {
  dueOn: '2026-10-24',
  dueTime: '17:00:00',
  deliveredAt: null,
  acknowledgedAt: new Date('2026-10-20T00:00:00Z'),
};
const deadline = +deadlineInstant(task.dueOn, task.dueTime);
const at = (hoursFromDeadline: number) => new Date(deadline + hoursFromDeadline * H);

describe('remindersDue: due soon and overdue windows', () => {
  it.each([
    ['30 h before, 24 h window', -30, HR, []],
    [
      '30 h before, 48 h window (setting)',
      -30,
      { ...HR, dueSoonHours: 48 },
      ['due_soon:2026-10-24T17:00'],
    ],
    ['2 h before', -2, HR, ['due_soon:2026-10-24T17:00']],
    ['1 h late', 1, HR, ['overdue:2026-10-24T17:00#0']],
    ['23 h late (same window)', 23, HR, ['overdue:2026-10-24T17:00#0']],
    ['25 h late (next window)', 25, HR, ['overdue:2026-10-24T17:00#1']],
    [
      '25 h late, 6 h repeat (setting)',
      25,
      { ...HR, overdueRepeatHours: 6 },
      ['overdue:2026-10-24T17:00#4'],
    ],
  ])('%s', (_, hours, settings, expected) => {
    const r = remindersDue(task, at(hours), settings, null);
    expect(r.map((x) => `${x.kind}:${x.windowKey}`)).toEqual(expected);
  });

  it('a task without a time is due at the end of the IST day', () => {
    const r = remindersDue({ ...task, dueTime: null }, new Date('2026-10-24T18:40:00Z'), HR, null); // 00:10 IST next day
    expect(r).toEqual([{ kind: 'overdue', windowKey: '2026-10-24Tend#0' }]);
  });
});

describe('remindersDue: personal preferences only reduce noise', () => {
  const delivered = { ...task, dueOn: '2026-12-31', acknowledgedAt: null };
  const now = new Date('2026-10-23T12:00:00Z');
  const after = (h: number) => ({ ...delivered, deliveredAt: new Date(+now - h * H) });

  it.each([
    ['3 h after delivery: not yet', 3, null, []],
    ['5 h after delivery', 5, null, ['unacknowledged#0']],
    ['9 h after delivery, HR every 4 h', 9, null, ['unacknowledged#1']],
    ['9 h after delivery, personal every 24 h (spaced out)', 9, 24, ['unacknowledged#0']],
    ['9 h after delivery, personal every 2 h (cannot add reminders)', 9, 2, ['unacknowledged#1']],
  ])('%s', (_, hours, personal, expected) => {
    const r = remindersDue(after(hours), now, HR, personal);
    expect(r.map((x) => `${x.kind}${x.windowKey.slice(x.windowKey.indexOf('#'))}`)).toEqual(
      expected,
    );
  });

  it.each([null, 2, 24])(
    'overdue follows HR’s schedule whatever the personal interval (%s)',
    (p) => {
      expect(remindersDue(task, at(25), HR, p)).toEqual(remindersDue(task, at(25), HR, null));
    },
  );
});

describe('noticeStates', () => {
  const t = new Date('2026-10-23T05:00:00Z');
  it.each([
    ['delivered only', { deliveredAt: t }, ['delivered']],
    ['read, not acknowledged', { deliveredAt: t, readAt: t }, ['delivered', 'read']],
    [
      'acknowledged without reading the notification',
      { deliveredAt: t, acknowledgedAt: t },
      ['delivered', 'acknowledged'],
    ],
    [
      'approved',
      { deliveredAt: t, readAt: t, acknowledgedAt: t, lastSubmittedAt: t, approvedAt: t },
      ['delivered', 'read', 'acknowledged', 'submitted', 'approved'],
    ],
    ['nothing (self-logged)', {}, []],
  ])('%s', (_, facts, done) => {
    const states = noticeStates({
      deliveredAt: null,
      readAt: null,
      acknowledgedAt: null,
      lastSubmittedAt: null,
      approvedAt: null,
      ...facts,
    });
    expect(states.map((s) => s.label)).toEqual([
      'Delivered',
      'Read',
      'Acknowledged',
      'Work submitted',
      'Work approved',
    ]);
    expect(states.filter((s) => s.at).map((s) => s.key)).toEqual(done);
  });

  const later = new Date(+t + 3_600_000);
  const earlier = new Date(+t - 3_600_000);
  it.each([
    ['the latest submission after this owner’s delivery', t, later, later],
    ['a submission before this owner’s delivery (an earlier owner)', t, earlier, null],
    ['no delivery recorded (self-logged work)', null, earlier, earlier],
  ])('Work submitted: %s', (_, deliveredAt, lastSubmittedAt, at) => {
    const f = {
      deliveredAt,
      lastSubmittedAt,
      readAt: null,
      acknowledgedAt: null,
      approvedAt: null,
    };
    expect(noticeStates(f).find((s) => s.key === 'submitted')!.at).toEqual(at);
  });
});

describe('isRelativeLink (the open-redirect refuses off-site links)', () => {
  it.each([
    ['/academic/tasks/abc', true],
    ['/', true],
    ['//evil.example/x', false],
    ['/\\evil.example', false],
    ['https://evil.example', false],
    ['javascript:alert(1)', false],
    ['/\n/evil.example', false],
    ['/academic/tasks\r\nSet-Cookie: x', false],
    ['/a\tb', false],
    ['/a\u0000b', false],
    ['/a\u007fb', false],
  ])('%j → %s', (link, ok) => expect(isRelativeLink(link)).toBe(ok));
});
