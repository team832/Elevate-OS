import { beforeAll, describe, expect, it } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { randomBytes } from 'node:crypto';
import {
  auditEvents,
  opsTaskEvents,
  opsTaskImportBatches,
  opsTaskUpdates,
  staffMembers,
} from '@elevate/database';
import { addDays, istToday } from '../../src/domain/dates';
import { managedStaffIds } from '../../src/server/context';
import { insertTaskWithEvent } from '../../src/server/task-store';
import { GET as listRoute, POST as createRoute } from '../../src/app/api/v1/staff-tasks/route';
import { GET as getRoute, PATCH as patchRoute } from '../../src/app/api/v1/staff-tasks/[id]/route';
import { POST as actionRoute } from '../../src/app/api/v1/staff-tasks/[id]/[action]/route';
import { POST as reassignRoute } from '../../src/app/api/v1/staff-tasks/[id]/reassign/route';
import { POST as dependencyRoute } from '../../src/app/api/v1/staff-tasks/[id]/dependencies/route';
import { POST as updateRoute } from '../../src/app/api/v1/staff-tasks/[id]/updates/route';
import { GET as reportRoute } from '../../src/app/api/v1/staff-tasks/[id]/report/route';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const today = istToday(new Date());
let opsManager: StaffUser; // all scope
let lead: StaffUser; // counsellor (own scope) who manages mid
let mid: StaffUser; // reports to lead, manages low
let low: StaffUser; // reports to mid (indirect report of lead)
let peer: StaffUser; // no manager
let outsider: TestUser;

beforeAll(async () => {
  await setupReference(ctx.db);
  opsManager = await staffUser(ctx.db, ['operations_manager']);
  lead = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Sample Lead' });
  mid = await staffUser(ctx.db, ['admissions_counsellor'], {
    managerId: lead.staffId,
    name: 'Sample Mid',
  });
  low = await staffUser(ctx.db, ['finance_officer'], { managerId: mid.staffId, name: 'Sample Low' });
  peer = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Sample Peer' });
  outsider = await createTestUser(ctx.db, { roles: ['platform_admin'] }); // no Ops task access (marketing has its own tasks since D-073)
});

type Task = {
  id: string;
  status: string;
  version: number;
  staffId: string;
  acknowledgedAt: string | null;
  warnings?: string[];
};
const create = (u: TestUser, json: Record<string, unknown>) =>
  callRoute<Task>(
    createRoute,
    authedRequest(u, '/ops/api/v1/staff-tasks', { method: 'POST', json }),
  );
const act = (
  u: TestUser | null,
  id: string,
  action: string,
  json: Record<string, unknown> = {},
) => {
  const url = `/ops/api/v1/staff-tasks/${id}/${action}`;
  return callRoute<Task>(
    actionRoute,
    u
      ? authedRequest(u, url, { method: 'POST', json })
      : buildRequest(url, { method: 'POST', json }),
    { id, action },
  );
};
const post = (
  route: typeof reassignRoute,
  u: TestUser,
  id: string,
  json: Record<string, unknown>,
) =>
  callRoute<Task & { update?: { id: string }; warnings: string[] }>(
    route,
    authedRequest(u, `/ops/api/v1/staff-tasks/${id}/x`, { method: 'POST', json }),
    { id },
  );
const get = (u: TestUser, id: string) =>
  callRoute<Task & { events: { kind: string }[]; allowed: string[]; waitingOn: string[] }>(
    getRoute,
    authedRequest(u, `/ops/api/v1/staff-tasks/${id}`),
    { id },
  );
const report = (u: TestUser, id: string, format: 'pdf' | 'csv') =>
  reportRoute(authedRequest(u, `/ops/api/v1/staff-tasks/${id}/report?format=${format}`), {
    params: Promise.resolve({ id }),
  });
const version = async (u: TestUser, id: string) => (await get(u, id)).data!.version;

describe('managedStaffIds (R3)', () => {
  it('follows the manager chain to indirect reports and stops on a loop', async () => {
    expect((await managedStaffIds(ctx.db, lead.staffId)).sort()).toEqual(
      [mid.staffId, low.staffId].sort(),
    );
    expect(await managedStaffIds(ctx.db, low.staffId)).toEqual([]);
    const x = await staffUser(ctx.db, ['finance_officer']);
    const y = await staffUser(ctx.db, ['finance_officer'], { managerId: x.staffId });
    await ctx.db
      .update(staffMembers)
      .set({ managerId: y.staffId })
      .where(eq(staffMembers.id, x.staffId));
    expect(await managedStaffIds(ctx.db, x.staffId)).toEqual([y.staffId]);
  });
});

