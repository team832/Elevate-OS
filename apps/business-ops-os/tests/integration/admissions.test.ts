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
  opsDemos,
} from '@elevate/database';
import { publishEvent, withTransaction } from '@elevate/server-kit';
import { enrolmentKeys } from '@elevate/shared-contracts';
import { POST as createLead } from '../../src/app/api/v1/leads/route';
import { POST as activity } from '../../src/app/api/v1/leads/[id]/activities/route';
import { POST as counselling } from '../../src/app/api/v1/counselling/route';
import { POST as counsellingUpdate } from '../../src/app/api/v1/counselling/[id]/route';
import { POST as demo } from '../../src/app/api/v1/demos/route';
import { POST as demoUpdate } from '../../src/app/api/v1/demos/[id]/route';
import { GET as getAdmission } from '../../src/app/api/v1/admissions/[id]/route';
import { POST as transition } from '../../src/app/api/v1/admissions/[id]/transitions/route';
import { POST as check } from '../../src/app/api/v1/admissions/[id]/checks/route';
import { POST as feeApproval } from '../../src/app/api/v1/admissions/[id]/fee-approval/route';
import { POST as requestEnrolment } from '../../src/app/api/v1/admissions/[id]/enrolment-request/route';
import { POST as runJob } from '../../src/app/api/v1/jobs/[job]/route';
import { processEnrolmentReplies } from '../../src/server/enrolment';
import { isoDaysFromNow, phone, setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let colleague: StaffUser;
let director: TestUser;

const post = (user: { token: string }, json: unknown, headers?: Record<string, string>) =>
  authedRequest(user, '/ops/api/v1/x', { method: 'POST', json, headers });

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
      studentName: 'Pipeline Test (fictional)',
      studentPhone: phone(),
      guardianName: 'Parent Test (fictional)',
      guardianRelationship: 'mother',
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
      scheduledAt: new Date(Date.now() - 86_400_000).toISOString(),
      mode: 'in_person',
    }),
  );
  expect(s.status).toBe(201);
  expect(
    (
      await callRoute(
        counsellingUpdate,
        post(counsellor, { action: 'complete', outcome: 'Wants a demo' }),
        { id: s.data!.id },
      )
    ).status,
  ).toBe(200);
  const bad = await callRoute(
    demo,
    post(counsellor, { admissionId, subjects: ['Quant'], dayDates: [isoDaysFromNow(-3)] }),
  );
  expect(bad.status).toBe(400); // demo terms: 2 days
  const d = await callRoute<{ id: string; feeAmountInr: string; feeTermsState: string }>(
    demo,
    post(counsellor, {
      admissionId,
      subjects: ['Quant', 'Verbal'],
      dayDates: [isoDaysFromNow(-3), isoDaysFromNow(-2)],
    }),
  );
  expect(d.status).toBe(201);
  expect(d.data).toMatchObject({ feeAmountInr: '1000.00', feeTermsState: 'pending_verification' });
  expect(
    (
      await callRoute(
        demoUpdate,
        post(counsellor, {
          action: 'record_fee',
          feeStatus: 'paid_verified',
          feeReference: 'RCPT-TEST-1',
        }),
        { id: d.data!.id },
      )
    ).status,
  ).toBe(200);
  expect(
    (await callRoute(demoUpdate, post(counsellor, { action: 'attended' }), { id: d.data!.id }))
      .status,
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
      (
        await callRoute(
          check,
          post(counsellor, { itemKey, status: 'done', reference: 'ref (test)' }),
          { id: admissionId },
        )
      ).status,
    ).toBe(200);
  expect(
    (
      await callRoute(check, post(colleague, { itemKey: 'fee_verification_2', status: 'done' }), {
        id: admissionId,
      })
    ).status,
  ).toBe(403); // not their admission
  expect(
    (
      await callRoute(check, post(manager, { itemKey: 'fee_verification_2', status: 'done' }), {
        id: admissionId,
      })
    ).status,
  ).toBe(200);
}

