import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  auditEvents,
  notifications,
  opsEodReports,
  opsEodReportVersions,
  opsStaffTasks,
  opsTaskEvents,
  opsTaskImportBatches,
} from '@elevate/database';
import { authedRequest, buildRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { GET as listRoute, POST as uploadRoute } from '../../src/app/api/v1/task-imports/route';
import { GET as getRoute } from '../../src/app/api/v1/task-imports/[id]/route';
import { POST as commitRoute } from '../../src/app/api/v1/task-imports/[id]/commit/route';
import { NOT_AN_EXPORT } from '../../src/domain/task-import';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let teacher: StaffUser;

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  teacher = await staffUser(ctx.db, ['teacher'], { managerId: manager.staffId });
});

const task = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  title: `Sample tracker task ${id}`,
  details: '',
  by: 'Sample Boss',
  client: '(Internal / Office)',
  prio: 'Medium',
  deadlineDate: '2026-10-20',
  deadlineTime: '18:00',
  status: 'In progress',
  prog: 30,
  reason: '',
  recur: '',
  createdAt: '2026-10-18',
  completedAt: null,
  ...over,
});
const backup = (tasks: unknown[], extra: unknown[] = []) =>
  JSON.stringify({
    customTemplates: [],
    setupDone: true,
    profile: { name: 'Sample Teacher', email: 'nobody@example.test', empId: '' },
    clients: ['(Internal / Office)'],
    tasks,
    reports: [
      {
        id: 900,
        reportDate: '2026-10-19',
        generatedAt: '2026-10-19T12:30:00.000Z',
        meta: { name: 'Sample Teacher', logo: '' },
        data: { done: [], prog: [] },
        text: '*EOD Report — Sample Teacher*',
      },
      ...extra,
    ],
  });
const FIRST = backup(
  [
    task(1),
    task(2, { status: 'Done', prog: 100, completedAt: '2026-10-19' }),
    task(3, { status: 'Waiting' }),
    task(4, { deadlineDate: '' }),
    { title: 'no id' },
  ],
  [{ id: 901, reportDate: '19 Oct', generatedAt: '2026-10-19T12:30:00.000Z' }],
);

type View = {
  id: string;
  batch: { status: string };
  counts: Record<string, number>;
  rows: { legacyId: string; kind: string; outcome: string; message: string | null }[];
};
const upload = (user = manager, content = FIRST, filename = 'Task-EOD-backup-2026-10-21.json') =>
  callRoute<View>(
    uploadRoute,
    authedRequest(user, '/ops/api/v1/task-imports', {
      method: 'POST',
      json: { filename, staffId: teacher.staffId, content },
    }),
  );
const commit = (id: string, user = manager) =>
  callRoute<View>(
    commitRoute,
    authedRequest(user, `/ops/api/v1/task-imports/${id}/commit`, { method: 'POST' }),
    { id },
  );
const outcomeOf = (v: View) =>
  Object.fromEntries(v.rows.map((r) => [`${r.kind}:${r.legacyId}`, r.outcome]));

