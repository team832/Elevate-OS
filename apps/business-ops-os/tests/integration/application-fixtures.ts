/**
 * Walk an admission application to "signatures confirmed" (and on to confirmed) through the real
 * routes. The fee plan row and the declaration setting are fixture data (test-only text, never a
 * real declaration); everything else goes through the application services. Fictional data only.
 */
import { and, desc, eq } from 'drizzle-orm';
import { expect } from 'vitest';
import {
  approvals,
  opsApplicationForms,
  opsApplications,
  opsFeeInstalments,
  opsFeePlans,
  opsSettings,
  type Database,
} from '@elevate/database';
import { authedRequest, callRoute } from '@elevate/testing';
import { POST as createApplication } from '../../src/app/api/v1/applications/route';
import { PATCH as save } from '../../src/app/api/v1/applications/[id]/route';
import { POST as ready } from '../../src/app/api/v1/applications/[id]/ready/route';
import { POST as form } from '../../src/app/api/v1/applications/[id]/form/route';
import { POST as signatures } from '../../src/app/api/v1/applications/[id]/signatures/route';
import { POST as confirm } from '../../src/app/api/v1/applications/[id]/confirm/route';
import { POST as check } from '../../src/app/api/v1/admissions/[id]/checks/route';
import { POST as feeApproval } from '../../src/app/api/v1/admissions/[id]/fee-approval/route';
import { feeArrangementPolicy } from '../../src/server/approval-policies';
import { istToday } from '../../src/domain';
import { pendingCase, post, type Caller } from './admissions-fixtures';
import { isoDaysFromNow } from './fixtures';

export type People = {
  counsellor: Caller;
  manager: Caller;
  director: Caller & { password: string };
};
export const patch = (user: Caller, json: unknown) =>
  authedRequest(user, '/ops/api/v1/x', { method: 'PATCH', json });

export const TEST_DECLARATION = {
  text: 'test-only declaration text, not legal wording (fixture).',
  version: 'test-1',
};

/** Store a test-only approved declaration, whatever the real setting holds (tests stay independent). */
export async function setTestDeclaration(db: Database) {
  const row = { value: TEST_DECLARATION, decisionState: 'approved' };
  await db
    .insert(opsSettings)
    .values({ key: 'admissions.declarations', ...row })
    .onConflictDoUpdate({ target: opsSettings.key, set: row });
}

/** BR-OPS-7: two different verifiers, then the director approves the fee arrangement. */
export async function approveFees(people: People, admissionId: string) {
  const id = { id: admissionId };
  for (const [user, itemKey] of [
    [people.counsellor, 'documents_verified'],
    [people.counsellor, 'fee_verification_1'],
    [people.manager, 'fee_verification_2'],
  ] as const)
    expect((await callRoute(check, post(user, { itemKey, status: 'done' }), id)).status).toBe(200);
  expect(
    (await callRoute(feeApproval, post(people.counsellor, { action: 'request' }), id)).status,
  ).toBe(200);
  expect(
    (await callRoute(feeApproval, post(people.director, { action: 'approve' }), id)).status,
  ).toBe(200);
}

/** An active ₹1,00,000 plan (50/25/25) on the case, as the fees slice would leave it. */
export async function activePlan(
  db: Database,
  admissionId: string,
  studentId: string,
  createdBy: string,
) {
  const [approval] = await db
    .select()
    .from(approvals)
    .where(
      and(eq(approvals.policy, feeArrangementPolicy.key), eq(approvals.subjectId, admissionId)),
    )
    .orderBy(desc(approvals.requestedAt));
  const [plan] = await db
    .insert(opsFeePlans)
    .values({
      admissionId: admissionId as never,
      studentId: studentId as never,
      label: 'test-only annual plan',
      totalPaise: 100_000_00,
      academicYear: '2026-27',
      status: 'active',
      approvalId: approval!.id,
      approvedBy: approval!.decidedBy,
      approvedAt: approval!.decidedAt,
      createdBy: createdBy as never,
    })
    .returning();
  await db.insert(opsFeeInstalments).values(
    [50_000_00, 25_000_00, 25_000_00].map((amountPaise, i) => ({
      planId: plan!.id,
      sequence: i + 1,
      dueDate: isoDaysFromNow(30 + 90 * i),
      amountPaise,
    })),
  );
  return plan!;
}

export const KYC = {
  dateOfBirth: '2010-05-04',
  currentStage: 'class_12',
  previousSchool: 'Sample School',
  city: 'Sikar',
  address: 'Sample address, Sikar',
};

/** POST /applications/{id}/form and the id of the form row it stored. */
export async function printForm(db: Database, user: Caller, applicationId: string) {
  const res = await form(post(user, {}), { params: Promise.resolve({ id: applicationId }) });
  expect(res.status).toBe(200);
  const [row] = await db
    .select()
    .from(opsApplicationForms)
    .where(eq(opsApplicationForms.applicationId, applicationId as never))
    .orderBy(desc(opsApplicationForms.generatedAt));
  return { res, form: row! };
}

/** A direct admission (no demo) at "signatures confirmed", ready for the approver's password. */
export async function signedApplication(
  db: Database,
  people: People,
  options: { name?: string; applicationId?: string; admissionId?: string } = {},
) {
  await setTestDeclaration(db);
  let { admissionId, applicationId } = options;
  if (!admissionId)
    ({ admissionId } = await pendingCase(people.counsellor, { name: options.name }));
  if (!applicationId) {
    const created = await callRoute<{ id: string }>(
      createApplication,
      post(people.counsellor, { admissionId, academicYear: '2026-27' }),
    );
    expect(created.status).toBe(201);
    applicationId = created.data!.id;
  }
  const [app] = await db
    .select()
    .from(opsApplications)
    .where(eq(opsApplications.id, applicationId as never));
  await approveFees(people, app!.admissionId);
  await activePlan(db, app!.admissionId, app!.studentId, app!.createdBy);
  const saved = await callRoute<{ version: number }>(
    save,
    patch(people.counsellor, {
      version: app!.currentVersion,
      student: KYC,
      academicYear: '2026-27',
      intendedStartDate: '2026-11-01',
      deliveryMode: 'offline',
    }),
    { id: applicationId },
  );
  expect(saved.status).toBe(200);
  const version = saved.data!.version;
  const marked = await callRoute(ready, post(people.counsellor, { version }), {
    id: applicationId,
  });
  expect(marked.error).toBeUndefined();
  const { form: printed } = await printForm(db, people.counsellor, applicationId);
  const signed = await callRoute(
    signatures,
    post(people.counsellor, {
      version,
      formId: printed.id,
      signedOn: istToday(new Date()),
      studentSigned: true,
      guardianSigned: true,
    }),
    { id: applicationId },
  );
  expect(signed.status).toBe(201);
  return { admissionId: app!.admissionId, applicationId, version, studentId: app!.studentId };
}

export type Confirmed = {
  admissionNumber: string;
  admissionId: string;
  applicationVersion: number;
  replayed: boolean;
};

export const confirmAs = (user: Caller, applicationId: string, body: Record<string, unknown>) =>
  callRoute<Confirmed>(confirm, post(user, body), { id: applicationId });
