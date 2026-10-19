import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { buildRequest, setupTestDatabase } from '@elevate/testing';
import {
  auditEvents,
  opsCandidates,
  opsEmployeeRecords,
  opsInterviewPanelists,
  opsJobApplications,
  opsJobApplicationStages,
  opsLifecycleCases,
  opsLifecycleItems,
  opsRequisitions,
} from '@elevate/database';
import { GET as listReqs, POST as createReq } from '../../src/app/api/v1/hr/requisitions/route';
import { GET as getReq } from '../../src/app/api/v1/hr/requisitions/[id]/route';
import { POST as reqTransition } from '../../src/app/api/v1/hr/requisitions/[id]/transitions/route';
import { GET as listCands, POST as createCand } from '../../src/app/api/v1/hr/candidates/route';
import { GET as getCand } from '../../src/app/api/v1/hr/candidates/[id]/route';
import { POST as anonymise } from '../../src/app/api/v1/hr/candidates/[id]/anonymise/route';
import { GET as listApps, POST as createApp } from '../../src/app/api/v1/hr/applications/route';
import { GET as getApp } from '../../src/app/api/v1/hr/applications/[id]/route';
import { POST as appTransition } from '../../src/app/api/v1/hr/applications/[id]/transitions/route';
import { POST as convert } from '../../src/app/api/v1/hr/applications/[id]/convert/route';
import { POST as schedule } from '../../src/app/api/v1/hr/interviews/route';
import { POST as feedback } from '../../src/app/api/v1/hr/interviews/[id]/feedback/route';
import { POST as createOffer } from '../../src/app/api/v1/hr/offers/route';
import { POST as offerTransition } from '../../src/app/api/v1/hr/offers/[id]/transitions/route';
import {
  call,
  get,
  json,
  setupCast,
  uniqueCandidateEmail,
  type Cast,
} from './hr-lifecycle-fixtures';
import { phone } from './fixtures';

const ctx = setupTestDatabase();
let cast: Cast;

beforeAll(async () => {
  cast = await setupCast(ctx.db);
});

type Who = { token: string };

async function openRequisition(requester: Who, extra: Record<string, unknown> = {}) {
  const r = await call<{ id: string; status: string; recruiterStaffId: string | null }>(
    createReq,
    json(requester, {
      title: 'Accounts teacher (fictional role)',
      employmentType: 'full_time',
      openings: 1,
      ...extra,
    }),
  );
  expect(r.status).toBe(201);
  const approved = await call(reqTransition, json(cast.director, { to: 'open' }), {
    id: r.data!.id,
  });
  expect(approved.status).toBe(200);
  return r.data!;
}

async function candidate(by: Who, extra: Record<string, unknown> = {}) {
  const r = await call<{ id: string; code: string }>(
    createCand,
    json(by, {
      fullName: `Candidate ${Math.random().toString(36).slice(2, 7)} (fictional)`,
      email: uniqueCandidateEmail(),
      phone: phone(),
      source: 'referral',
      privacyNoticeGiven: true,
      ...extra,
    }),
  );
  expect(r.status).toBe(201);
  return r.data!;
}

async function application(by: Who, candidateId: string, requisitionId: string) {
  const r = await call<{ id: string }>(createApp, json(by, { candidateId, requisitionId }));
  expect(r.status).toBe(201);
  return r.data!.id;
}

async function move(by: Who, id: string, to: string, reason?: string) {
  return call<{ stage: string }>(appTransition, json(by, { to, reason }), { id });
}

/** A recruiter-owned application in the interview stage with an interview on `panel`. */
async function interviewing(panel: string[]) {
  const req = await openRequisition(cast.recruiter);
  const cand = await candidate(cast.recruiter);
  const appId = await application(cast.recruiter, cand.id, req.id);
  expect((await move(cast.recruiter, appId, 'screening')).status).toBe(200);
  expect((await move(cast.recruiter, appId, 'interview')).status).toBe(200);
  const iv = await call<{ id: string }>(
    schedule,
    json(cast.recruiter, {
      applicationId: appId,
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      mode: 'video',
      interviewerStaffIds: panel,
    }),
  );
  expect(iv.status).toBe(201);
  return { req, cand, appId, interviewId: iv.data!.id };
}

