/**
 * Employee journey through the real routes: requisition → candidate →
 * application → interview → offer → conversion → onboarding complete →
 * offboarding → separation → access-revocation item completed.
 *
 * The platform consumer itself is tested in apps/platform (module boundary:
 * Ops tests cannot import the platform app). Here a stand-in consumer under
 * the same consumer name writes what the contract says the platform writes
 * (disabled user, sessions deleted, `user.access_revoked` audit row), so the
 * Ops side of the contract is exercised end to end.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import {
  auditEvents,
  integrationEvents,
  opsEmployeeRecords,
  opsJobApplicationStages,
  sessions,
  staffMembers,
  users,
} from '@elevate/database';
import { processEvents, recordAudit } from '@elevate/server-kit';
import { PLATFORM_ACCESS_REVOCATION_CONSUMER } from '@elevate/shared-contracts';
import type { UserId } from '@elevate/shared-types';
import { addDays, istToday } from '../../src/domain/dates';
import { POST as createReq } from '../../src/app/api/v1/hr/requisitions/route';
import { POST as reqTransition } from '../../src/app/api/v1/hr/requisitions/[id]/transitions/route';
import { POST as createCand } from '../../src/app/api/v1/hr/candidates/route';
import { POST as createApp } from '../../src/app/api/v1/hr/applications/route';
import { POST as appTransition } from '../../src/app/api/v1/hr/applications/[id]/transitions/route';
import { POST as convert } from '../../src/app/api/v1/hr/applications/[id]/convert/route';
import { POST as schedule } from '../../src/app/api/v1/hr/interviews/route';
import { POST as feedback } from '../../src/app/api/v1/hr/interviews/[id]/feedback/route';
import { POST as createOffer } from '../../src/app/api/v1/hr/offers/route';
import { POST as offerTransition } from '../../src/app/api/v1/hr/offers/[id]/transitions/route';
import { POST as createCase } from '../../src/app/api/v1/hr/lifecycle-cases/route';
import { GET as getCase } from '../../src/app/api/v1/hr/lifecycle-cases/[id]/route';
import { PATCH as updateItem } from '../../src/app/api/v1/hr/lifecycle-cases/[id]/items/[itemId]/route';
import { POST as approve } from '../../src/app/api/v1/hr/lifecycle-cases/[id]/approve/route';
import { runSeparations } from '../../src/server/hr/offboarding';
import {
  assignAsset,
  call,
  get,
  json,
  setupCast,
  uniqueCandidateEmail,
  type Cast,
  status,
} from './hr-lifecycle-fixtures';
import { opsAssetAssignments } from '@elevate/database';

const ctx = setupTestDatabase();
let cast: Cast;

beforeAll(async () => {
  cast = await setupCast(ctx.db);
});

type Item = { id: string; kind: string; status: string; evidence: string | null };
type CaseDetail = { case: { status: string }; items: Item[] };

async function finishChecklist(caseId: string, skip: string[]) {
  const d = (await call<CaseDetail>(getCase, get(cast.hrContributor), { id: caseId })).data!;
  for (const i of d.items) {
    if (skip.includes(i.kind) || i.status === 'done') continue;
    const body =
      i.kind === 'final_settlement'
        ? { status: 'done', evidence: 'FS-REF-JOURNEY (fictional)' }
        : { status: 'done', evidence: 'Checked (fictional)' };
    const r = await call(updateItem, json(cast.hrContributor, body, 'PATCH'), {
      id: caseId,
      itemId: i.id,
    });
    expect(r.status, `${i.kind} ${JSON.stringify(r.error)}`).toBe(200);
  }
}

describe('employee journey', () => {
  it('runs from requisition to separation with history intact', async () => {
    // 1. Requisition requested by the recruiter, approved by the HR manager.
    const req = await call<{ id: string }>(
      createReq,
      json(cast.recruiter, {
        title: 'Commerce faculty (fictional role)',
        employmentType: 'full_time',
        openings: 1,
        location: 'Sikar',
        hiringManagerStaffId: cast.deptManager.staffId,
      }),
    );
    expect(req.status).toBe(201);
    expect(
      await status(reqTransition, json(cast.hrManager, { to: 'open' }), { id: req.data!.id }),
    ).toBe(200);

    // 2–3. Candidate and application.
    const cand = await call<{ id: string }>(
      createCand,
      json(cast.recruiter, {
        fullName: 'Journey Candidate (fictional)',
        email: uniqueCandidateEmail(),
        source: 'job_portal',
        privacyNoticeGiven: true,
      }),
    );
    const app = await call<{ id: string }>(
      createApp,
      json(cast.recruiter, { candidateId: cand.data!.id, requisitionId: req.data!.id }),
    );
    const appId = app.data!.id;
    for (const to of ['screening', 'interview'])
      expect(await status(appTransition, json(cast.recruiter, { to }), { id: appId })).toBe(200);

    // 4. Interview and feedback by the panel.
    const iv = await call<{ id: string }>(
      schedule,
      json(cast.recruiter, {
        applicationId: appId,
        scheduledAt: new Date(Date.now() - 3_600_000).toISOString(),
        mode: 'in_person',
        location: 'Room 2',
        interviewerStaffIds: [cast.interviewer.staffId],
      }),
    );
    expect(iv.status).toBe(201);
    expect(
      await status(
        feedback,
        json(cast.interviewer, { recommendation: 'hire', notes: 'Good demo lesson (fictional)' }),
        { id: iv.data!.id },
      ),
    ).toBe(200);

    // 5. Selection, offer prepared by the recruiter, approved by the director, accepted.
    expect(await status(appTransition, json(cast.hrManager, { to: 'offer' }), { id: appId })).toBe(
      200,
    );
    const start = addDays(istToday(new Date()), -7);
    const offer = await call<{ id: string }>(
      createOffer,
      json(cast.recruiter, {
        applicationId: appId,
        offeredTitle: 'Commerce Faculty',
        proposedStartDate: start,
      }),
    );
    for (const [who, to] of [
      [cast.director, 'approved'],
      [cast.recruiter, 'extended'],
      [cast.recruiter, 'accepted'],
    ] as const)
      expect(await status(offerTransition, json(who, { to }), { id: offer.data!.id })).toBe(200);

    // 6. Conversion → employee + onboarding case.
    const conv = await call<{ staffId: string; onboardingCaseId: string }>(
      convert,
      json(cast.hrManager, { workEmail: uniqueCandidateEmail() }),
      { id: appId },
    );
    expect(conv.status).toBe(201);
    const staffId = conv.data!.staffId;
    const [staff] = await ctx.db
      .select()
      .from(staffMembers)
      .where(eq(staffMembers.id, staffId as never));
    expect(staff!.managerId).toBe(cast.deptManager.staffId);

    // A platform administrator links a login (fictional user with a live session).
    const login = await createTestUser(ctx.db, {
      roles: ['employee'],
      displayName: 'Journey Candidate (fictional)',
    });
    await ctx.db
      .update(staffMembers)
      .set({ userId: login.id })
      .where(eq(staffMembers.id, staffId as never));

    // 7. Onboarding complete and approved (by the HR manager, not the employee).
    await finishChecklist(conv.data!.onboardingCaseId, []);
    expect(
      await status(approve, json(cast.hrManager, { confirm: true }), {
        id: conv.data!.onboardingCaseId,
      }),
    ).toBe(200);
    const [active] = await ctx.db
      .select()
      .from(opsEmployeeRecords)
      .where(eq(opsEmployeeRecords.staffId, staffId as never));
    expect(active!.employmentStatus).toBe('active');

    // TODO(HR time agent): attendance sessions and an approved leave request for this
    // employee would be recorded here; the separation below must keep them.

    // 8. Offboarding with an asset to return.
    const { assignment } = await assignAsset(ctx.db, staffId as never, cast.hrManager.id);
    const lwd = addDays(istToday(new Date()), 1);
    const off = await call<{ id: string }>(
      createCase,
      json(cast.hrManager, {
        kind: 'offboarding',
        staffId,
        separationType: 'resignation',
        lastWorkingDay: lwd,
        reason: 'Further studies (fictional)',
      }),
    );
    expect(off.status).toBe(201);
    await ctx.db
      .update(opsAssetAssignments)
      .set({ returnedAt: new Date(), returnedBy: cast.hrManager.id, conditionOnReturn: 'good' })
      .where(eq(opsAssetAssignments.id, assignment.id));
    await finishChecklist(off.data!.id, ['access_revocation', 'asset_return']);
    expect(
      await status(approve, json(cast.director, { confirm: true }), { id: off.data!.id }),
    ).toBe(200);

    // 9. Separation applied the day after the last working day.
    const result = await runSeparations(ctx.db, addDays(lwd, 1));
    expect(result.applied).toBe(1);
    const events = await ctx.db
      .select()
      .from(integrationEvents)
      .where(eq(integrationEvents.type, 'ops.employee.separated'));
    expect(
      events.filter((e) => (e.payload as { staffId: string }).staffId === staffId),
    ).toHaveLength(1);

    // Stand-in for the platform consumer (same consumer name and audit contract).
    await processEvents(ctx.db, {
      consumer: PLATFORM_ACCESS_REVOCATION_CONSUMER,
      handlers: {
        'ops.employee.separated': async (event, { db: tx }) => {
          const userId = event.payload.userId as UserId;
          await tx.update(users).set({ status: 'disabled' }).where(eq(users.id, userId));
          const deleted = await tx
            .delete(sessions)
            .where(eq(sessions.userId, userId))
            .returning({ id: sessions.id });
          await recordAudit(tx, {
            actorType: 'system',
            module: 'platform',
            action: 'user.access_revoked',
            entityType: 'user',
            entityId: userId,
            metadata: { eventId: event.id, sessionsDeleted: deleted.length },
          });
        },
      },
    });
    const synced = await runSeparations(ctx.db, addDays(lwd, 1));
    expect(synced.accessItemsCompleted).toBe(1);
    const final = (await call<CaseDetail>(getCase, get(cast.hrManager), { id: off.data!.id }))
      .data!;
    expect(final.case.status).toBe('completed');
    const access = final.items.find((i) => i.kind === 'access_revocation')!;
    expect(access.status).toBe('done');
    expect(access.evidence).toContain('1 session');
    expect(final.items.find((i) => i.kind === 'asset_return')!.status).toBe('done');

    // History survives separation.
    const [separated] = await ctx.db
      .select()
      .from(opsEmployeeRecords)
      .where(eq(opsEmployeeRecords.staffId, staffId as never));
    expect(separated!.employmentStatus).toBe('separated');
    expect(
      (
        await ctx.db
          .select()
          .from(opsJobApplicationStages)
          .where(eq(opsJobApplicationStages.applicationId, appId as never))
      ).map((s) => s.toStage),
    ).toEqual(['applied', 'screening', 'interview', 'offer', 'hired']);
    const trail = await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, 'employee'), eq(auditEvents.entityId, staffId)));
    expect(trail.map((a) => a.action)).toEqual(
      expect.arrayContaining(['employee.created', 'employee.status_changed']),
    );
    const [u] = await ctx.db.select().from(users).where(eq(users.id, login.id));
    expect(u!.status).toBe('disabled');
  });
});
