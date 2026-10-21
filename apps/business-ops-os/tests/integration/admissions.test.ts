import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  authedRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import {
  integrationEvents,
  notifications,
  opsAdmissions,
  opsAdmissionTransitions,
} from '@elevate/database';
import { publishEvent, withTransaction } from '@elevate/server-kit';
import { enrolmentKeys } from '@elevate/shared-contracts';
import { POST as createLead } from '../../src/app/api/v1/leads/route';
import { POST as activity } from '../../src/app/api/v1/leads/[id]/activities/route';
import { POST as counselling } from '../../src/app/api/v1/appointments/route';
import { PATCH as counsellingUpdate } from '../../src/app/api/v1/appointments/[id]/route';
import { POST as demo } from '../../src/app/api/v1/demos/route';
import { POST as demoSession } from '../../src/app/api/v1/demos/[id]/sessions/[sessionId]/route';
import { GET as getAdmission } from '../../src/app/api/v1/admissions/[id]/route';
import { POST as transition } from '../../src/app/api/v1/admissions/[id]/transitions/route';
import { POST as check } from '../../src/app/api/v1/admissions/[id]/checks/route';
import { POST as feeApproval } from '../../src/app/api/v1/admissions/[id]/fee-approval/route';
import { POST as requestEnrolment } from '../../src/app/api/v1/admissions/[id]/enrolment-request/route';
import { POST as runJob } from '../../src/app/api/v1/jobs/[job]/route';
import { processEnrolmentReplies } from '../../src/server/enrolment';
import { isoDaysFromNow, phone, setupReference, staffUser, type StaffUser } from './fixtures';
import { admit } from './admissions-fixtures';
import { CONVERT_BODY, convertDemoAs } from './conversion-fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let colleague: StaffUser;
let director: TestUser;

const post = (user: { token: string }, json: unknown, headers?: Record<string, string>) =>
  authedRequest(user, '/ops/api/v1/x', { method: 'POST', json, headers });
/** HTTP status of a POST by `user`. */
const status = async (
  route: Parameters<typeof callRoute>[0],
  user: { token: string },
  json: unknown,
  params: Record<string, string>,
) => (await callRoute(route, post(user, json), params)).status;
const admissionRow = async (id: string) =>
  (
    await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, id as never))
  )[0];

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  colleague = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  director = await createTestUser(ctx.db, { roles: ['director'] });
});

/** Walk a fresh lead to `admission_pending` through the real routes. */
async function pendingAdmission() {
  const lead = await callRoute<{ lead: { id: string }; admission: { id: string } }>(
    createLead,
    post(counsellor, {
      studentName: 'Pipeline Test',
      studentPhone: phone(),
      guardianName: 'Parent Test',
      guardianRelationship: 'mother',
      guardianPhone: phone(),
      programmeCode: 'IPMAT',
      sourceCode: 'WEBINAR',
    }),
  );
  const { id: leadId } = lead.data!.lead;
  const admissionId = lead.data!.admission.id;
  await callRoute(activity, post(counsellor, { kind: 'call', outcome: 'connected_two_way' }), {
    id: leadId,
  });
  const s = await callRoute<{ id: string }>(
    counselling,
    post(counsellor, {
      admissionId,
      type: 'student_counselling',
      startsAt: new Date(Date.now() - 86_400_000).toISOString(),
      mode: 'offline',
    }),
  );
  expect(s.status).toBe(201);
  const done = { action: 'complete', outcome: 'Wants a demo' };
  expect(await status(counsellingUpdate, counsellor, done, { id: s.data!.id })).toBe(200);
  const at = (days: number) => `${isoDaysFromNow(days)}T10:00:00+05:30`;
  const bad = await callRoute(
    demo,
    post(counsellor, { admissionId, sessions: [{ startsAt: at(-3), subject: 'Quant' }] }),
  );
  expect(bad.status).toBe(400); // admissions.demo.day_count: 3
  const d = await callRoute<{
    id: string;
    feeAmountPaise: number;
    feeTermsState: string;
    sessions: { id: string }[];
  }>(
    demo,
    post(counsellor, {
      admissionId,
      sessions: [-4, -3, -2].map((day) => ({ startsAt: at(day), subject: 'Quant' })),
    }),
  );
  expect(d.status).toBe(201);
  expect(d.data).toMatchObject({ feeAmountPaise: 100_000, feeTermsState: 'approved' }); // D-045
  for (const s of d.data!.sessions)
    // all sessions attended → case demo_attended
    expect(
      await status(
        demoSession,
        counsellor,
        { action: 'attendance', attendance: 'present' },
        {
          id: d.data!.id,
          sessionId: s.id,
        },
      ),
    ).toBe(200);
  const t = await callRoute<{ status: string }>(
    transition,
    post(counsellor, { to: 'admission_pending' }),
    { id: admissionId },
  );
  expect(t.data?.status).toBe('admission_pending');
  return { leadId, admissionId, demoId: d.data!.id };
}