describe('test 1: receive → acknowledge → update → review → close, with history', () => {
  it('keeps every step as a dated event and builds the end-to-end report', async () => {
    const t = await create(lead, {
      title: 'Sample fee slip check',
      staffId: low.staffId,
      reviewRequired: true,
      reviewerStaffId: lead.staffId,
      acceptanceCriteria: 'All 12 slips match the ledger',
      dueOn: addDays(today, 2),
    });
    expect(t.status).toBe(201);
    expect(t.data).toMatchObject({ status: 'pending', acknowledgedAt: null, version: 1 });
    const id = t.data!.id;

    const ack = await act(low, id, 'acknowledge', { expectedVersion: 1 });
    expect(ack.data).toMatchObject({
      status: 'pending',
      acknowledgedAt: expect.any(String),
      version: 2,
    });
    expect((await act(low, id, 'start', { expectedVersion: 2 })).data!.status).toBe('in_progress');
    const upd = await post(updateRoute, low, id, {
      occurredOn: addDays(today, -1),
      workPerformed: 'Checked 8 slips',
      remainingWork: '4 slips',
      durationMinutes: 40,
    });
    expect(upd.status).toBe(201);
    expect((await act(low, id, 'submit-for-review', { expectedVersion: 3 })).data!.status).toBe(
      'in_review',
    );
    expect((await act(low, id, 'approve', { expectedVersion: 4 })).status).toBe(403);
    expect((await act(lead, id, 'request-changes', { expectedVersion: 4 })).status).toBe(400);
    expect(
      (await act(lead, id, 'request-changes', { expectedVersion: 4, reason: 'Two slips missing' }))
        .data!.status,
    ).toBe('in_progress');
    await act(low, id, 'submit-for-review', { expectedVersion: 5 });
    const done = await act(lead, id, 'approve', { expectedVersion: 6 });
    expect(done.data).toMatchObject({ status: 'done', version: 7 });

    const events = await ctx.db
      .select()
      .from(opsTaskEvents)
      .where(eq(opsTaskEvents.taskId, id as never))
      .orderBy(asc(opsTaskEvents.occurredAt));
    expect(events.map((e) => e.kind)).toEqual([
      'created',
      'acknowledged',
      'status_changed',
      'submitted_for_review',
      'changes_requested',
      'submitted_for_review',
      'review_approved',
    ]);
    expect(events[4]).toMatchObject({
      reason: 'Two slips missing',
      fromStatus: 'in_review',
      toStatus: 'in_progress',
    });
    const audits = await ctx.db.select().from(auditEvents).where(eq(auditEvents.entityId, id));
    expect(audits.length).toBeGreaterThanOrEqual(8);

    const csv = await report(lead, id, 'csv');
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const text = await csv.text();
    expect(text).toContain('Two slips missing');
    expect(text).toContain('Checked 8 slips');
    const pdf = await report(low, id, 'pdf');
    expect(pdf.status).toBe(200);
    expect(
      (await PDFDocument.load(new Uint8Array(await pdf.arrayBuffer()))).getPageCount(),
    ).toBeGreaterThanOrEqual(1);
    const exported = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'staff_task.report_exported')),
      );
    expect(exported.length).toBe(2);
  });
});

