/** Task reminder windows, the personal-preference rule and notification states (brief 23 Oct 2026 §8). */
import { describe, expect, it } from 'vitest';
import { isRelativeLink } from '@elevate/notifications';
import { deadlineInstant } from '../../src/domain/staff-tasks';
import { SETTING_DEFINITIONS } from '../../src/domain/policies';
import {
  noticeStates,
  reminderPreview,
  remindersDue,
  type ReminderSettings,
  type ReminderTask,
} from '../../src/domain/task-notices';

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

describe('reminderPreview says what the job really does', () => {
  /** Runs the real rule every hour for 40 days, sending each window once as the job does. */
  function observed(s: ReminderSettings, personal: number | null) {
    const delivered = new Date('2026-10-01T11:30:00Z');
    const t: ReminderTask = { dueOn: '2026-10-20', dueTime: '17:00:00', deliveredAt: delivered, acknowledgedAt: null };
    const due = +deadlineInstant(t.dueOn, t.dueTime);
    const seen = new Set<string>();
    const sent: Record<string, number[]> = { due_soon: [], overdue: [], unacknowledged: [] };
    for (let h = 0; h < 24 * 40; h += 1) {
      const now = new Date(+delivered + h * H);
      for (const r of remindersDue(t, now, s, personal)) {
        if (seen.has(r.kind + r.windowKey)) continue;
        seen.add(r.kind + r.windowKey);
        sent[r.kind]!.push(+now);
      }
    }
    return {
      dueSoonSent: sent.due_soon!.length,
      // The deadline instant ends its minute, so an hourly run lands just inside the window.
      dueSoonBefore: Math.ceil((due - sent.due_soon![0]!) / H),
      overdueEvery: (sent.overdue![2]! - sent.overdue![1]!) / H,
      ackFirst: (sent.unacknowledged![0]! - +delivered) / H,
      ackEvery: (sent.unacknowledged![2]! - sent.unacknowledged![1]!) / H,
    };
  }
  const n = (text: string, re: RegExp) => Number(re.exec(text)?.[1]);

  it.each<[ReminderSettings, number | null]>([
    [SETTING_DEFINITIONS['tasks.reminders'].defaultValue, null],
    [{ dueSoonHours: 48, overdueRepeatHours: 6, unacknowledgedHours: 8 }, null],
    [{ dueSoonHours: 1, overdueRepeatHours: 2, unacknowledgedHours: 2 }, 8],
    [HR, 8],
    [HR, 2], // closer than HR's: HR's interval still applies
    [{ dueSoonHours: 12, overdueRepeatHours: 12, unacknowledgedHours: 8 }, 24],
  ])('%j, personal %s', (s, personal) => {
    const real = observed(s, personal);
    const { schedule } = reminderPreview(s, personal);
    expect(real.dueSoonSent).toBe(1);
    expect(n(schedule, /reminder (\d+) hours? before a task is due/)).toBe(real.dueSoonBefore);
    expect(n(schedule, /then every (\d+) hours? while it is overdue/)).toBe(real.overdueEvery);
    const spaced = /and (\d+) hours? after a new task arrives, then every (\d+) hours? until/.exec(schedule);
    const every = spaced ? Number(spaced[2]) : n(schedule, /and every (\d+) hours? until/);
    expect(every).toBe(real.ackEvery);
    expect(spaced ? Number(spaced[1]) : every).toBe(real.ackFirst);
  });

  it('in the owner\'s words, from the real defaults; it says what personal controls change and that nothing runs alone', () => {
    const p = reminderPreview(SETTING_DEFINITIONS['tasks.reminders'].defaultValue);
    expect(p.schedule).toBe(
      'A person gets a reminder 24 hours before a task is due, then every 24 hours while it is overdue, and every 4 hours until they acknowledge a new task.',
    );
    expect(p.personal).toContain('cannot stop due-soon or overdue reminders');
    expect(p.running).toContain('no scheduler exists');
    expect(p.running).toContain('Send task reminders');
  });

  it.each([
    [null, "You are on HR's schedule."],
    [8, 'less often than HR\'s 4 hours'],
    [2, "HR's 4 hours is the shortest gap allowed"],
    [4, "HR's 4 hours is the shortest gap allowed"],
  ])('a person who chose %s is told what it does', (personal, words) => {
    const p = reminderPreview(HR, personal);
    expect(p.personal).toContain(words);
    expect(p.schedule).toMatch(/^You get a reminder/);
    expect(p.schedule).not.toContain('they');
  });
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
      'Notice read',
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