async function completeChecks(admissionId: string) {
  for (const itemKey of [
    'admission_form',
    'documents_verified',
    'fee_verification_1',
    'down_payment_verified',
  ])
    expect(
      await status(
        check,
        counsellor,
        { itemKey, status: 'done', reference: 'ref (test)' },
        {
          id: admissionId,
        },
      ),
    ).toBe(200);
  const second = { itemKey: 'fee_verification_2', status: 'done' };
  expect(await status(check, colleague, second, { id: admissionId })).toBe(403); // not their admission
  expect(await status(check, manager, second, { id: admissionId })).toBe(200);
}

/** Demo → conversion → password-confirmed admission (D-040/D-041): enrolment attempt 1 is published. */
async function admitted() {
  const ids = await pendingAdmission();
  const c = await convertDemoAs(counsellor, ids.demoId, {
    ...CONVERT_BODY,
    programmeCodes: ['CLASS_12', 'IPMAT'],
  });
  expect(c.error).toBeUndefined();
  const a = await admit({ counsellor, manager, director }, ids.admissionId);
  return { ...ids, eventId: a.eventId };
}

/** Academic rejects the current request: the case is `admitted` again, ready for a new request. */
async function rejectedBack() {
  const ids = await admitted();
  await reply('rejected', ids.admissionId, ids.leadId, ids.eventId);
  await processEnrolmentReplies(ctx.db);
  expect((await admissionRow(ids.admissionId))?.status).toBe('admitted');
  return ids;
}

const eventsFor = (admissionId: string) =>
  ctx.db
    .select()
    .from(integrationEvents)
    .where(
      and(
        eq(integrationEvents.type, 'ops.admission.enrolment_requested'),
        eq(integrationEvents.producer, 'ops'),
      ),
    )
    .then((rows) =>
      rows.filter((r) => (r.payload as { admissionId: string }).admissionId === admissionId),
    );

const confirmedPayload = (requestEventId: string, admissionId: string, leadId: string) => ({
  requestEventId: requestEventId as never,
  admissionId: admissionId as never,
  leadId: leadId as never,
  enrolmentId: crypto.randomUUID() as never,
  studentId: crypto.randomUUID() as never,
  existingStudent: false,
  programmeCode: 'IPMAT',
  confirmedAt: new Date().toISOString() as never,
  confirmedByUserId: null,
});