describe('test 2: unauthorised users cannot read, reassign, close or export', () => {
  let id: string;
  beforeAll(async () => {
    id = (await create(mid, { title: 'Sample call list', staffId: low.staffId })).data!.id;
  });

  it('a peer outside the chain gets 404 everywhere; signed out 401; no Ops tasks access 403', async () => {
    expect((await get(peer, id)).status).toBe(404);
    expect(
      (await post(reassignRoute, peer, id, { expectedVersion: 1, toStaffId: peer.staffId })).status,
    ).toBe(404);
    expect((await act(peer, id, 'complete', { expectedVersion: 1 })).status).toBe(404);
    expect((await report(peer, id, 'csv')).status).toBe(404);
    expect((await act(null, id, 'start', { expectedVersion: 1 })).status).toBe(401);
    expect((await report(outsider, id, 'pdf')).status).toBe(403);
    expect((await act(low, id, 'nonsense', { expectedVersion: 1 })).status).toBe(400);
  });

  it('own scope reaches direct and indirect reports only', async () => {
    expect((await get(lead, id)).status).toBe(200);
    expect((await create(lead, { title: 'For a peer', staffId: peer.staffId })).status).toBe(403);
    expect((await create(low, { title: 'Upwards', staffId: mid.staffId })).status).toBe(403);
    const list = await callRoute<{ rows: { id: string }[] }>(
      listRoute,
      authedRequest(lead, '/ops/api/v1/staff-tasks'),
    );
    expect(list.data!.rows.some((r) => r.id === id)).toBe(true);
    expect(
      (await post(reassignRoute, low, id, { expectedVersion: 1, toStaffId: peer.staffId })).status,
    ).toBe(403);
    expect((await act(low, id, 'cancel', { expectedVersion: 1, reason: 'Not mine' })).status).toBe(
      403,
    );
  });

  it('the generic edit cannot bypass review or cancel', async () => {
    const reviewed = (
      await create(opsManager, {
        title: 'Sample reviewed',
        staffId: low.staffId,
        reviewRequired: true,
      })
    ).data!.id;
    const patch = (json: Record<string, unknown>) =>
      callRoute(
        patchRoute,
        authedRequest(low, `/ops/api/v1/staff-tasks/${reviewed}`, {
          method: 'PATCH',
          json: { expectedVersion: 1, ...json },
        }),
        { id: reviewed },
      );
    expect((await patch({ status: 'done' })).status).toBe(409);
    expect((await patch({ status: 'in_review' })).status).toBe(400);
    expect((await patch({ status: 'cancelled', reason: 'x' })).status).toBe(400);
  });
});

describe('test 3: dependencies, reopen and reassign keep history', () => {
  it('rejects self and cycles, warns while waiting, never auto-completes', async () => {
    const a = (await create(low, { title: 'Sample A' })).data!;
    const b = (await create(low, { title: 'Sample B' })).data!;
    expect(a.acknowledgedAt).not.toBeNull(); // self-created work is acknowledged by creating it
    expect(
      (await post(dependencyRoute, low, a.id, { expectedVersion: 1, dependsOnTaskId: a.id }))
        .status,
    ).toBe(400);
    expect(
      (await post(dependencyRoute, low, a.id, { expectedVersion: 1, dependsOnTaskId: b.id }))
        .status,
    ).toBe(201);
    expect(
      (await post(dependencyRoute, low, b.id, { expectedVersion: 1, dependsOnTaskId: a.id }))
        .status,
    ).toBe(400);
    const started = await act(low, a.id, 'start', { expectedVersion: 2 });
    expect(started.data!.warnings).toEqual(['Waiting on “Sample B”.']);
    expect((await get(low, a.id)).data!.waitingOn).toEqual(['Sample B']);
    await act(low, b.id, 'complete', { expectedVersion: 1 });
    expect((await get(low, a.id)).data).toMatchObject({ status: 'in_progress', waitingOn: [] });

    expect((await act(low, b.id, 'reopen', { expectedVersion: 2 })).status).toBe(400);
    expect(
      (await act(low, b.id, 'reopen', { expectedVersion: 2, reason: 'Wrong totals' })).data!.status,
    ).toBe('in_progress');

    expect(
      (await post(reassignRoute, mid, a.id, { expectedVersion: 3, toStaffId: lead.staffId }))
        .status,
    ).toBe(403);
    const handed = await post(reassignRoute, lead, a.id, {
      expectedVersion: 3,
      toStaffId: mid.staffId,
      reason: 'Low on leave',
    });
    expect(handed.data).toMatchObject({ staffId: mid.staffId, acknowledgedAt: null, version: 4 });
    const kinds = (await get(lead, a.id)).data!.events.map((e) => e.kind);
    expect(kinds).toEqual([
      'created',
      'acknowledged',
      'dependency_added',
      'status_changed',
      'reassigned',
    ]);
    const [ev] = await ctx.db
      .select()
      .from(opsTaskEvents)
      .where(and(eq(opsTaskEvents.taskId, a.id as never), eq(opsTaskEvents.kind, 'reassigned')));
    expect(ev).toMatchObject({
      fromStaffId: low.staffId,
      toStaffId: mid.staffId,
      reason: 'Low on leave',
    });
  });
});

