/**
 * Convert to admission → application draft (owner brief §6). Numbers: applications.test.ts. Fictional data only.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import {
  auditEvents,
  opsAdmissionNumberChanges,
  opsAdmissions,
  opsAdmissionTransitions,
  opsApplications,
  opsDemos,
  students,
} from '@elevate/database';
import {
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { GET as preview, POST as convert } from '../../src/app/api/v1/demos/[id]/convert/route';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { get, post } from './admissions-fixtures';
import {
  CONVERT_BODY,
  convertDemoAs,
  demoCase as baseDemoCase,
  type Converted,
} from './conversion-fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let colleague: StaffUser;
let auditor: TestUser;

const demoCase = (options: Parameters<typeof baseDemoCase>[2] = {}) =>
  baseDemoCase(ctx.db, counsellor, options);
const BODY = CONVERT_BODY;
const run = convertDemoAs;

const total = async (table: typeof students | typeof opsAdmissionNumberChanges) =>
  (await ctx.db.select({ n: count() }).from(table))[0]!.n;

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  colleague = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
});

describe('POST /demos/{id}/convert — access and validation', () => {
  it('401 signed out, 403 auditor and out-of-scope counsellor, 400 invalid body or combination', async () => {
    const { demoId } = await demoCase();
    const anon = buildRequest('/ops/api/v1/x', { method: 'POST', json: BODY });
    expect((await callRoute(convert, anon, { id: demoId })).status).toBe(401);
    expect((await run(auditor, demoId)).status).toBe(403);
    expect((await run(colleague, demoId)).status).toBe(403);
    for (const bad of [
      { ...BODY, identityVerified: false },
      { ...BODY, programmeCodes: ['CLAT', 'IPMAT'] },
      { ...BODY, programmeCodes: ['CLASS_11', 'CLASS_12'] },
      { ...BODY, effectiveDate: 'soon' },
    ])
      expect((await run(counsellor, demoId, bad)).status).toBe(400);
    expect((await callRoute(preview, get(colleague), { id: demoId })).status).toBe(403);
  });
});

describe('conversion', () => {
  it('converts once in one transaction: identity, application draft, demo preserved as converted, audit; no number; a retry replays', async () => {
    const { demoId, admissionId } = await demoCase();
    const pre = await callRoute<{ admission: { convertible: boolean } }>(preview, get(counsellor), {
      id: demoId,
    });
    expect(pre.data?.admission.convertible).toBe(true);
    const first = await run(counsellor, demoId, BODY, 'test-only-convert-1');
    expect(first.status).toBe(201);
    expect(first.data).toMatchObject({ admissionId, status: 'admission_pending' });
    const replay = await callRoute<Converted>(
      convert,
      post(counsellor, BODY, { 'idempotency-key': 'test-only-convert-1' }),
      { id: demoId },
    );
    expect(replay.data).toEqual(first.data);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect((await run(counsellor, demoId, BODY, 'test-only-convert-2')).status).toBe(409);

    const [demo] = await ctx.db
      .select()
      .from(opsDemos)
      .where(eq(opsDemos.id, demoId as never));
    expect(demo).toMatchObject({ outcome: 'converted', convertedAdmissionId: admissionId });
    const [a] = await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, admissionId as never));
    expect(a).toMatchObject({ studentId: first.data!.studentId, admissionNumber: null });
    const reasons = await ctx.db
      .select({ to: opsAdmissionTransitions.toStatus, reason: opsAdmissionTransitions.reason })
      .from(opsAdmissionTransitions)
      .where(eq(opsAdmissionTransitions.admissionId, admissionId as never));
    expect(reasons).toContainEqual({ to: 'admission_pending', reason: 'Converted after the demo' });
    const [app] = await ctx.db
      .select()
      .from(opsApplications)
      .where(eq(opsApplications.id, first.data!.id as never));
    expect(app).toMatchObject({ admissionId, status: 'draft', origin: 'demo', demoId });
    expect(
      await ctx.db.$count(
        opsAdmissionNumberChanges,
        eq(opsAdmissionNumberChanges.admissionId, admissionId as never),
      ),
    ).toBe(0);
    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.entityId, admissionId), eq(auditEvents.action, 'admission.converted')),
      );
    expect(audits).toHaveLength(1);
  });

  it('10 parallel conversions give 10 applications with unique references and no numbers', async () => {
    const cases = [];
    for (let i = 0; i < 10; i++) cases.push(await demoCase());
    const results = await Promise.all(cases.map((c) => run(manager, c.demoId)));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(new Set(results.map((r) => r.data!.reference)).size).toBe(10);
    expect(results.every((r) => !('admissionNumber' in r.data!))).toBe(true);
  });

  it('a shared guardian contact never merges siblings: each keeps the identity linked at booking', async () => {
    const guardianPhone = '+91 98111 22233';
    const first = await demoCase({ extra: { guardianPhone } });
    const firstDone = await run(counsellor, first.demoId);
    const sibling = await demoCase({
      extra: {
        guardianPhone,
        acknowledgeDuplicates: { reason: 'Sibling of an existing student (test)' },
      },
    });
    const before = await total(students);
    const separate = await run(counsellor, sibling.demoId);
    expect(separate.status).toBe(201);
    expect(separate.data?.studentId).not.toBe(firstDone.data!.studentId);
    expect(await total(students)).toBe(before); // reused, not created again
  });

  it('a cohort + entrance combination opens a second case for the same student', async () => {
    const c = await demoCase();
    const r = await run(counsellor, c.demoId, { ...BODY, programmeCodes: ['CLASS_12', 'CLAT'] });
    expect(r.status).toBe(201);
    expect(r.data?.extraAdmissionIds).toHaveLength(1);
    const [extra] = await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, r.data!.extraAdmissionIds[0] as never));
    expect(extra).toMatchObject({
      status: 'admission_pending',
      studentId: r.data!.studentId,
      admissionNumber: null,
    });
  });
});