async function reply(
  type: 'confirmed' | 'rejected',
  admissionId: string,
  leadId: string,
  requestEventId: string,
) {
  return withTransaction(ctx.db, (tx) =>
    type === 'confirmed'
      ? publishEvent(tx, {
          type: 'academic.enrolment.confirmed',
          version: 1,
          idempotencyKey: enrolmentKeys.reply(requestEventId),
          correlationId: requestEventId,
          payload: confirmedPayload(requestEventId, admissionId, leadId),
        })
      : publishEvent(tx, {
          type: 'academic.enrolment.rejected',
          version: 1,
          idempotencyKey: enrolmentKeys.reply(requestEventId),
          correlationId: requestEventId,
          payload: {
            requestEventId: requestEventId as never,
            admissionId: admissionId as never,
            leadId: leadId as never,
            reasonCode: 'BATCH_FULL',
            reason: 'Batch is full (test)',
            rejectedAt: new Date().toISOString() as never,
            rejectedByUserId: null,
          },
        }),
  );
}

describe('admission confirmation gate (BR-OPS-6/7)', () => {
  it('cannot confirm without the checklist and an authorised approval; the demo fee alone never counts', async () => {
    const { admissionId } = await pendingAdmission();
    const early = await callRoute(transition, post(counsellor, { to: 'admitted' }), {
      id: admissionId,
    });
    expect(early.status).toBe(409);
    expect((early.error?.details as { missing: string[] }).missing).toEqual(
      expect.arrayContaining(['No active fee agreement approved by an authorised approver']),
    );
    await callRoute(check, post(counsellor, { itemKey: 'fee_verification_1', status: 'done' }), {
      id: admissionId,
    });
    const same = await callRoute(
      check,
      post(counsellor, { itemKey: 'fee_verification_2', status: 'done' }),
      { id: admissionId },
    );
    expect(same.status).toBe(409); // two different people (BR-OPS-7)
  });

  it('fee approval: counsellor cannot approve (403); requester cannot self-approve; director can', async () => {
    const { admissionId } = await pendingAdmission();
    await completeChecks(admissionId);
    for (const [user, action, code] of [
      [manager, 'request', 200],
      [counsellor, 'approve', 403],
      [manager, 'approve', 403], // the requester cannot self-approve
      [director, 'approve', 200],
    ] as const)
      expect(await status(feeApproval, user, { action }, { id: admissionId })).toBe(code);
    // Approvals alone never admit: only the password-confirmed final approval does (D-041).
    const res = await callRoute(transition, post(counsellor, { to: 'admitted' }), {
      id: admissionId,
    });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.error)).toContain('Confirm admission');
  });

  it('enrolled cannot be set by a person; illegal jumps are 409', async () => {
    const { admissionId } = await pendingAdmission();
    const id = { id: admissionId };
    expect(await status(transition, manager, { to: 'enrolled' }, id)).toBe(409);
    expect(await status(transition, manager, { to: 'new' }, id)).toBe(409);
    expect(await status(transition, manager, { to: 'lost' }, id)).toBe(400); // reason required
  });
});