async function admitted() {
  const ids = await pendingAdmission();
  await completeChecks(ids.admissionId);
  expect(
    (await callRoute(feeApproval, post(counsellor, { action: 'request' }), { id: ids.admissionId }))
      .status,
  ).toBe(200);
  expect(
    (await callRoute(feeApproval, post(director, { action: 'approve' }), { id: ids.admissionId }))
      .status,
  ).toBe(200);
  const res = await callRoute<{ status: string }>(
    transition,
    post(counsellor, { to: 'admitted' }),
    { id: ids.admissionId },
  );
  expect(res.data?.status).toBe('admitted');
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

describe('admission confirmation gate (BR-OPS-6/7)', () => {
  it('cannot confirm without the checklist and an authorised approval; the demo fee alone never counts', async () => {
    const { admissionId } = await pendingAdmission();
    const early = await callRoute(transition, post(counsellor, { to: 'admitted' }), {
      id: admissionId,
    });
    expect(early.status).toBe(409);
    expect((early.error?.details as { missing: string[] }).missing).toEqual(
      expect.arrayContaining(['Fee arrangement not approved by an authorised approver']),
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
    expect(
      (await callRoute(feeApproval, post(manager, { action: 'request' }), { id: admissionId }))
        .status,
    ).toBe(200);
    expect(
      (await callRoute(feeApproval, post(counsellor, { action: 'approve' }), { id: admissionId }))
        .status,
    ).toBe(403);
    expect(
      (await callRoute(feeApproval, post(manager, { action: 'approve' }), { id: admissionId }))
        .status,
    ).toBe(403);
    expect(
      (await callRoute(feeApproval, post(director, { action: 'approve' }), { id: admissionId }))
        .status,
    ).toBe(200);
    const res = await callRoute<{ status: string }>(
      transition,
      post(counsellor, { to: 'admitted' }),
      { id: admissionId },
    );
    expect(res.data?.status).toBe('admitted');
    const [d] = await ctx.db
      .select()
      .from(opsDemos)
      .where(eq(opsDemos.admissionId, admissionId as never));
    expect(d?.feeStatus).toBe('adjusted_against_fees'); // demo terms: adjusted on joining
  });

  it('enrolled cannot be set by a person; illegal jumps are 409', async () => {
    const { admissionId } = await pendingAdmission();
    expect(
      (await callRoute(transition, post(manager, { to: 'enrolled' }), { id: admissionId })).status,
    ).toBe(409);
    expect(
      (await callRoute(transition, post(manager, { to: 'new' }), { id: admissionId })).status,
    ).toBe(409);
    expect(
      (await callRoute(transition, post(manager, { to: 'lost' }), { id: admissionId })).status,
    ).toBe(400); // reason required
  });
});

describe('enrolment handoff (outbox)', () => {
  it('request publishes exactly one event in the same transaction; double submit gives one event', async () => {
    const { admissionId } = await admitted();
    const first = await callRoute<{ eventId: string; attempt: number }>(
      requestEnrolment,
      post(counsellor, {}),
      { id: admissionId },
    );
    expect(first.status).toBe(201);
    expect(first.data?.attempt).toBe(1);
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
    const { admissionId } = await admitted();
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
    expect(await eventsFor(admissionId)).toHaveLength(1);
  });

  it('a failing payload rolls the status back (no event, still admitted)', async () => {
    const { admissionId } = await admitted();
    await ctx.db
      .update(opsAdmissions)
      .set({ programmeId: null })
      .where(eq(opsAdmissions.id, admissionId as never));
    expect(
      (await callRoute(requestEnrolment, post(counsellor, {}), { id: admissionId })).status,
    ).toBe(400);
    expect(await eventsFor(admissionId)).toHaveLength(0);
    const [row] = await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, admissionId as never));
    expect(row?.status).toBe('admitted');
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
            payload: {
              requestEventId: requestEventId as never,
              admissionId: admissionId as never,
              leadId: leadId as never,
              enrolmentId: crypto.randomUUID() as never,
              studentId: crypto.randomUUID() as never,
              existingStudent: false,
              programmeCode: 'IPMAT',
              confirmedAt: new Date().toISOString() as never,
              confirmedByUserId: null,
            },
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

  it('confirmed reply → enrolled; processed twice → one transition; counsellor notified', async () => {
    const { admissionId, leadId } = await admitted();
    const req = await callRoute<{ eventId: string }>(requestEnrolment, post(counsellor, {}), {
      id: admissionId,
    });
    await reply('confirmed', admissionId, leadId, req.data!.eventId);
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
    const [row] = await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, admissionId as never));
    expect(row).toMatchObject({ status: 'enrolled', handoffStatus: 'enrolled' });
    expect(row?.studentId).not.toBeNull();
    const notes = await ctx.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, counsellor.id), eq(notifications.kind, 'enrolment.confirmed')),
      );
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(
      (await callRoute(runJob, post(counsellor, {}), { job: 'enrolment-replies' })).status,
    ).toBe(403);
  });

  it('rejected reply → back to admitted with the reason; re-request is attempt 2 with a new key; stale replies are ignored', async () => {
    const { admissionId, leadId } = await admitted();
    const req1 = await callRoute<{ eventId: string }>(requestEnrolment, post(counsellor, {}), {
      id: admissionId,
    });
    await reply('rejected', admissionId, leadId, req1.data!.eventId);
    await processEnrolmentReplies(ctx.db);
    const [row] = await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, admissionId as never));
    expect(row).toMatchObject({
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
        payload: {
          requestEventId: req1.data!.eventId as never,
          admissionId: admissionId as never,
          leadId: leadId as never,
          enrolmentId: crypto.randomUUID() as never,
          studentId: crypto.randomUUID() as never,
          existingStudent: false,
          programmeCode: 'IPMAT',
          confirmedAt: new Date().toISOString() as never,
          confirmedByUserId: null,
        },
      }),
    );
    await processEnrolmentReplies(ctx.db);
    const [after] = await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, admissionId as never));
    expect(after?.status).toBe('enrolment_requested');
  });
});