describe('tracker import (brief 2 §13, tests 15–16)', () => {
  it('needs a session and the import permission', async () => {
    const anon = await callRoute(listRoute, buildRequest('/ops/api/v1/task-imports'));
    expect(anon.status).toBe(401);
    expect((await upload(teacher)).status).toBe(403);
  });

  it.each([
    ['<!DOCTYPE html><html><head><title>Task Tracker</title></head></html>', NOT_AN_EXPORT],
    ['{"profile":{}}', 'This JSON file has no "tasks" list, so it is not a tracker backup.'],
  ])('refuses a file that is not a backup (%#)', async (content, message) => {
    const res = await upload(manager, content);
    expect(res.status).toBe(400);
    expect(res.error?.message).toBe(message);
    expect(await ctx.db.$count(opsTaskImportBatches)).toBe(0);
  });

  it('previews without importing, then commits once, writing no notifications', async () => {
    const before = await ctx.db.$count(notifications);
    const preview = await upload();
    expect(preview.status).toBe(201);
    expect(preview.data!.counts).toEqual({ parsed: 7, accepted: 3, unresolved: 2, failed: 2 });
    expect(outcomeOf(preview.data!)).toMatchObject({
      'task:1': 'accepted',
      'task:3': 'unresolved',
      'task:4': 'unresolved',
      'task:#5': 'failed',
      'report:900': 'accepted',
    });
    expect(await ctx.db.$count(opsStaffTasks)).toBe(0);

    const done = await commit(preview.data!.id);
    expect(done.status).toBe(200);
    expect(done.data!.batch.status).toBe('committed');
    const imported = await ctx.db.select().from(opsStaffTasks);
    expect(imported.map((t) => [t.legacyRef, t.source, t.status]).sort()).toEqual([
      [`deskday_backup_json:${teacher.staffId}:1`, 'import', 'in_progress'],
      [`deskday_backup_json:${teacher.staffId}:2`, 'import', 'done'],
    ]);
    const events = await ctx.db.select().from(opsTaskEvents);
    expect(events.map((e) => e.kind)).toEqual(['imported', 'imported']);
    // R17: dated at the commit (no backdated history); the tracker's own dates sit in `data.legacy`.
    for (const e of events) {
      expect(e).toMatchObject({ toStaffId: teacher.staffId, toStatus: expect.any(String) });
      expect(e.occurredAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
      expect((e.data as { legacy: { createdOn: string } }).legacy.createdOn).toBe('2026-10-18');
    }
    expect(await ctx.db.$count(auditEvents, eq(auditEvents.action, 'staff_task.imported'))).toBe(2);
    const [report] = await ctx.db.select().from(opsEodReports);
    expect(report).toMatchObject({
      status: 'submitted',
      reportDate: '2026-10-19',
      currentVersion: 1,
    });
    expect(await ctx.db.$count(opsEodReportVersions)).toBe(1);
    expect(await ctx.db.$count(notifications)).toBe(before);
    const actions = (
      await ctx.db.select().from(auditEvents).where(eq(auditEvents.entityType, 'task_import'))
    ).map((a) => a.action);
    expect(actions.sort()).toEqual(['task_import.committed', 'task_import.previewed']);

    // Committing again is refused; the stored reconciliation stays readable.
    expect((await commit(preview.data!.id)).status).toBe(409);
    const view = await callRoute<View>(
      getRoute,
      authedRequest(manager, `/ops/api/v1/task-imports/${preview.data!.id}`),
      { id: preview.data!.id },
    );
    expect(view.data!.counts).toMatchObject({ accepted: 3, unresolved: 2 });
  });

  it('re-uploading the same file shows every record as a duplicate and imports nothing', async () => {
    const again = await upload();
    expect(again.status).toBe(201);
    expect(again.data!.batch.status).toBe('committed');
    expect(again.data!.counts).toMatchObject({ duplicate: 3, unresolved: 2, failed: 2 });
    expect(await ctx.db.$count(opsTaskImportBatches)).toBe(1);
    expect(await ctx.db.$count(opsStaffTasks)).toBe(2);
  });

  it('two uploads of the same new file at once make one batch and no server error', async () => {
    const file = backup([task(50)]);
    const [a, b] = await Promise.all([
      upload(manager, file, 'a.json'),
      upload(manager, file, 'a.json'),
    ]);
    expect([a.status, b.status].sort()).toEqual(expect.arrayContaining([201]));
    for (const r of [a, b]) expect([201, 409]).toContain(r.status);
    expect(await ctx.db.$count(opsTaskImportBatches)).toBe(2);
  });

  it('a newer export reports changed records and keeps Elevate’s values', async () => {
    const newer = backup(
      [
        task(1, { status: 'Blocked', reason: 'Waiting on data' }),
        task(2, { status: 'Done', prog: 100, completedAt: '2026-10-19' }),
        task(5),
      ],
      [
        {
          id: 901,
          reportDate: '2026-10-18',
          generatedAt: '2026-10-18T12:30:00.000Z',
          text: 'fixed',
        },
      ],
    );
    const preview = await upload(manager, newer, 'Task-EOD-backup-2026-10-22.json');
    expect(outcomeOf(preview.data!)).toMatchObject({
      'task:1': 'changed',
      'task:2': 'duplicate',
      'task:5': 'accepted',
      'report:900': 'duplicate',
      'report:901': 'accepted', // failed before: never counts as already imported
    });
    // R4: Blocked is a flag now, so the change shows as the blocker, not the status.
    expect(preview.data!.rows.find((r) => r.legacyId === '1')!.message).toContain(
      'Blocked or on hold',
    );
    await commit(preview.data!.id);
    const [kept] = await ctx.db
      .select()
      .from(opsStaffTasks)
      .where(eq(opsStaffTasks.legacyRef, `deskday_backup_json:${teacher.staffId}:1`));
    expect(kept!.status).toBe('in_progress');
    expect(await ctx.db.$count(opsStaffTasks)).toBe(3);
  });
});