describe('route protection', () => {
  it('401 without a session, 403 without recruitment access, 400 on invalid input', async () => {
    expect((await call(listReqs, buildRequest('/ops/api/v1/hr/requisitions'))).status).toBe(401);
    expect((await call(listReqs, get(cast.outsider, '/ops/api/v1/hr/requisitions'))).status).toBe(
      403,
    );
    expect(
      (await call(createReq, json(cast.auditor, { title: 'X role', employmentType: 'full_time' })))
        .status,
    ).toBe(403);
    const bad = await call(
      createReq,
      json(cast.hrManager, { title: 'Role', employmentType: 'full_time', openings: 0 }),
    );
    expect(bad.status).toBe(400);
    expect(
      (
        await call(
          createCand,
          json(cast.hrManager, {
            fullName: 'Bad Phone (fictional)',
            phone: '12',
            source: 'referral',
          }),
        )
      ).status,
    ).toBe(400);
  });
});

describe('requisitions', () => {
  it('opening needs a decider who is not the requester', async () => {
    const r = await call<{ id: string; code: string }>(
      createReq,
      json(cast.hrManager, { title: 'Counsellor (fictional role)', employmentType: 'contract' }),
    );
    expect(r.status).toBe(201);
    expect(r.data!.code).toMatch(/^REQ-\d{4}$/);
    const self = await call(reqTransition, json(cast.hrManager, { to: 'open' }), {
      id: r.data!.id,
    });
    expect(self.status).toBe(403);
    const recruiter = await call(reqTransition, json(cast.recruiter, { to: 'open' }), {
      id: r.data!.id,
    });
    expect(recruiter.status).toBe(403);
    const ok = await call<{ status: string; approvedBy: string }>(
      reqTransition,
      json(cast.director, { to: 'open' }),
      { id: r.data!.id },
    );
    expect(ok.status).toBe(200);
    expect(ok.data!.status).toBe('open');
    expect(ok.data!.approvedBy).toBe(cast.director.id);
    const hold = await call(reqTransition, json(cast.hrManager, { to: 'on_hold' }), {
      id: r.data!.id,
    });
    expect(hold.status).toBe(400);
    const illegal = await call(reqTransition, json(cast.hrManager, { to: 'draft' }), {
      id: r.data!.id,
    });
    expect(illegal.status).toBe(409);
    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.entityId, r.data!.id), eq(auditEvents.action, 'requisition.approved')),
      );
    expect(audits).toHaveLength(1);
  });

  it('a recruiter works only their own requisitions', async () => {
    const r = await call<{ id: string; recruiterStaffId: string }>(
      createReq,
      json(cast.recruiter, { title: 'Front desk (fictional role)', employmentType: 'part_time' }),
    );
    expect(r.status).toBe(201);
    expect(r.data!.recruiterStaffId).toBe(cast.recruiter.staffId);
    expect((await call(getReq, get(cast.otherRecruiter), { id: r.data!.id })).status).toBe(403);
    const list = await call<{ rows: { id: string }[] }>(
      listReqs,
      get(cast.otherRecruiter, '/ops/api/v1/hr/requisitions'),
    );
    expect(list.data!.rows.some((x) => x.id === r.data!.id)).toBe(false);
    const mine = await call<{ rows: { id: string }[] }>(
      listReqs,
      get(cast.recruiter, '/ops/api/v1/hr/requisitions?status=draft'),
    );
    expect(mine.data!.rows.some((x) => x.id === r.data!.id)).toBe(true);
    expect((await call(getReq, get(cast.hrManager), { id: r.data!.id })).status).toBe(200);
  });
});

