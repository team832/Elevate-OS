/**
 * Task reminders, notification states and the permission-checked open (owner brief 23 Oct 2026
 * §8). Fictional people only; the teacher calls through Academic OS's paths (D-072).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { and, eq } from 'drizzle-orm';
import {
  auditEvents,
  notifications,
  opsStaffTasks,
  opsTaskReminders,
  userPreferences,
} from '@elevate/database';
import { notify } from '@elevate/notifications';
import { authedRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { deadlineInstant } from '../../src/domain/staff-tasks';
import { updateHrSetting } from '../../src/server/hr-settings';
import { taskDetail } from '../../src/server/task-detail';
import { dueWork, runTaskReminders } from '../../src/server/task-reminders';
import { GET as inbox } from '../../src/app/api/v1/notifications/route';
import { GET as open } from '../../src/app/notifications/[id]/open/route';
import { POST as runJob } from '../../src/app/api/v1/jobs/[job]/route';
import { DueWork } from '../../src/work';
import { setupReference, staffUser, type StaffUser } from './fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const ctx = setupTestDatabase();
const html = async (node: ReactNode) => new Response((await prerender(node)).prelude).text();
const H = 3_600_000;
let hr: StaffUser;
let teacher: StaffUser;
let other: StaffUser;

async function addTask(
  owner: StaffUser,
  dueOn: string,
  more: Partial<typeof opsStaffTasks.$inferInsert> = {},
) {
  const [t] = await ctx.db
    .insert(opsStaffTasks)
    .values({
      staffId: owner.staffId,
      title: 'Sample worksheet',
      dueOn,
      dueTime: '17:00',
      originalDueOn: dueOn,
      acknowledgedAt: new Date('2026-01-01T00:00:00Z'),
      acknowledgedByUserId: owner.id,
      source: 'manager',
      createdBy: hr.id,
      ...more,
    })
    .returning();
  return { ...t!, deadline: deadlineInstant(dueOn, '17:00') };
}
const remindersOf = (taskId: string) =>
  ctx.db
    .select()
    .from(opsTaskReminders)
    .where(eq(opsTaskReminders.taskId, taskId as never));
const notesOf = (taskId: string) =>
  ctx.db.select().from(notifications).where(eq(notifications.entityId, taskId));
const at = (base: Date, hours: number) => new Date(+base + hours * H);

beforeAll(async () => {
  await setupReference(ctx.db);
  hr = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR' });
  teacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher' });
  other = await staffUser(ctx.db, ['teacher'], { name: 'Sample Other Teacher' });
});

describe('task reminder job', () => {
  it('is idempotent: running twice in one window sends one reminder; overdue repeats per window', async () => {
    const t = await addTask(teacher, '2026-03-02');
    const now = at(t.deadline, 2);
    await runTaskReminders(ctx.db, { now });
    await runTaskReminders(ctx.db, { now });
    expect(await remindersOf(t.id)).toEqual([
      expect.objectContaining({ kind: 'overdue', windowKey: '2026-03-02T17:00#0' }),
    ]);
    const [note, ...more] = await notesOf(t.id);
    expect(more).toEqual([]);
    expect(note).toMatchObject({
      userId: teacher.id,
      kind: 'task.overdue',
      title: 'Overdue: Sample worksheet',
      link: `/academic/tasks/${t.id}`,
    });
    await runTaskReminders(ctx.db, { now: at(t.deadline, 26) });
    expect((await remindersOf(t.id)).map((r) => r.windowKey)).toEqual([
      '2026-03-02T17:00#0',
      '2026-03-02T17:00#1',
    ]);
    const [audit] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'job.task_reminders'))
      .limit(1);
    expect(audit).toBeTruthy();
  });

  it('takes its intervals from the tasks.reminders setting (changed through HR settings)', async () => {
    const t = await addTask(teacher, '2026-04-10');
    const now = at(t.deadline, -30);
    await runTaskReminders(ctx.db, { now });
    expect(await remindersOf(t.id)).toEqual([]);
    await updateHrSetting(ctx.db, hr, {
      key: 'tasks.reminders',
      value: { dueSoonHours: 48, overdueRepeatHours: 24, unacknowledgedHours: 4 },
    });
    await runTaskReminders(ctx.db, { now });
    expect(await remindersOf(t.id)).toEqual([
      expect.objectContaining({ kind: 'due_soon', windowKey: '2026-04-10T17:00' }),
    ]);
    await updateHrSetting(ctx.db, hr, {
      key: 'tasks.reminders',
      value: { dueSoonHours: 24, overdueRepeatHours: 24, unacknowledgedHours: 4 },
    });
  });

  it('a personal preference cannot suppress an overdue reminder; it only spaces out the rest', async () => {
    await ctx.db.insert(userPreferences).values({
      userId: other.id,
      settings: { notifications: { reminderIntervalHours: 24, popUps: false } },
    });
    const delivered = new Date('2026-05-01T00:00:00Z');
    const t = await addTask(other, '2026-05-01', {
      deliveredAt: delivered,
      acknowledgedAt: null,
      acknowledgedByUserId: null,
    });
    for (const h of [2, 26, 50]) await runTaskReminders(ctx.db, { now: at(t.deadline, h) });
    const rows = await remindersOf(t.id);
    expect(rows.filter((r) => r.kind === 'overdue').map((r) => r.windowKey)).toEqual([
      '2026-05-01T17:00#0',
      '2026-05-01T17:00#1',
      '2026-05-01T17:00#2',
    ]);
    // Unacknowledged: HR's 4 h would give a new window on each run; the personal 24 h spaces them.
    const unack = rows.filter((r) => r.kind === 'unacknowledged').map((r) => r.windowKey);
    expect(new Set(unack).size).toBe(unack.length);
    expect(unack.length).toBeLessThan(3 * 2);
  });

  it('the job route needs ops:jobs:run', async () => {
    const res = await callRoute(
      runJob,
      authedRequest(teacher, '/ops/api/v1/jobs/task-reminders', { method: 'POST' }),
      { job: 'task-reminders' },
    );
    expect(res.status).toBe(403);
  });
});

describe('opening a notification (permission-checked redirect)', () => {
  const openAs = (u: StaffUser, id: string) =>
    callRoute(open, authedRequest(u, `/academic/notifications/${id}/open`), { id });

  it('marks it read and redirects to the task', async () => {
    const t = await addTask(teacher, '2026-06-01');
    const [id] = await notify(ctx.db, {
      userIds: [teacher.id],
      module: 'ops',
      kind: 'task.assigned',
      title: 'New task: Sample worksheet',
      link: `/academic/tasks/${t.id}`,
      entityType: 'staff_task',
      entityId: t.id,
    });
    const res = await openAs(teacher, id!);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/academic/tasks/${t.id}`);
    const [n] = await ctx.db.select().from(notifications).where(eq(notifications.id, id!));
    expect(n!.readAt).toBeInstanceOf(Date);
    expect((await taskDetail(ctx.db, teacher, t.id)).noticeReadAt).toEqual(n!.readAt);
  });

  it('refuses without access to the task, still marking it read', async () => {
    const t = await addTask(teacher, '2026-06-02');
    const [id] = await notify(ctx.db, {
      userIds: [other.id],
      module: 'ops',
      kind: 'task.assigned',
      title: 'Sample task you lost',
      link: `/academic/tasks/${t.id}`,
    });
    const res = await openAs(other, id!);
    expect(res.headers.get('location')).toBe('/academic/notifications?open=denied');
    const [n] = await ctx.db.select().from(notifications).where(eq(notifications.id, id!));
    expect(n!.readAt).not.toBeNull();
  });

  it('refuses a link into a workspace the person does not belong to', async () => {
    const [id] = await notify(ctx.db, {
      userIds: [teacher.id],
      module: 'ops',
      kind: 'note',
      title: 'Sample Ops-only page',
      link: '/marketing/campaigns',
    });
    expect((await openAs(teacher, id!)).headers.get('location')).toBe(
      '/academic/notifications?open=denied',
    );
  });

  // Inserted directly: notify() refuses control characters, the frozen DB CHECK does not.
  it.each([
    '/somewhere/else',
    '/academic/../ops/settings',
    '/academic/%2E%2e/ops/settings',
    '/academic/tasks/\r\nSet-Cookie: x=1',
    '/\n/evil.example',
  ])('refuses a malformed or unknown link %j (no 500)', async (link) => {
    const [n] = await ctx.db
      .insert(notifications)
      .values({ userId: teacher.id, module: 'ops', kind: 'note', title: 'Sample odd link', link })
      .returning();
    const res = await openAs(teacher, n!.id);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/academic/notifications?open=missing');
  });

  it('someone else’s notification is "missing" and stays unread', async () => {
    const [id] = await notify(ctx.db, {
      userIds: [other.id],
      module: 'ops',
      kind: 'note',
      title: 'Sample private',
      link: '/academic',
    });
    expect((await openAs(teacher, id!)).headers.get('location')).toBe(
      '/academic/notifications?open=missing',
    );
    const [n] = await ctx.db.select().from(notifications).where(eq(notifications.id, id!));
    expect(n!.readAt).toBeNull();
  });
});

describe('notifications survive a refresh (server-side store, read through the API)', () => {
  it('lists the reminder with the task’s states and the pop-up preference', async () => {
    const t = await addTask(other, '2026-07-01', { deliveredAt: new Date('2026-06-30T00:00:00Z') });
    await runTaskReminders(ctx.db, { now: at(t.deadline, 1) });
    for (const _refresh of [1, 2]) {
      const res = await callRoute<{
        items: { entityId: string; kind: string; task: Record<string, unknown> | null }[];
        popUps: boolean;
      }>(inbox, authedRequest(other, '/academic/api/v1/notifications'));
      expect(res.data!.popUps).toBe(false);
      const item = res.data!.items.find((n) => n.entityId === t.id && n.kind === 'task.overdue');
      expect(item?.task).toMatchObject({
        deliveredAt: '2026-06-30T00:00:00.000Z',
        approvedAt: null,
      });
    }
  });
});

describe('due-soon and overdue panel', () => {
  it('shows the person’s overdue and due-soon open work, not later or closed work', async () => {
    const now = new Date();
    const day = (d: number) => new Date(+now + d * 86_400_000).toISOString().slice(0, 10);
    const late = await addTask(hr, day(-2), { title: 'Sample late report' });
    await addTask(hr, day(10), { title: 'Sample far-off plan' });
    await addTask(hr, day(-3), {
      title: 'Sample cancelled item',
      status: 'cancelled',
      reason: 'Sample',
    });
    const d = await dueWork(ctx.db, hr, now);
    expect(d!.items.map((i) => [i.title, i.state])).toEqual([['Sample late report', 'overdue']]);
    const out = await html(<DueWork user={hr} base="/ops" />);
    expect(out).toContain('Due soon and overdue (1)');
    expect(out).toContain(`/ops/tasks/${late.id}`);
    expect(out).not.toContain('Sample far-off plan');
  });

  it('is empty-stated for people with no due work', async () => {
    const fresh = await staffUser(ctx.db, ['teacher'], { name: 'Sample New Teacher' });
    const out = await html(<DueWork user={fresh} base="/academic" />);
    expect(out).toContain('Nothing overdue and nothing due in the next 24 hours.');
    const rows = await ctx.db
      .select()
      .from(opsTaskReminders)
      .where(and(eq(opsTaskReminders.staffId, fresh.staffId)));
    expect(rows).toEqual([]);
  });
});