describe('concurrency and work updates', () => {
  it('a due-date change is a dated event with old and new due and the reason', async () => {
    const t = (await create(low, { title: 'Sample move date', dueOn: today })).data!;
    const res = await callRoute(
      patchRoute,
      authedRequest(low, '/x', {
        method: 'PATCH',
        json: { dueOn: addDays(today, 3), changeReason: 'Parent asked', expectedVersion: 1 },
      }),
      { id: t.id },
    );
    expect(res.status).toBe(200);
    const [ev] = await ctx.db
      .select()
      .from(opsTaskEvents)
      .where(and(eq(opsTaskEvents.taskId, t.id as never), eq(opsTaskEvents.kind, 'due_changed')));
    expect(ev).toMatchObject({
      reason: 'Parent asked',
      data: { fromDueOn: today, toDueOn: addDays(today, 3) },
    });
  });

  it('a stale expectedVersion is refused with 409', async () => {
    const t = (await create(low, { title: 'Sample race' })).data!;
    expect((await act(low, t.id, 'start', { expectedVersion: 1 })).status).toBe(200);
    expect((await act(low, t.id, 'block', { expectedVersion: 1, reason: 'x' })).status).toBe(409);
    const stale = await callRoute(
      patchRoute,
      authedRequest(low, `/x`, { method: 'PATCH', json: { title: 'Renamed', expectedVersion: 1 } }),
      { id: t.id },
    );
    expect(stale.status).toBe(409);
  });

  it('flags overlapping entries, keeps a late work date, corrects by a new row once', async () => {
    const t = (await create(low, { title: 'Sample timed work' })).data!;
    // Yesterday: timed entries may not end in the future, whatever time the test runs.
    const at = (hhmm: string) => `${addDays(today, -1)}T${hhmm}`;
    const first = await post(updateRoute, low, t.id, {
      workPerformed: 'Calls',
      startedAt: at('10:00'),
      endedAt: at('11:00'),
    });
    expect(first.data!.warnings).toEqual([]);
    const second = await post(updateRoute, low, t.id, {
      workPerformed: 'More calls',
      startedAt: at('10:30'),
      endedAt: at('11:30'),
    });
    expect(second.data!.warnings).toEqual([
      'Overlaps another entry on this day (10:00 am–11:00 am IST).',
    ]);
    expect(
      (await post(updateRoute, low, t.id, { workPerformed: 'x', occurredOn: addDays(today, 1) }))
        .status,
    ).toBe(400);
    expect((await post(updateRoute, peer, t.id, { workPerformed: 'x' })).status).toBe(404);
    const fix = {
      workPerformed: 'More calls',
      startedAt: at('11:00'),
      endedAt: at('11:30'),
      correctsUpdateId: second.data!.update!.id,
    };
    expect((await post(updateRoute, low, t.id, fix)).status).toBe(400);
    expect(
      (await post(updateRoute, low, t.id, { ...fix, correctionReason: 'Wrong start' })).status,
    ).toBe(201);
    expect((await post(updateRoute, low, t.id, { ...fix, correctionReason: 'Again' })).status).toBe(
      409,
    );
    const rows = await ctx.db
      .select()
      .from(opsTaskUpdates)
      .where(eq(opsTaskUpdates.taskId, t.id as never));
    expect(rows).toHaveLength(3);
    expect(await version(low, t.id)).toBe(1); // work updates are their own append-only rows
  });
});