describe('enrolment handoff (outbox)', () => {
  it('confirmation publishes exactly one request event in the same transaction; a second request is refused', async () => {
    const { admissionId, eventId } = await admitted();
    const first = { data: { eventId } };
    const second = await callRoute(requestEnrolment, post(counsellor, {}), { id: admissionId });
    expect(second.status).toBe(409);
    const events = await eventsFor(admissionId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      idempotencyKey: enrolmentKeys.request(admissionId, 1),
      version: 1,
      id: first.data!.eventId,
    });
    expect(events[0]?.payload).toMatchObject({
      attempt: 1,
      programmeCode: 'IPMAT',
      counsellorStaffId: counsellor.staffId,
      guardian: { relationship: 'mother' },
    });
    const detail = await callRoute<{ admission: { status: string; handoffStatus: string } }>(
      getAdmission,
      authedRequest(counsellor, '/x'),
      { id: admissionId },
    );
    expect(detail.data?.admission).toMatchObject({
      status: 'enrolment_requested',
      handoffStatus: 'pending',
    });
  });

  it('an Idempotency-Key retry replays the stored response and still yields one event', async () => {
    const { admissionId } = await rejectedBack();
    const headers = { 'idempotency-key': `test-only-${admissionId}` };
    const a = await callRoute<{ eventId: string }>(
      requestEnrolment,
      post(counsellor, {}, headers),
      { id: admissionId },
    );
    const b = await callRoute<{ eventId: string }>(
      requestEnrolment,
      post(counsellor, {}, headers),
      { id: admissionId },
    );
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get('idempotency-replayed')).toBe('true');
    expect(b.data?.eventId).toBe(a.data?.eventId);
    expect(await eventsFor(admissionId)).toHaveLength(2); // attempt 1 (rejected) + this one
  });

  it('a failing payload rolls the status back (no event, still admitted)', async () => {
    const { admissionId } = await rejectedBack();
    await ctx.db
      .update(opsAdmissions)
      .set({ programmeId: null })
      .where(eq(opsAdmissions.id, admissionId as never));
    expect(await status(requestEnrolment, counsellor, {}, { id: admissionId })).toBe(400);
    expect(await eventsFor(admissionId)).toHaveLength(1); // only the rejected attempt 1
    expect((await admissionRow(admissionId))?.status).toBe('admitted');
  });

  it('confirmed reply → enrolled; processed twice → one transition; counsellor notified', async () => {
    const { admissionId, leadId, eventId } = await admitted();
    await reply('confirmed', admissionId, leadId, eventId);
    const run1 = await callRoute<{ processed: number }>(runJob, post(manager, {}), {
      job: 'enrolment-replies',
    });
    expect(run1.data?.processed).toBeGreaterThanOrEqual(1);
    const run2 = await processEnrolmentReplies(ctx.db);
    expect(run2.processed).toBe(0);
    const transitions = await ctx.db
      .select()
      .from(opsAdmissionTransitions)
      .where(
        and(
          eq(opsAdmissionTransitions.admissionId, admissionId as never),
          eq(opsAdmissionTransitions.toStatus, 'enrolled'),
        ),
      );
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ actorType: 'system', actorUserId: null });
    const row = await admissionRow(admissionId);
    expect(row).toMatchObject({ status: 'enrolled', handoffStatus: 'enrolled' });
    expect(row?.academicStudentId).not.toBeNull();
    const notes = await ctx.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, counsellor.id), eq(notifications.kind, 'enrolment.confirmed')),
      );
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(await status(runJob, counsellor, {}, { job: 'enrolment-replies' })).toBe(403);
  });

  it('rejected reply → back to admitted with the reason; re-request is attempt 2 with a new key; stale replies are ignored', async () => {
    const { admissionId, leadId, eventId } = await admitted();
    const req1 = { data: { eventId } };
    await reply('rejected', admissionId, leadId, req1.data!.eventId);
    await processEnrolmentReplies(ctx.db);
    expect(await admissionRow(admissionId)).toMatchObject({
      status: 'admitted',
      handoffStatus: 'rejected',
      rejectionCode: 'BATCH_FULL',
    });
    const req2 = await callRoute<{ attempt: number; eventId: string }>(
      requestEnrolment,
      post(counsellor, {}),
      { id: admissionId },
    );
    expect(req2.data?.attempt).toBe(2);
    expect((await eventsFor(admissionId)).map((e) => e.idempotencyKey).sort()).toEqual([
      enrolmentKeys.request(admissionId, 1),
      enrolmentKeys.request(admissionId, 2),
    ]);
    // A (duplicate) confirmation for attempt 1 arriving late is ignored.
    await withTransaction(ctx.db, (tx) =>
      publishEvent(tx, {
        type: 'academic.enrolment.confirmed',
        version: 1,
        idempotencyKey: `test-only-late-${req1.data!.eventId}`,
        payload: confirmedPayload(req1.data!.eventId, admissionId, leadId),
      }),
    );
    await processEnrolmentReplies(ctx.db);
    expect((await admissionRow(admissionId))?.status).toBe('enrolment_requested');
  });
});
