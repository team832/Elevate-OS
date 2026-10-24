/** Marketing calendar items (brief 23 Oct 2026 §12): routes, own scope, workflow, reschedule audit. */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditEvents } from '@elevate/database';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { GET as listRoute, POST as createRoute } from '../../src/app/api/v1/calendar-items/route';
import { PATCH as patchRoute } from '../../src/app/api/v1/calendar-items/[id]/route';
import { POST as actionRoute } from '../../src/app/api/v1/calendar-items/[id]/[action]/route';
import { calendarCounts } from '../../src/server/calendar';
import { marketingStaff, type Staff } from './marketing-people';
import { call } from '../helpers';

const ctx = setupTestDatabase();
let manager: Staff;
let manager2: TestUser;
let anika: Staff;
let bharat: Staff;
let teacher: TestUser;

const person = (role: 'marketing_manager' | 'marketing_contributor', name: string) =>
  marketingStaff(ctx.db, role, name);

type Item = {
  id: string;
  status: string;
  plannedAt: string | null;
  originalPlannedAt: string | null;
} & Record<string, unknown>;
const create = (user: TestUser | null, json: Record<string, unknown>) =>
  call<Item>(createRoute, user, '/marketing/api/v1/calendar-items', { json });
const act = (user: TestUser, id: string, action: string, json: Record<string, unknown> = {}) =>
  call<Item>(actionRoute, user, `/marketing/api/v1/calendar-items/${id}/${action}`, {
    json,
    params: { id, action },
  });
const draft = (title: string) => ({
  title,
  itemType: 'short_video',
  channel: 'instagram',
  audience: 'Class 12 commerce students',
  plannedAt: '2026-11-05T18:30',
  brief: 'Fictional brief for a test.',
  assetLinks: ['https://example.test/storyboard'],
});

beforeAll(async () => {
  manager = await person('marketing_manager', 'Sample Manager Meera');
  manager2 = await createTestUser(ctx.db, { roles: ['marketing_manager'] });
  anika = await person('marketing_contributor', 'Sample Marketer Anika');
  bharat = await person('marketing_contributor', 'Sample Marketer Bharat');
  teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
});