describe('fix round 1: review gate, scope and validation', () => {
  const patch = (u: TestUser, id: string, json: Record<string, unknown>) =>
    callRoute<Task>(patchRoute, authedRequest(u, '/x', { method: 'PATCH', json }), { id });

  it('the owner of assigned work cannot clear the assigner or drop the review step', async () => {
    const t = (
      await create(mid, {
        title: 'Sample gated work',
        staffId: low.staffId,
        reviewRequired: true,
        reviewerStaffId: mid.staffId,
      })
    ).data!;
    await act(low, t.id, 'acknowledge', { expectedVersion: 1 });
    await act(low, t.id, 'start', { expectedVersion: 2 });
    expect((await patch(low, t.id, { assignedByStaffId: null, expectedVersion: 3 })).status).toBe(
      400,
    );
    expect((await patch(low, t.id, { reviewRequired: false, expectedVersion: 3 })).status).toBe(
      403,
    );
    expect((await patch(low, t.id, { reviewerStaffId: null, expectedVersion: 3 })).status).toBe(
      403,
    );
    expect((await act(low, t.id, 'complete', { expectedVersion: 3 })).status).toBe(409);
    expect((await act(low, t.id, 'cancel', { expectedVersion: 3, reason: 'x' })).status).toBe(403);
    expect((await patch(mid, t.id, { reviewRequired: false, expectedVersion: 3 })).status).toBe(
      200,
    );
  });

  it('an own-scope creator cannot name another assigner; PATCH needs expectedVersion', async () => {
    const t = (await create(low, { title: 'Sample self', assignedByStaffId: peer.staffId })).data!;
    expect((await get(low, t.id)).data).toMatchObject({ assignedByStaffId: low.staffId });
    expect((await get(peer, t.id)).status).toBe(404);
    expect((await patch(low, t.id, { title: 'No version' })).status).toBe(400);
  });

  it('an all-scope creator without a staff record assigns, never self-assigns', async () => {
    const admin = await createTestUser(ctx.db, { roles: ['operations_manager'] });
    const t = (await create(admin, { title: 'Sample from admin', staffId: low.staffId })).data!;
    expect((await get(low, t.id)).data).toMatchObject({ source: 'manager', acknowledgedAt: null });
    expect((await act(low, t.id, 'cancel', { expectedVersion: 1, reason: 'x' })).status).toBe(403);
  });

  it('naming someone as requester does not let them read or export the task', async () => {
    const t = (await create(low, { title: 'Sample requested', requesterStaffId: peer.staffId }))
      .data!;
    expect((await get(peer, t.id)).status).toBe(404);
    expect((await report(peer, t.id, 'csv')).status).toBe(404);
  });

  it('reassigning to yourself records the acknowledgement as an event and you as assigner', async () => {
    const t = (await create(mid, { title: 'Sample take back', staffId: low.staffId })).data!;
    const res = await post(reassignRoute, mid, t.id, {
      expectedVersion: 1,
      toStaffId: mid.staffId,
    });
    expect(res.data).toMatchObject({ staffId: mid.staffId, acknowledgedAt: expect.any(String) });
    const kinds = (await get(mid, t.id)).data!.events.map((e) => e.kind);
    expect(kinds).toEqual(['created', 'reassigned', 'acknowledged']);
    const handed = (await create(lead, { title: 'Sample hand', staffId: lead.staffId })).data!;
    await post(reassignRoute, lead, handed.id, { expectedVersion: 1, toStaffId: low.staffId });
    expect((await get(low, handed.id)).data).toMatchObject({ assignedByStaffId: lead.staffId });
    expect((await act(low, handed.id, 'cancel', { expectedVersion: 2, reason: 'x' })).status).toBe(
      403,
    );
  });

  it('dependency events use their own kind; titles outside your scope stay hidden', async () => {
    const mine = (await create(lead, { title: 'Sample lead work' })).data!;
    const theirs = (await create(low, { title: 'Sample low work' })).data!;
    expect(
      (
        await post(dependencyRoute, low, theirs.id, {
          expectedVersion: 1,
          dependsOnTaskId: mine.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(dependencyRoute, lead, mine.id, {
          expectedVersion: 1,
          dependsOnTaskId: theirs.id,
        })
      ).status,
    ).toBe(201);
    expect((await get(lead, mine.id)).data!.events.map((e) => e.kind)).toContain(
      'dependency_added',
    );
    const blocked = (await get(low, theirs.id)).data as unknown as { blocks: { title: string }[] };
    expect(blocked.blocks.map((b) => b.title)).toEqual(['A task you can’t see']);
  });

  it('done at creation only for self-logged work without review', async () => {
    expect(
      (await create(mid, { title: 'Sample', staffId: low.staffId, status: 'done' })).status,
    ).toBe(400);
    expect(
      (await create(low, { title: 'Sample', reviewRequired: true, status: 'done' })).status,
    ).toBe(400);
    expect((await create(low, { title: 'Sample done', status: 'done' })).status).toBe(201);
  });

  it('the next recurring occurrence starts unacknowledged', async () => {
    const t = (await create(low, { title: 'Sample daily', recurrence: 'daily' })).data!;
    const done = await act(low, t.id, 'complete', { expectedVersion: 1 });
    const next = (done.data as unknown as { nextTaskId: string }).nextTaskId;
    expect((await get(low, next)).data!.acknowledgedAt).toBeNull();
  });

  it('work time must be consistent: day of start, not in the future, minutes or stop', async () => {
    const t = (await create(low, { title: 'Sample checks' })).data!;
    const y = addDays(today, -1);
    const bad = [
      { workPerformed: 'x', occurredOn: addDays(today, -2), startedAt: `${y}T10:00` },
      { workPerformed: 'x', startedAt: `${y}T10:00`, endedAt: `${addDays(today, 1)}T10:00` },
      { workPerformed: 'x', startedAt: `${y}T10:00`, endedAt: `${y}T11:00`, durationMinutes: 30 },
    ];
    for (const json of bad) expect((await post(updateRoute, low, t.id, json)).status).toBe(400);
  });

  it('CSV: a corrected entry is marked superseded with no minutes', async () => {
    const t = (await create(low, { title: 'Sample csv' })).data!;
    const first = await post(updateRoute, low, t.id, {
      workPerformed: 'Old entry',
      durationMinutes: 50,
    });
    await post(updateRoute, low, t.id, {
      workPerformed: 'New entry',
      durationMinutes: 20,
      correctsUpdateId: first.data!.update!.id,
      correctionReason: 'Typo',
    });
    const csv = await (await report(low, t.id, 'csv')).text();
    const old = csv.split('\r\n').find((l) => l.includes('Old entry'))!;
    expect(old).toContain('superseded');
    expect(old.endsWith(',')).toBe(true);
  });
});

describe('R18: gate and cancel authority come from who logged the task', () => {
  const v = (id: string) => version(opsManager, id);
  const gate = async (u: TestUser, id: string) =>
    (
      await callRoute(
        patchRoute,
        authedRequest(u, '/x', {
          method: 'PATCH',
          json: { reviewerStaffId: opsManager.staffId, expectedVersion: await v(id) },
        }),
        { id },
      )
    ).status;
  const cancel = async (u: TestUser, id: string) =>
    (await act(u, id, 'cancel', { expectedVersion: await v(id), reason: 'Not needed' })).status;
  /** Complete a recurring task and return its next occurrence. */
  const nextOf = async (u: TestUser, id: string) =>
    (
      (await act(u, id, 'complete', { expectedVersion: await v(id) })).data as unknown as {
        nextTaskId: string;
      }
    ).nextTaskId;

  /** A task imported from a tracker file mapped to `staffId` (importer: the operations manager). */
  const importedTask = async (staffId: string) => {
    const [batch] = await ctx.db
      .insert(opsTaskImportBatches)
      .values({
        sourceFilename: 'sample-tracker.json',
        sourceSha256: randomBytes(32).toString('hex'),
        staffId: staffId as never,
        raw: {},
        isSample: true,
        createdByUserId: opsManager.id,
      })
      .returning();
    const row = await ctx.db.transaction((tx) =>
      insertTaskWithEvent(
        tx as never,
        opsManager,
        {
          staffId: staffId as never,
          title: 'Sample imported daily',
          source: 'import',
          recurrence: 'daily',
          dueOn: today,
          importBatchId: batch!.id,
          createdBy: opsManager.id,
        },
        { kind: 'imported' },
      ),
    );
    return row!;
  };

  it.each<[string, () => Promise<{ id: string; who: TestUser }>]>([
    [
      'imported for one person, then reassigned to another',
      async () => {
        const t = await importedTask(mid.staffId);
        const moved = await post(reassignRoute, lead, t.id, {
          expectedVersion: 1,
          toStaffId: low.staffId,
        });
        expect(moved.status).toBe(200);
        return { id: t.id, who: low };
      },
    ],
    [
      'A: owner hands assigned gated work to their own report, then tries the gate',
      async () => {
        const t = (
          await create(lead, { title: 'Sample A', staffId: mid.staffId, reviewRequired: true })
        ).data!;
        const handed = await post(reassignRoute, mid, t.id, {
          expectedVersion: 1,
          toStaffId: low.staffId,
        });
        expect(handed.status).toBe(403);
        expect(handed.error!.message).toContain('Ask whoever gave you this');
        return { id: t.id, who: mid };
      },
    ],
    [
      'a manager of the owner who did not log it',
      async () => ({
        id: (await create(lead, { title: 'Sample M', staffId: low.staffId, reviewRequired: true }))
          .data!.id,
        who: mid,
      }),
    ],
    [
      'admin names the owner as "Given by"',
      async () => ({
        id: (
          await create(opsManager, {
            title: 'Sample G',
            staffId: low.staffId,
            assignedByStaffId: low.staffId,
            reviewRequired: true,
          })
        ).data!.id,
        who: low,
      }),
    ],
    [
      'B: the recurring child of work from an all-scope user without a staff record',
      async () => {
        const admin = await createTestUser(ctx.db, { roles: ['operations_manager'] });
        const t = (
          await create(admin, { title: 'Sample B', staffId: low.staffId, recurrence: 'daily' })
        ).data!;
        return { id: await nextOf(low, t.id), who: low };
      },
    ],
  ])('%s: no gate change, no cancel', async (_, setup) => {
    const { id, who } = await setup();
    expect(await gate(who, id)).toBe(403);
    expect(await cancel(who, id)).toBe(403);
  });

  it('the creator keeps authority after a manager takes the work back', async () => {
    const t = (
      await create(lead, { title: 'Sample back', staffId: low.staffId, reviewRequired: true })
    ).data!;
    expect(
      (await post(reassignRoute, mid, t.id, { expectedVersion: 1, toStaffId: mid.staffId })).status,
    ).toBe(200);
    expect(await gate(mid, t.id)).toBe(403);
    expect(await gate(lead, t.id)).toBe(200);
    expect(await cancel(lead, t.id)).toBe(200);
  });

  it('self-logged and imported work (and their recurring children) stay the owner’s to cancel', async () => {
    const own = (await create(low, { title: 'Sample own daily', recurrence: 'daily' })).data!;
    const ownChild = await nextOf(low, own.id);
    const imported = await importedTask(low.staffId);
    const importedChild = await nextOf(low, imported.id);
    for (const id of [ownChild, importedChild]) expect(await cancel(low, id)).toBe(200);
    expect((await get(low, ownChild)).data).toMatchObject({ source: 'self', createdBy: low.id });
  });
});

describe('final polish', () => {
  it('the next occurrence of reviewed assigned work keeps its creator and review step', async () => {
    const t = (
      await create(lead, {
        title: 'Sample weekly check',
        staffId: low.staffId,
        recurrence: 'weekly',
        reviewRequired: true,
        reviewerStaffId: lead.staffId,
      })
    ).data!;
    await act(low, t.id, 'acknowledge', { expectedVersion: 1 });
    await act(low, t.id, 'start', { expectedVersion: 2 });
    await act(low, t.id, 'submit-for-review', { expectedVersion: 3 });
    const done = await act(lead, t.id, 'approve', { expectedVersion: 4 });
    const nextId = (done.data as unknown as { nextTaskId: string }).nextTaskId;
    const next = (await get(low, nextId)).data as unknown as Record<string, unknown>;
    expect(next).toMatchObject({
      source: 'manager',
      createdBy: lead.id,
      reviewRequired: true,
      reviewerStaffId: lead.staffId,
      canReassign: false,
    });
    const json = { expectedVersion: 1 };
    const gate = await callRoute(
      patchRoute,
      authedRequest(low, '/x', { method: 'PATCH', json: { ...json, reviewRequired: false } }),
      { id: nextId },
    );
    expect(gate.status).toBe(403);
    expect((await act(low, nextId, 'cancel', { ...json, reason: 'x' })).status).toBe(403);
    expect(
      (await post(reassignRoute, low, nextId, { ...json, toStaffId: low.staffId })).status,
    ).toBe(403);
  });

  it('a reviewer filtering by owner still sees the tasks they review', async () => {
    const t = (
      await create(opsManager, {
        title: 'Sample reviewed by peer',
        staffId: low.staffId,
        reviewRequired: true,
        reviewerStaffId: peer.staffId,
      })
    ).data!;
    const list = await callRoute<{ rows: { id: string }[] }>(
      listRoute,
      authedRequest(peer, `/ops/api/v1/staff-tasks?staffId=${low.staffId}`),
    );
    expect(list.data!.rows.map((r) => r.id)).toContain(t.id);
  });
});
