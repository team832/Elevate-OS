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
  status,
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
type Body = Record<string, unknown>;

const reqTo = (who: Who, id: string, to: string) =>
  status(reqTransition, json(who, { to }), { id });
const offerTo = (who: Who, id: string, to: string) =>
  status(offerTransition, json(who, { to }), { id });
const move = (by: Who, id: string, to: string, reason?: string) =>
  status(appTransition, json(by, { to, reason }), { id });
const give = (who: Who, id: string, body: Body) => status(feedback, json(who, body), { id });
const anon = (who: Who, id: string, body: Body = { confirm: true }) =>
  status(anonymise, json(who, body), { id });
const audits = (entityId: string, action: string) =>
  ctx.db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityId, entityId), eq(auditEvents.action, action)));
const stagesOf = async (appId: string) =>
  (
    await ctx.db
      .select()
      .from(opsJobApplicationStages)
      .where(eq(opsJobApplicationStages.applicationId, appId as never))
  ).map((h) => h.toStage);

async function openRequisition(requester: Who, extra: Body = {}) {
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
  expect(await reqTo(cast.director, r.data!.id, 'open')).toBe(200);
  return r.data!;
}

async function candidate(by: Who, extra: Body = {}) {
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

/** A recruiter-owned application in the interview stage with an interview on `panel`. */
async function interviewing(panel: string[]) {
  const req = await openRequisition(cast.recruiter);
  const cand = await candidate(cast.recruiter);
  const appId = await application(cast.recruiter, cand.id, req.id);
  expect(await move(cast.recruiter, appId, 'screening')).toBe(200);
  expect(await move(cast.recruiter, appId, 'interview')).toBe(200);
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
    expect(await status(listReqs, buildRequest('/ops/api/v1/hr/requisitions'))).toBe(401);
    expect(await status(listReqs, get(cast.outsider, '/ops/api/v1/hr/requisitions'))).toBe(403);
    const role = (who: Who, extra: Body = {}) =>
      status(createReq, json(who, { title: 'X role', employmentType: 'full_time', ...extra }));
    expect(await role(cast.auditor)).toBe(403);
    expect(await role(cast.hrManager, { openings: 0 })).toBe(400);
    const badPhone = { fullName: 'Bad Phone (fictional)', phone: '12', source: 'referral' };
    expect(await status(createCand, json(cast.hrManager, badPhone))).toBe(400);
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
    const id = r.data!.id;
    expect(await reqTo(cast.hrManager, id, 'open')).toBe(403);
    expect(await reqTo(cast.recruiter, id, 'open')).toBe(403);
    const ok = await call<{ status: string; approvedBy: string }>(
      reqTransition,
      json(cast.director, { to: 'open' }),
      { id },
    );
    expect(ok.status).toBe(200);
    expect(ok.data!.status).toBe('open');
    expect(ok.data!.approvedBy).toBe(cast.director.id);
    expect(await reqTo(cast.hrManager, id, 'on_hold')).toBe(400);
    expect(await reqTo(cast.hrManager, id, 'draft')).toBe(409);
    expect(await audits(id, 'requisition.approved')).toHaveLength(1);
  });

  it('a recruiter works only their own requisitions', async () => {
    const r = await call<{ id: string; recruiterStaffId: string }>(
      createReq,
      json(cast.recruiter, { title: 'Front desk (fictional role)', employmentType: 'part_time' }),
    );
    expect(r.status).toBe(201);
    expect(r.data!.recruiterStaffId).toBe(cast.recruiter.staffId);
    expect(await status(getReq, get(cast.otherRecruiter), { id: r.data!.id })).toBe(403);
    const listed = async (who: Who, path: string) =>
      (await call<{ rows: { id: string }[] }>(listReqs, get(who, path))).data!.rows.some(
        (x) => x.id === r.data!.id,
      );
    expect(await listed(cast.otherRecruiter, '/ops/api/v1/hr/requisitions')).toBe(false);
    expect(await listed(cast.recruiter, '/ops/api/v1/hr/requisitions?status=draft')).toBe(true);
    expect(await status(getReq, get(cast.hrManager), { id: r.data!.id })).toBe(200);
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
    const dup = { fullName: 'Dup (fictional)', phone: raw, source: 'website' };
    expect(await status(createCand, json(cast.hrManager, dup))).toBe(409);
    const text = JSON.stringify((await audits(c.id, 'candidate.created'))[0]);
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
    const again = { candidateId: cand.id, requisitionId: req.id };
    expect(await status(createApp, json(cast.hrManager, again))).toBe(409);
    for (const [to, code, reason] of [
      ['offer', 409],
      ['hired', 409],
      ['screening', 200],
      ['interview', 200],
      ['rejected', 400],
      ['rejected', 200, 'Role needs CA Inter (fictional)'],
      ['screening', 409],
    ] as const)
      expect(await move(cast.hrManager, appId, to, reason), `${to} ${code}`).toBe(code);
    expect(await stagesOf(appId)).toEqual(['applied', 'screening', 'interview', 'rejected']);
    const [app] = await ctx.db
      .select()
      .from(opsJobApplications)
      .where(eq(opsJobApplications.id, appId as never));
    expect(app!.closedAt).not.toBeNull();
  });

  it('a recruiter cannot select or reject; the decider can', async () => {
    const { appId } = await interviewing([cast.interviewer.staffId]);
    expect(await move(cast.recruiter, appId, 'offer')).toBe(403);
    expect(await move(cast.recruiter, appId, 'rejected', 'No')).toBe(403);
    expect(await move(cast.director, appId, 'offer')).toBe(200);
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
    expect(await move(cast.interviewer, appId, 'withdrawn', 'x')).toBe(403);
    expect(await status(getApp, get(cast.otherRecruiter), { id: appId })).toBe(403);
    const mine = await call<{ rows: { id: string }[] }>(
      listApps,
      get(cast.interviewer, '/ops/api/v1/hr/applications?view=interviewing_me'),
    );
    expect(mine.data!.rows.map((r) => r.id)).toContain(appId);

    // Not on the panel: refused even with all-scope recruitment access.
    const fine = { recommendation: 'hire', notes: 'Looks fine' };
    expect(await give(cast.hrManager, interviewId, fine)).toBe(403);
    expect(await give(cast.otherRecruiter, interviewId, fine)).toBe(403);
    expect(await give(cast.interviewer, interviewId, { recommendation: 'maybe', notes: 'x' })).toBe(
      400,
    );
    const notes = 'Clear explanations of ledgers (fictional)';
    expect(await give(cast.interviewer, interviewId, { recommendation: 'hire', notes })).toBe(200);
    const [audit] = await audits(appId, 'interview.feedback_submitted');
    expect(JSON.stringify(audit)).not.toContain('ledgers');
  });

  it('feedback notes are masked for auditor and director, shown to the managing recruiter and the author', async () => {
    const { appId, interviewId } = await interviewing([cast.interviewer.staffId]);
    await give(cast.interviewer, interviewId, {
      recommendation: 'strong_hire',
      notes: 'Private note (fictional)',
    });
    type Panel = { recommendation: string | null; feedbackNotes: string | null }[];
    type Detail = { interviews: { panel: Panel }[] };
    const notesFor = async (who: Who) =>
      (await call<Detail>(getApp, get(who), { id: appId })).data!.interviews[0]!.panel[0]!;
    for (const reader of [cast.auditor, cast.director]) {
      const p = await notesFor(reader);
      expect(p.feedbackNotes).toBeNull();
      expect(p.recommendation).toBe('strong_hire');
    }
    for (const reader of [cast.recruiter, cast.interviewer, cast.hrManager])
      expect((await notesFor(reader)).feedbackNotes).toBe('Private note (fictional)');
  });
});

