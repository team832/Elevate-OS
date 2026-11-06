/**
 * Certificates (F4-02): refused until the owner approves the wording; numbered per type per
 * financial year without gaps; the wording filled from the record and kept; a missing value
 * refuses instead of printing a blank; Duplicate on reprint; revoke with a reason; issue =
 * ops:certificates:issue, read = student readers in their scope. Fictional people only.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  auditEvents,
  opsAdmissions,
  opsCertificates,
  opsSettings,
  students,
} from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { GET as register, POST as issueRoute } from '../../src/app/api/v1/certificates/route';
import { GET as pdfRoute, POST as revokeRoute } from '../../src/app/api/v1/certificates/[id]/route';
import { SETTING_DEFINITIONS } from '../../src/domain/policies';
import { issueCertificate, type CertificateListItem } from '../../src/server/certificates';
import { pendingCase, post } from './admissions-fixtures';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const printed = vi.hoisted(() => [] as CertificateListItem[]);
vi.mock('../../src/server/pdf/certificate', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/server/pdf/certificate')>();
  return {
    certificatePdf: async (item: CertificateListItem) => {
      printed.push(item);
      return real.certificatePdf(item);
    },
  };
});

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let colleague: StaffUser;
let finance: StaffUser;
let director: TestUser;
let coordinator: TestUser;
let admissionId: string;

const defaults = SETTING_DEFINITIONS['certificates.types'].defaultValue;
const WORDING = {
  numberPrefix: 'EC',
  types: [
    {
      ...defaults.types[1]!,
      template:
        'This is to certify that {student}, admission number {admission number}, studies {programme} at {institute}.',
    },
    defaults.types[0]!, // course completion: needs {academic year}
  ],
};
const issue = (who: { token: string }, type = 'bonafide') =>
  callRoute<{ id: string; certificateNumber: string; body: string }>(
    issueRoute,
    post(who, { admissionId, type }),
  );
const pdf = (who: { token: string } | null, id: string) =>
  pdfRoute(who ? authedRequest(who, `/ops/api/v1/certificates/${id}`) : buildRequest('/x'), {
    params: Promise.resolve({ id }),
  });

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  colleague = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  finance = await staffUser(ctx.db, ['finance_officer']);
  director = await createTestUser(ctx.db, { roles: ['director'] });
  coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
  ({ admissionId } = await pendingCase(counsellor, { name: 'Sample Certificate Student' }));
  const [s] = await ctx.db
    .insert(students)
    .values({ fullName: 'Sample Certificate Student', isSample: false })
    .returning();
  await ctx.db
    .update(opsAdmissions)
    .set({ studentId: s!.id })
    .where(eq(opsAdmissions.id, admissionId as never));
});

describe('issuing', () => {
  it('is refused until the owner approves the wording', async () => {
    const r = await issue(manager);
    expect(r.status).toBe(409);
    expect(r.error?.message).toMatch(/not approved yet/);
  });

  it('refuses a wording value the record does not have, instead of printing a blank', async () => {
    await ctx.db.insert(opsSettings).values({
      key: 'certificates.types',
      value: WORDING,
      decisionState: 'approved',
      source: 'test-only approval',
    });
    const r = await issue(manager);
    expect(r.status).toBe(409);
    expect(r.error?.message).toMatch(/admission number/);
  });

  it('numbers each type in its own gap-free series and keeps the wording as printed', async () => {
    await ctx.db
      .update(opsAdmissions)
      .set({ admissionNumber: 'EE-T-0001' })
      .where(eq(opsAdmissions.id, admissionId as never));
    const a = await issue(manager);
    const b = await issue(director);
    expect(a.status).toBe(201);
    expect(a.data!.certificateNumber).toBe('EC/BONAFIDE/2026-27/0001');
    expect(b.data!.certificateNumber).toBe('EC/BONAFIDE/2026-27/0002');
    expect(a.data!.body).toBe(
      'This is to certify that Sample Certificate Student, admission number EE-T-0001, studies IPMAT preparation at Elevate Education.',
    );
    const c = await issue(manager, 'course_completion');
    expect(c.status).toBe(409);
    expect(c.error?.message).toMatch(/academic year/);
    expect((await issue(manager, 'character')).status).toBe(400);
  });

  it('takes the financial year of the IST issue day (1 April starts a new series)', async () => {
    const row = await issueCertificate(
      ctx.db,
      manager,
      { admissionId, type: 'bonafide' },
      undefined,
      new Date('2027-03-31T18:30:00Z'),
    );
    expect(row.certificateNumber).toBe('EC/BONAFIDE/2027-28/0001');
  });

  it.each([
    ['the counsellor', () => counsellor, 403],
    ['finance', () => finance, 403],
    ['the coordinator', () => coordinator, 403],
  ])('%s may not issue', async (_n, who, status) => {
    expect((await issue(who())).status).toBe(status);
  });
});

describe('reading, reprints and revoking', () => {
  let id: string;
  beforeAll(async () => {
    id = (
      await ctx.db
        .select({ id: opsCertificates.id })
        .from(opsCertificates)
        .where(eq(opsCertificates.certificateNumber, 'EC/BONAFIDE/2026-27/0001'))
    )[0]!.id;
  });

  it.each([
    ['nobody signed in', () => null, 401],
    ['another counsellor', () => colleague, 403],
    ['the counsellor of the student', () => counsellor, 200],
    ['the coordinator (students read)', () => coordinator, 200],
  ])('PDF for %s: %i', async (_n, who, status) => {
    expect((await pdf(who(), id)).status).toBe(status);
  });

  it('the second print says Duplicate', () => {
    expect(printed.map((p) => p.c.printCount)).toEqual([1, 2]);
  });

  it('the register download follows the reader’s scope', async () => {
    const csv = async (who: { token: string }) =>
      (
        await register(authedRequest(who, '/ops/api/v1/certificates?type=bonafide'), {
          params: Promise.resolve({}),
        })
      ).text();
    expect((await csv(manager)).match(/EC\/BONAFIDE/g)).toHaveLength(3);
    expect((await csv(counsellor)).match(/EC\/BONAFIDE/g)).toHaveLength(3);
    expect(await csv(colleague)).not.toContain('EC/BONAFIDE');
  });

  it('revoking needs the issue permission and a reason, happens once, and stays in the register', async () => {
    const revoke = (who: { token: string }, reason: string) =>
      callRoute<{ status: string }>(revokeRoute, post(who, { reason }), { id });
    expect((await revoke(counsellor, 'Issued in error')).status).toBe(403);
    expect((await revoke(manager, 'no')).status).toBe(400);
    expect((await revoke(manager, 'Issued in error')).data?.status).toBe('revoked');
    expect((await revoke(manager, 'Issued in error')).status).toBe(409);
    await pdf(manager, id);
    expect(printed.at(-1)!.c).toMatchObject({ revokeReason: 'Issued in error', printCount: 3 });
    const audits = await ctx.db.select().from(auditEvents).where(eq(auditEvents.entityId, id));
    expect(audits.map((a) => a.action).sort()).toEqual([
      'certificate.issued',
      'certificate.revoked',
    ]);
  });
});

describe('sample records', () => {
  it('number in their own series; the next real certificate takes the next real number', async () => {
    const sample = await pendingCase(counsellor, { name: 'Sample Series Student' });
    const [s] = await ctx.db
      .insert(students)
      .values({ fullName: 'Sample Series Student', isSample: true })
      .returning();
    await ctx.db
      .update(opsAdmissions)
      .set({ studentId: s!.id, admissionNumber: 'EE-T-0002' })
      .where(eq(opsAdmissions.id, sample.admissionId as never));
    const one = await callRoute<{ certificateNumber: string }>(
      issueRoute,
      post(manager, { admissionId: sample.admissionId, type: 'bonafide' }),
    );
    expect(one.data!.certificateNumber).toBe('SAMPLE-EC/BONAFIDE/2026-27/0001');
    expect((await issue(manager)).data!.certificateNumber).toBe('EC/BONAFIDE/2026-27/0003');
  });
});