describe('candidates', () => {
  it('normalises contacts, refuses duplicates and keeps contacts out of the audit log', async () => {
    const email = uniqueCandidateEmail().toUpperCase();
    const raw = phone();
    const c = await candidate(cast.hrManager, { email, phone: raw });
    const [row] = await ctx.db
      .select()
      .from(opsCandidates)
      .where(eq(opsCandidates.id, c.id as never));
    expect(row!.email).toBe(email.toLowerCase());
    expect(row!.phone).toMatch(/^\+91\d{10}$/);
    expect(c.code).toMatch(/^CAND-\d{5}$/);
    const dup = await call(
      createCand,
      json(cast.hrManager, { fullName: 'Dup (fictional)', phone: raw, source: 'website' }),
    );
    expect(dup.status).toBe(409);
    const [audit] = await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, c.id), eq(auditEvents.action, 'candidate.created')));
    const text = JSON.stringify(audit);
    expect(text).not.toContain(email.toLowerCase());
    expect(text).not.toContain(row!.phone!);
  });

  it('lists never include contact details; auditor and director see no contacts on the detail', async () => {
    const c = await candidate(cast.hrManager);
    const list = await call<{ rows: Record<string, unknown>[] }>(
      listCands,
      get(cast.hrManager, '/ops/api/v1/hr/candidates'),
    );
    const row = list.data!.rows.find((r) => r.id === c.id)!;
    expect(row).toBeDefined();
    expect('email' in row || 'phone' in row).toBe(false);
    for (const reader of [cast.auditor, cast.director]) {
      const d = await call<{ contacts: unknown; candidate: { fullName: string } }>(
        getCand,
        get(reader),
        { id: c.id },
      );
      expect(d.status).toBe(200);
      expect(d.data!.contacts).toBeNull();
      expect(d.data!.candidate.fullName).toContain('(fictional)');
    }
    const hr = await call<{ contacts: { email: string } | null }>(getCand, get(cast.hrManager), {
      id: c.id,
    });
    expect(hr.data!.contacts?.email).toMatch(/@example\.test$/);
  });
});

describe('application stages', () => {
  it('allows the table and refuses everything else', async () => {
    const req = await openRequisition(cast.hrManager);
    const cand = await candidate(cast.hrManager);
    const appId = await application(cast.hrManager, cand.id, req.id);
    expect(
      (await call(createApp, json(cast.hrManager, { candidateId: cand.id, requisitionId: req.id })))
        .status,
    ).toBe(409);
    expect((await move(cast.hrManager, appId, 'offer')).status).toBe(409);
    expect((await move(cast.hrManager, appId, 'hired')).status).toBe(409);
    expect((await move(cast.hrManager, appId, 'screening')).status).toBe(200);
    expect((await move(cast.hrManager, appId, 'interview')).status).toBe(200);
    expect((await move(cast.hrManager, appId, 'rejected')).status).toBe(400);
    expect(
      (await move(cast.hrManager, appId, 'rejected', 'Role needs CA Inter (fictional)')).status,
    ).toBe(200);
    expect((await move(cast.hrManager, appId, 'screening')).status).toBe(409);
    const history = await ctx.db
      .select()
      .from(opsJobApplicationStages)
      .where(eq(opsJobApplicationStages.applicationId, appId as never));
    expect(history.map((h) => h.toStage)).toEqual([
      'applied',
      'screening',
      'interview',
      'rejected',
    ]);
    const [app] = await ctx.db
      .select()
      .from(opsJobApplications)
      .where(eq(opsJobApplications.id, appId as never));
    expect(app!.closedAt).not.toBeNull();
  });

  it('a recruiter cannot select or reject; the decider can', async () => {
    const { appId } = await interviewing([cast.interviewer.staffId]);
    expect((await move(cast.recruiter, appId, 'offer')).status).toBe(403);
    expect((await move(cast.recruiter, appId, 'rejected', 'No')).status).toBe(403);
    expect((await move(cast.director, appId, 'offer')).status).toBe(200);
  });
});