describe('calendar item routes', () => {
  it('401 signed out, 403 without marketing access, 400 on a bad body', async () => {
    expect((await call(listRoute, null, '/marketing/api/v1/calendar-items')).status).toBe(401);
    expect((await call(listRoute, teacher, '/marketing/api/v1/calendar-items')).status).toBe(403);
    expect((await create(anika, { title: 'x', itemType: 'tweet' })).status).toBe(400);
  });

  it('an employee creates an item they own; planned time is IST and kept as the original', async () => {
    const res = await create(anika, draft('Sample IPMAT quant reel'));
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      status: 'planned',
      ownerStaffId: anika.staffId,
      plannedAt: '2026-11-05T13:00:00.000Z',
      originalPlannedAt: '2026-11-05T13:00:00.000Z',
    });
    const audit = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'calendar_item.created'),
          eq(auditEvents.entityId, res.data!.id),
        ),
      );
    expect(audit).toHaveLength(1);
    const idea = await create(anika, { title: 'Sample undated idea', itemType: 'article' });
    expect(idea.data!.status).toBe('idea');
  });

  it('own scope: an employee cannot change or give away an item that is not theirs', async () => {
    const mine = (await create(anika, draft('Sample CLAT recap carousel'))).data!;
    const patch = (u: TestUser, json: Record<string, unknown>) =>
      call(patchRoute, u, `/x/${mine.id}`, { method: 'PATCH', json, params: { id: mine.id } });
    expect((await patch(bharat, { title: 'Taken over' })).status).toBe(403);
    expect((await act(bharat, mine.id, 'start')).status).toBe(403);
    expect((await patch(anika, { title: 'Sample CLAT recap carousel v2' })).status).toBe(200);
    expect((await patch(anika, { ownerStaffId: bharat.staffId })).status).toBe(403);
    expect(
      (await create(anika, { ...draft('Sample for Bharat'), ownerStaffId: bharat.staffId })).status,
    ).toBe(403);
    expect((await patch(manager, { ownerStaffId: bharat.staffId })).status).toBe(200);
  });

  it('own scope follows the current owner: a replaced creator cannot edit or cancel (I3)', async () => {
    const item = (await create(anika, draft('Sample handed over'))).data!;
    const patch = (u: TestUser, json: Record<string, unknown>) =>
      call(patchRoute, u, `/x/${item.id}`, { method: 'PATCH', json, params: { id: item.id } });
    expect((await patch(anika, { ownerStaffId: null })).status).toBe(403);
    expect((await patch(manager, { ownerStaffId: bharat.staffId })).status).toBe(200);
    expect((await patch(anika, { title: 'Sample taken back' })).status).toBe(403);
    expect((await act(anika, item.id, 'cancel', { reason: 'Not mine anymore' })).status).toBe(403);
    expect((await act(bharat, item.id, 'start')).status).toBe(200);
  });

  it('the related task is never free text (I4)', async () => {
    const item = (await create(anika, draft('Sample with a task'))).data!;
    const fake = '00000000-0000-4000-8000-000000000000';
    expect(
      (await create(anika, { ...draft('Sample fake task'), relatedTaskId: fake })).status,
    ).toBe(400);
    expect(
      (
        await call(patchRoute, anika, `/x/${item.id}`, {
          method: 'PATCH',
          json: { relatedTaskId: fake },
          params: { id: item.id },
        })
      ).status,
    ).toBe(400);
  });

  it('moving to the same time changes nothing and writes no audit row', async () => {
    const item = (await create(anika, draft('Sample same-day drop'))).data!;
    expect((await act(manager, item.id, 'move', { plannedAt: '2026-11-05T18:30' })).status).toBe(
      200,
    );
    const audit = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, 'calendar_item.rescheduled'), eq(auditEvents.entityId, item.id)),
      );
    expect(audit).toHaveLength(0);
  });

  it('approval and publication are separate; nobody approves their own item', async () => {
    const item = (await create(anika, draft('Sample admission webinar'))).data!;
    expect((await act(anika, item.id, 'start')).data!.status).toBe('in_production');
    expect((await act(anika, item.id, 'submit')).data!.status).toBe('submitted');
    expect((await act(anika, item.id, 'approve')).status).toBe(403);
    const managersOwn = (await create(manager, draft('Sample manager post'))).data!;
    await act(manager, managersOwn.id, 'start');
    await act(manager, managersOwn.id, 'submit');
    expect((await act(manager, managersOwn.id, 'approve')).status).toBe(403);

    const approved = await act(manager, item.id, 'approve');
    expect(approved.data).toMatchObject({
      status: 'approved',
      publishedAt: null,
      approvedBy: manager.id,
    });
    expect((await act(manager, item.id, 'publish')).status).toBe(400);
    expect((await act(manager, item.id, 'publish', { url: 'ftp://x.test/a' })).status).toBe(400);
    expect((await act(manager2, item.id, 'schedule')).data!.status).toBe('scheduled');
    const published = await act(manager, item.id, 'publish', {
      evidence: 'Screenshot of the webinar listing shared in the team folder.',
    });
    expect(published.data).toMatchObject({
      status: 'published',
      publishedBy: manager.id,
      publishedUrl: null,
    });
    expect((await act(manager, item.id, 'cancel', { reason: 'Too late' })).status).toBe(409);
  });

  it('request changes needs a note; cancel needs a reason', async () => {
    const item = (await create(bharat, draft('Sample maths revision sheet'))).data!;
    await act(bharat, item.id, 'start');
    await act(bharat, item.id, 'submit');
    expect((await act(manager, item.id, 'request-changes')).status).toBe(400);
    const back = await act(manager, item.id, 'request-changes', { note: 'Add the chapter list.' });
    expect(back.data).toMatchObject({
      status: 'changes_requested',
      reviewNote: 'Add the chapter list.',
    });
    expect((await act(bharat, item.id, 'cancel')).status).toBe(400);
    const cancelled = await act(bharat, item.id, 'cancel', { reason: 'Merged into another post.' });
    expect(cancelled.data).toMatchObject({
      status: 'cancelled',
      cancelledReason: 'Merged into another post.',
    });
  });

  it('moving the date needs schedule:manage, is audited with old and new, keeps the original', async () => {
    const item = (await create(anika, draft('Sample CA explainer'))).data!;
    expect((await act(anika, item.id, 'move', { plannedAt: '2026-11-07T10:00' })).status).toBe(403);
    expect((await act(manager, item.id, 'move', {})).status).toBe(400);
    const moved = await act(manager, item.id, 'move', { plannedAt: '2026-11-07T10:00' });
    expect(moved.data).toMatchObject({
      plannedAt: '2026-11-07T04:30:00.000Z',
      originalPlannedAt: '2026-11-05T13:00:00.000Z',
      status: 'planned',
    });
    const [audit] = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, 'calendar_item.rescheduled'), eq(auditEvents.entityId, item.id)),
      );
    expect(audit).toMatchObject({
      actorUserId: manager.id,
      before: { plannedAt: '2026-11-05T13:00:00.000Z' },
      after: { plannedAt: '2026-11-07T04:30:00.000Z' },
    });
  });

  it('counts for the dashboard: open items due in a period and items awaiting review', async () => {
    const period = {
      from: new Date('2026-11-01T00:00:00+05:30'),
      to: new Date('2026-12-01T00:00:00+05:30'),
    };
    const before = await calendarCounts(ctx.db, period, bharat.staffId);
    const item = (await create(bharat, draft('Sample doubt-solving session'))).data!;
    await act(bharat, item.id, 'start');
    await act(bharat, item.id, 'submit');
    expect(await calendarCounts(ctx.db, period, bharat.staffId)).toEqual({
      due: before.due + 1,
      awaitingReview: before.awaitingReview + 1,
    });
    const list = await call<Item[]>(
      listRoute,
      anika,
      `/marketing/api/v1/calendar-items?status=submitted&owner=${bharat.staffId}`,
    );
    expect(list.data!.map((r) => r.id)).toContain(item.id);
  });
});