describe('offers and conversion', () => {
  async function acceptedOffer(preparer: Who, approver: Who) {
    const { appId, req } = await interviewing([cast.interviewer.staffId]);
    expect(await move(cast.director, appId, 'offer')).toBe(200);
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
    const second = { applicationId: appId, offeredTitle: 'Again' };
    expect(await status(createOffer, json(preparer, second))).toBe(409);
    const id = offer.data!.id;
    expect(await offerTo(approver, id, 'approved')).toBe(200);
    expect(await offerTo(cast.recruiter, id, 'extended')).toBe(200);
    expect(await offerTo(cast.recruiter, id, 'accepted')).toBe(200);
    return { appId, req, offerId: id };
  }

  it('an offer is never approved by the person who prepared it', async () => {
    const { appId } = await interviewing([cast.interviewer.staffId]);
    await move(cast.director, appId, 'offer');
    const offer = await call<{ id: string }>(
      createOffer,
      json(cast.hrManager, { applicationId: appId, offeredTitle: 'Counsellor' }),
    );
    const id = offer.data!.id;
    expect(await offerTo(cast.hrManager, id, 'approved')).toBe(403);
    expect(await offerTo(cast.recruiter, id, 'approved')).toBe(403);
    expect(await offerTo(cast.recruiter, id, 'extended')).toBe(409);
    expect(await offerTo(cast.director, id, 'approved')).toBe(200);
  });

  it('conversion is idempotent: two calls → one employee, one onboarding case', async () => {
    const { appId, req } = await acceptedOffer(cast.recruiter, cast.director);
    expect(await status(convert, json(cast.recruiter, {}), { id: appId })).toBe(403);
    type Converted = {
      created: boolean;
      staffId: string;
      employeeCode: string;
      onboardingCaseId: string;
    };
    const first = await call<Converted>(convert, json(cast.hrManager, {}), { id: appId });
    expect(first.status).toBe(201);
    expect(first.data!.created).toBe(true);
    expect(first.data!.employeeCode).toMatch(/^EMP-\d{4}$/);
    const second = await call<Converted>(convert, json(cast.director, {}), { id: appId });
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
    await give(cast.interviewer, interviewId, {
      recommendation: 'no_hire',
      notes: 'Feedback about a person (fictional)',
    });
    expect(await anon(cast.hrManager, cand.id)).toBe(409);
    expect(await move(cast.director, appId, 'rejected', 'Another candidate selected')).toBe(200);
    expect(await anon(cast.recruiter, cand.id)).toBe(403);
    expect(await anon(cast.hrManager, cand.id, {})).toBe(400);
    expect(await anon(cast.hrManager, cand.id)).toBe(200);
    const [row] = await ctx.db
      .select()
      .from(opsCandidates)
      .where(eq(opsCandidates.id, cand.id as never));
    expect(row!.status).toBe('anonymised');
    expect(row!.email).toBeNull();
    expect(row!.phone).toBeNull();
    expect(row!.fullName).toBe(`Anonymised candidate (${cand.code})`);
    expect(await stagesOf(appId)).toEqual(['applied', 'screening', 'interview', 'rejected']);
    const [panel] = await ctx.db
      .select()
      .from(opsInterviewPanelists)
      .where(eq(opsInterviewPanelists.interviewId, interviewId as never));
    expect(panel!.feedbackNotes).toBeNull();
    expect(panel!.recommendation).toBe('no_hire');
    expect(await anon(cast.hrManager, cand.id)).toBe(409);
    const [audit] = await audits(cand.id, 'candidate.anonymised');
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit)).not.toContain('(fictional)');
  });
});