describe('interviewer access', () => {
  it('interviewers see only what they interview for and give feedback only on their panel', async () => {
    const { appId, interviewId, cand } = await interviewing([cast.interviewer.staffId]);
    const seen = await call<{ fullView: boolean; offers: unknown[] }>(
      getApp,
      get(cast.interviewer),
      { id: appId },
    );
    expect(seen.status).toBe(200);
    expect(seen.data!.fullView).toBe(false);
    const c = await call<{ contacts: unknown }>(getCand, get(cast.interviewer), { id: cand.id });
    expect(c.status).toBe(200);
    expect(c.data!.contacts).toBeNull();
    expect((await move(cast.interviewer, appId, 'withdrawn', 'x')).status).toBe(403);
    expect((await call(getApp, get(cast.otherRecruiter), { id: appId })).status).toBe(403);
    const mine = await call<{ rows: { id: string }[] }>(
      listApps,
      get(cast.interviewer, '/ops/api/v1/hr/applications?view=interviewing_me'),
    );
    expect(mine.data!.rows.map((r) => r.id)).toContain(appId);

    // Not on the panel: refused even with all-scope recruitment access.
    expect(
      (
        await call(
          feedback,
          json(cast.hrManager, { recommendation: 'hire', notes: 'Looks fine' }),
          { id: interviewId },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          feedback,
          json(cast.otherRecruiter, { recommendation: 'hire', notes: 'Looks fine' }),
          { id: interviewId },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(feedback, json(cast.interviewer, { recommendation: 'maybe', notes: 'x' }), {
          id: interviewId,
        })
      ).status,
    ).toBe(400);
    const ok = await call(
      feedback,
      json(cast.interviewer, {
        recommendation: 'hire',
        notes: 'Clear explanations of ledgers (fictional)',
      }),
      { id: interviewId },
    );
    expect(ok.status).toBe(200);
    const [audit] = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, appId),
          eq(auditEvents.action, 'interview.feedback_submitted'),
        ),
      );
    expect(JSON.stringify(audit)).not.toContain('ledgers');
  });

  it('feedback notes are masked for auditor and director, shown to the managing recruiter and the author', async () => {
    const { appId, interviewId } = await interviewing([cast.interviewer.staffId]);
    await call(
      feedback,
      json(cast.interviewer, { recommendation: 'strong_hire', notes: 'Private note (fictional)' }),
      { id: interviewId },
    );
    type Panel = { recommendation: string | null; feedbackNotes: string | null }[];
    type Detail = { interviews: { panel: Panel }[] };
    const notesFor = async (who: Who) =>
      (await call<Detail>(getApp, get(who), { id: appId })).data!.interviews[0]!.panel[0]!;
    for (const reader of [cast.auditor, cast.director]) {
      const p = await notesFor(reader);
      expect(p.feedbackNotes).toBeNull();
      expect(p.recommendation).toBe('strong_hire');
    }
    expect((await notesFor(cast.recruiter)).feedbackNotes).toBe('Private note (fictional)');
    expect((await notesFor(cast.interviewer)).feedbackNotes).toBe('Private note (fictional)');
    expect((await notesFor(cast.hrManager)).feedbackNotes).toBe('Private note (fictional)');
  });
});

