/** Global search: groups by permission, own scope per group, contact search gated and audited. Fictional data only. */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditEvents, opsDemos } from '@elevate/database';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { globalSearch } from '../../src/server/search';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { demoCase } from './conversion-fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let colleague: StaffUser;
let demoOnly: StaffUser;
let director: TestUser;
let coordinator: TestUser;
let c: Awaited<ReturnType<typeof demoCase>>;
const PHONE = '+91 98765 43210';

const search = (user: TestUser, q: string) => globalSearch(ctx.db, user, q);
const ids = (r: Awaited<ReturnType<typeof search>>, key: string) =>
  r.groups.find((g) => g.key === key)?.hits.map((h) => h.id);
const contactAudits = (user: TestUser) =>
  ctx.db
    .select()
    .from(auditEvents)
    .where(
      and(eq(auditEvents.action, 'student.contact_search'), eq(auditEvents.actorUserId, user.id)),
    );

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  colleague = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  demoOnly = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  director = await createTestUser(ctx.db, { roles: ['director'] });
  coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
  c = await demoCase(ctx.db, counsellor, {
    name: 'Searchable Fixture Aanya',
    extra: { studentPhone: PHONE },
  });
});

describe('global search', () => {
  it('finds by name in every readable group, within own scope; unreadable groups are left out', async () => {
    const mine = await search(counsellor, 'fixture  aanya');
    expect(mine.groups.map((g) => g.key)).toEqual(['leads', 'demos', 'applications', 'students']);
    expect(ids(mine, 'leads')).toEqual([c.leadId]);
    expect(ids(mine, 'demos')).toEqual([c.demoId]);
    expect(mine.groups.find((g) => g.key === 'leads')?.hits[0]?.phone).toMatch(
      /^\+91 •••• ••32 10$/,
    );
    expect(ids(await search(colleague, 'fixture aanya'), 'leads')).toEqual([]);
    expect(ids(await search(director, 'fixture aanya'), 'leads')).toEqual([c.leadId]);
    expect((await search(coordinator, 'fixture aanya')).groups.map((g) => g.key)).toEqual([
      'students',
    ]);
    expect((await search(manager, 'a')).groups).toEqual([]);
  });

  it("a counsellor who is only the demo's counsellor finds that demo, not the lead", async () => {
    await ctx.db
      .update(opsDemos)
      .set({ counsellorStaffId: demoOnly.staffId })
      .where(eq(opsDemos.id, c.demoId as never));
    const r = await search(demoOnly, 'fixture aanya');
    expect(ids(r, 'demos')).toEqual([c.demoId]);
    expect(ids(r, 'leads')).toEqual([]);
  });

  it('phone search only with student_private:read, masked in the audit trail', async () => {
    const full = await search(counsellor, '98765-43210');
    expect(ids(full, 'leads')).toEqual([c.leadId]);
    expect(ids(full, 'demos')).toEqual([c.demoId]);
    expect(ids(await search(manager, '43210'), 'leads')).toEqual([c.leadId]);
    expect(ids(await search(colleague, '98765 43210'), 'leads')).toEqual([]);
    const audits = await contactAudits(counsellor);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toMatchObject({ kind: 'phone', view: 'global_search' });
    expect(JSON.stringify(audits)).not.toContain('9876543210');

    const denied = await search(director, '98765 43210');
    expect(denied.contactDenied).toBe(true);
    expect(ids(denied, 'leads')).toEqual([]);
    expect((await search(director, 'fixture aanya')).groups[0]?.hits[0]?.phone).toBeNull();
    expect(await contactAudits(director)).toEqual([]);
  });
});
