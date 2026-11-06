/**
 * Staff joining / leaving checklists and the asset register (F4-09) through the real routes: the
 * Proposed templates seeded as version 1, each event's checklist from its own template, item
 * states with who and when, versions kept, one holder per tag, the leaver hand-over notice, the
 * spreadsheet download, permissions and HR's reach. Fictional people only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  departments,
  notifications,
  opsStaffAssets,
  opsStaffChecklistItems,
  opsStaffChecklistTemplates,
  staffMembers,
} from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  callRoute,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { POST as assetRoute } from '../../src/app/api/v1/hr/assets/route';
import { POST as returnRoute } from '../../src/app/api/v1/hr/assets/[id]/return/route';
import { POST as itemRoute } from '../../src/app/api/v1/hr/checklist-items/[id]/route';
import { POST as templateRoute } from '../../src/app/api/v1/hr/checklist-templates/route';
import { POST as startRoute } from '../../src/app/api/v1/hr/checklists/route';
import { GET as exportRoute } from '../../src/app/api/v1/hr/staff-records/[list]/route';
import { POST as staffAction } from '../../src/app/api/v1/hr/staff/[id]/[action]/route';
import { addDays, istToday } from '../../src/domain/dates';
import { getStaffChecklist } from '../../src/server/hr-staff-records';
import {
  PROPOSED_STAFF_CHECKLISTS,
  seedStaffChecklistTemplates,
} from '../../seed/staff-checklist-templates';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const today = istToday(new Date());
const API = '/ops/api/v1/hr';
let hr: StaffUser;
let ops: StaffUser;
let director: StaffUser;
let counsellor: StaffUser;
let teacher: StaffUser;
let outside: StaffUser; // in FINANCE: outside HR's default department scope

const call = <T>(
  route: Parameters<typeof callRoute>[0],
  u: TestUser,
  path: string,
  json: unknown,
  params = {},
) => callRoute<T>(route, authedRequest(u, `${API}/${path}`, { method: 'POST', json }), params);
const start = (u: TestUser, staffId: string, event: string) =>
  call<{ id: string }>(startRoute, u, 'checklists', { staffId, event });
const setItem = (u: TestUser, id: string, json: Record<string, unknown>) =>
  call<{ status: string; doneBy: string | null; doneAt: string | null }>(
    itemRoute,
    u,
    `checklist-items/${id}`,
    json,
    { id },
  );
const issue = (u: TestUser, staffId: string, more: Record<string, unknown> = {}) =>
  call<{ id: string }>(assetRoute, u, 'assets', {
    staffId,
    assetType: 'Laptop',
    issuedOn: today,
    ...more,
  });
const giveBack = (u: TestUser, id: string, returnedOn = today) =>
  call(returnRoute, u, `assets/${id}/return`, { returnedOn, conditionNote: 'Fine (test)' }, { id });

beforeAll(async () => {
  await setupReference(ctx.db);
  hr = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR Records' });
  ops = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Records' });
  director = await staffUser(ctx.db, ['director'], { name: 'Sample Director Records' });
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], {
    name: 'Sample Counsellor Records',
  });
  teacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Records' });
  outside = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Finance' });
  const [fin] = await ctx.db.select().from(departments).where(eq(departments.code, 'FINANCE'));
  await ctx.db
    .update(staffMembers)
    .set({ departmentId: fin!.id })
    .where(eq(staffMembers.id, outside.staffId));
  await seedStaffChecklistTemplates(ctx.db, ops.id);
  await seedStaffChecklistTemplates(ctx.db, ops.id); // idempotent
});
afterEach(() => vi.unstubAllGlobals());

describe('checklists', () => {
  it('the Proposed items are seeded once as version 1 of each event', async () => {
    const rows = await ctx.db.select().from(opsStaffChecklistTemplates);
    expect(
      rows.map((t) => [t.event, t.version, t.status, t.items.map((i) => i.label)]).sort(),
    ).toEqual([
      ['joining', 1, 'active', [...PROPOSED_STAFF_CHECKLISTS.joining]],
      ['leaving', 1, 'active', [...PROPOSED_STAFF_CHECKLISTS.leaving]],
    ]);
  });

  it.each(['joining', 'leaving'] as const)(
    'a %s checklist is built from its own template, once',
    async (event) => {
      const r = await start(hr, teacher.staffId, event);
      expect(r.status).toBe(201);
      const c = await getStaffChecklist(ctx.db, hr, r.data!.id);
      expect(c.items.map((i) => [i.label, i.status])).toEqual(
        PROPOSED_STAFF_CHECKLISTS[event].map((l) => [l, 'pending']),
      );
      expect((await start(hr, teacher.staffId, event)).status).toBe(409);
    },
  );

  it('item states record who and when; back to pending clears them', async () => {
    expect((await start(hr, outside.staffId, 'joining')).status).toBe(404); // outside HR's reach
    const { id } = (await start(ops, outside.staffId, 'joining')).data!;
    const [item] = await ctx.db
      .select()
      .from(opsStaffChecklistItems)
      .where(eq(opsStaffChecklistItems.checklistId, id as never));
    for (const [status, marked] of [
      ['done', true],
      ['not_applicable', true],
      ['pending', false],
    ] as const) {
      const r = await setItem(ops, item!.id, { status });
      expect(r.status).toBe(200);
      expect(r.data).toMatchObject({ status, doneBy: marked ? ops.id : null });
      expect(Boolean(r.data!.doneAt)).toBe(marked);
    }
  });

  it('a new template version leaves started checklists as they were', async () => {
    const r = await call<{ version: number }>(templateRoute, hr, 'checklist-templates', {
      event: 'joining',
      items: 'ID card issued\nLaptop issued',
    });
    expect(r.data).toMatchObject({ version: 2 });
    const [old] = await ctx.db
      .select()
      .from(opsStaffChecklistTemplates)
      .where(
        and(
          eq(opsStaffChecklistTemplates.event, 'joining'),
          eq(opsStaffChecklistTemplates.version, 1),
        ),
      );
    expect(old!.status).toBe('retired');
    const fresh = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher New' });
    const c = await getStaffChecklist(
      ctx.db,
      hr,
      (await start(hr, fresh.staffId, 'joining')).data!.id,
    );
    expect(c.items.map((i) => i.label)).toEqual(['ID card issued', 'Laptop issued']);
    expect(c.version).toBe(2);
  });
});

describe('assets', () => {
  it('a tag is out with one person at a time', async () => {
    const other = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Tag' });
    const first = await issue(hr, teacher.staffId, { tag: 'SAMPLE-LAP-1' });
    expect(first.status).toBe(201);
    expect((await issue(hr, other.staffId, { tag: 'SAMPLE-LAP-1' })).status).toBe(409);
    expect((await giveBack(hr, first.data!.id, addDays(today, -400))).status).toBe(400);
    expect((await giveBack(hr, first.data!.id)).status).toBe(200);
    expect((await giveBack(hr, first.data!.id)).status).toBe(409);
    expect((await issue(hr, other.staffId, { tag: 'SAMPLE-LAP-1' })).status).toBe(201);
  });

  it('the download lists the register as CSV', async () => {
    const res = await exportRoute(authedRequest(hr, `${API}/staff-records/assets?view=all`), {
      params: Promise.resolve({ list: 'assets' }),
    });
    expect(res.headers.get('content-type')).toContain('text/csv');
    const csv = await res.text();
    expect(csv).toContain('Issued to');
    expect(csv).toContain('SAMPLE-LAP-1');
  });
});

describe('the leaver hand-over notice', () => {
  it('lists unreturned assets and open leaving items', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const leaver = await staffUser(ctx.db, ['teacher'], { name: 'Sample Leaver Assets' });
    expect(
      (await issue(hr, leaver.staffId, { assetType: 'Office key', tag: 'SAMPLE-KEY-9' })).status,
    ).toBe(201);
    const { id } = (await start(hr, leaver.staffId, 'leaving')).data!;
    const [first] = await ctx.db
      .select()
      .from(opsStaffChecklistItems)
      .where(eq(opsStaffChecklistItems.checklistId, id as never));
    await setItem(hr, first!.id, { status: 'done' });
    const r = await callRoute(
      staffAction,
      authedRequest(hr, `${API}/staff/${leaver.staffId}/end-employment`, {
        method: 'POST',
        json: { leftOn: today, reason: 'Resigned (test)' },
      }),
      { id: leaver.staffId, action: 'end-employment' },
    );
    expect(r.status).toBe(200);
    const [note] = await ctx.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.kind, 'staff.employment_ended'),
          eq(notifications.userId, ops.id),
          eq(notifications.entityId, leaver.staffId),
        ),
      );
    expect(note!.body).toContain('1 unreturned asset: Office key (SAMPLE-KEY-9)');
    expect(note!.body).toContain(
      `4 open leaving checklist items: ${PROPOSED_STAFF_CHECKLISTS.leaving.slice(1).join(', ')}`,
    );
    // After leaving, the key can still be returned.
    const [asset] = await ctx.db
      .select()
      .from(opsStaffAssets)
      .where(eq(opsStaffAssets.tag, 'SAMPLE-KEY-9'));
    expect((await giveBack(hr, asset!.id)).status).toBe(200);
  });
});

describe('permissions and reach', () => {
  it('401 signed out', async () => {
    expect((await callRoute(assetRoute, buildRequest(`${API}/assets`, { json: {} }))).status).toBe(
      401,
    );
  });

  it.each([
    ['a director (read only) issuing', () => issue(director, teacher.staffId), 403],
    ['a counsellor starting a checklist', () => start(counsellor, teacher.staffId, 'leaving'), 403],
    [
      'a director publishing a template',
      () =>
        call(templateRoute, director, 'checklist-templates', { event: 'leaving', items: 'X item' }),
      403,
    ],
    ['HR outside its department scope', () => issue(hr, outside.staffId), 404],
    ['HR on its own record', () => issue(hr, hr.staffId), 403],
    [
      'an issue date in the future',
      () => issue(hr, teacher.staffId, { issuedOn: addDays(today, 2) }),
      400,
    ],
    [
      'a counsellor downloading',
      () =>
        exportRoute(authedRequest(counsellor, `${API}/staff-records/assets`), {
          params: Promise.resolve({ list: 'assets' }),
        }).then((r) => ({ status: r.status })),
      403,
    ],
  ])('refuses %s', async (_n, run, status) => {
    expect((await run()).status).toBe(status);
  });
});