describe('offers and conversion', () => {
  async function acceptedOffer(preparer: Who, approver: Who) {
    const { appId, req } = await interviewing([cast.interviewer.staffId]);
    expect((await move(cast.director, appId, 'offer')).status).toBe(200);
    const offer = await call<{ id: string }>(
      createOffer,
      json(preparer, {
        applicationId: appId,
        offeredTitle: 'Accounts Teacher',
        proposedStartDate: '2026-11-02',
        validUntil: '2026-10-30',
        compensationReference: 'COMP-PROPOSAL-7 (fictional)',
      }),
    );
    expect(offer.status).toBe(201);
    expect(
      (await call(createOffer, json(preparer, { applicationId: appId, offeredTitle: 'Again' })))
        .status,
    ).toBe(409);
    expect(
      (await call(offerTransition, json(approver, { to: 'approved' }), { id: offer.data!.id }))
        .status,
    ).toBe(200);
    expect(
      (
        await call(offerTransition, json(cast.recruiter, { to: 'extended' }), {
          id: offer.data!.id,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(offerTransition, json(cast.recruiter, { to: 'accepted' }), {
          id: offer.data!.id,
        })
      ).status,
    ).toBe(200);
    return { appId, req, offerId: offer.data!.id };
  }

  it('an offer is never approved by the person who prepared it', async () => {
    const { appId } = await interviewing([cast.interviewer.staffId]);
    await move(cast.director, appId, 'offer');
    const offer = await call<{ id: string }>(
      createOffer,
      json(cast.hrManager, { applicationId: appId, offeredTitle: 'Counsellor' }),
    );
    expect(
      (
        await call(offerTransition, json(cast.hrManager, { to: 'approved' }), {
          id: offer.data!.id,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(offerTransition, json(cast.recruiter, { to: 'approved' }), {
          id: offer.data!.id,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(offerTransition, json(cast.recruiter, { to: 'extended' }), {
          id: offer.data!.id,
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(offerTransition, json(cast.director, { to: 'approved' }), { id: offer.data!.id }))
        .status,
    ).toBe(200);
  });

  it('conversion is idempotent: two calls → one employee, one onboarding case', async () => {
    const { appId, req } = await acceptedOffer(cast.recruiter, cast.director);
    expect((await call(convert, json(cast.recruiter, {}), { id: appId })).status).toBe(403);
    const first = await call<{
      created: boolean;
      staffId: string;
      employeeCode: string;
      onboardingCaseId: string;
    }>(convert, json(cast.hrManager, {}), { id: appId });
    expect(first.status).toBe(201);
    expect(first.data!.created).toBe(true);
    expect(first.data!.employeeCode).toMatch(/^EMP-\d{4}$/);
    const second = await call<{ created: boolean; staffId: string; onboardingCaseId: string }>(
      convert,
      json(cast.director, {}),
      { id: appId },
    );
    expect(second.status).toBe(200);
    expect(second.data!.created).toBe(false);
    expect(second.data!.staffId).toBe(first.data!.staffId);
    expect(second.data!.onboardingCaseId).toBe(first.data!.onboardingCaseId);
    const employees = await ctx.db
      .select()
      .from(opsEmployeeRecords)
      .where(eq(opsEmployeeRecords.staffId, first.data!.staffId as never));
    expect(employees).toHaveLength(1);
    expect(employees[0]!.employmentStatus).toBe('onboarding');
    expect(employees[0]!.employmentStartDate).toBe('2026-11-02');
    const cases = await ctx.db
      .select()
      .from(opsLifecycleCases)
      .where(eq(opsLifecycleCases.applicationId, appId as never));
    expect(cases).toHaveLength(1);
    const items = await ctx.db
      .select()
      .from(opsLifecycleItems)
      .where(eq(opsLifecycleItems.caseId, cases[0]!.id));
    expect(items.length).toBeGreaterThanOrEqual(6);
    const [app] = await ctx.db
      .select()
      .from(opsJobApplications)
      .where(eq(opsJobApplications.id, appId as never));
    expect(app!.stage).toBe('hired');
    const [r] = await ctx.db
      .select()
      .from(opsRequisitions)
      .where(eq(opsRequisitions.id, req.id as never));
    expect(r!.status).toBe('filled');
  });
});

describe('unsuccessful-candidate anonymisation', () => {
  it('needs a decider, a confirmation and a closed unsuccessful candidate; keeps stage history', async () => {
    const { appId, interviewId, cand } = await interviewing([cast.interviewer.staffId]);
    await call(
      feedback,
      json(cast.interviewer, {
        recommendation: 'no_hire',
        notes: 'Feedback about a person (fictional)',
      }),
      { id: interviewId },
    );
    expect(
      (await call(anonymise, json(cast.hrManager, { confirm: true }), { id: cand.id })).status,
    ).toBe(409);
    expect(
      (await move(cast.director, appId, 'rejected', 'Another candidate selected')).status,
    ).toBe(200);
    expect(
      (await call(anonymise, json(cast.recruiter, { confirm: true }), { id: cand.id })).status,
    ).toBe(403);
    expect((await call(anonymise, json(cast.hrManager, {}), { id: cand.id })).status).toBe(400);
    const done = await call<{ status: string }>(
      anonymise,
      json(cast.hrManager, { confirm: true }),
      { id: cand.id },
    );
    expect(done.status).toBe(200);
    const [row] = await ctx.db
      .select()
      .from(opsCandidates)
      .where(eq(opsCandidates.id, cand.id as never));
    expect(row!.status).toBe('anonymised');
    expect(row!.email).toBeNull();
    expect(row!.phone).toBeNull();
    expect(row!.fullName).toBe(`Anonymised candidate (${cand.code})`);
    const history = await ctx.db
      .select()
      .from(opsJobApplicationStages)
      .where(eq(opsJobApplicationStages.applicationId, appId as never));
    expect(history.map((h) => h.toStage)).toEqual([
      'applied',
      'screening',
      'interview',
      'rejected',
    ]);
    const [panel] = await ctx.db
      .select()
      .from(opsInterviewPanelists)
      .where(eq(opsInterviewPanelists.interviewId, interviewId as never));
    expect(panel!.feedbackNotes).toBeNull();
    expect(panel!.recommendation).toBe('no_hire');
    expect(
      (await call(anonymise, json(cast.hrManager, { confirm: true }), { id: cand.id })).status,
    ).toBe(409);
    const [audit] = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.entityId, cand.id), eq(auditEvents.action, 'candidate.anonymised')),
      );
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit)).not.toContain('(fictional)');
  });
});
