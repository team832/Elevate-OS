import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { hashPassword } from '@elevate/authentication';
import {
  auditEvents,
  opsAdmissions,
  opsDemos,
  opsDemoSessionChanges,
  opsDemoSessions,
  opsDuplicateFlags,
  opsLeads,
  students,
} from '@elevate/database';
import { coreSeeds, runSeeds } from '@elevate/database/seed';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { POST as createLead } from '../../src/app/api/v1/leads/route';
import { POST as activity } from '../../src/app/api/v1/leads/[id]/activities/route';
import { POST as counselling } from '../../src/app/api/v1/appointments/route';
import { POST as enquiry } from '../../src/app/api/v1/leads/[id]/enquiries/route';
import { PATCH as counsellingUpdate } from '../../src/app/api/v1/appointments/[id]/route';
import { GET as listDemos, POST as createDemo } from '../../src/app/api/v1/demos/route';
import { GET as getDemo, POST as demoAction } from '../../src/app/api/v1/demos/[id]/route';
import { POST as sessionAction } from '../../src/app/api/v1/demos/[id]/sessions/[sessionId]/route';
import { POST as checklist } from '../../src/app/api/v1/demos/[id]/checklist/route';
import { POST as addSession } from '../../src/app/api/v1/demos/[id]/sessions/route';
import { POST as mergeLead } from '../../src/app/api/v1/leads/[id]/merge/route';
import { istToday } from '../../src/domain';
import { createTeacherFeedback } from '../../src/server/feedback';
import { feeRecordAction, recordFee } from '../../src/server/fees';
import { POST as schedule } from '../../src/app/api/v1/appointments/route';
import { getDemo as loadDemo } from '../../src/server/demos';
import { sampleSeeds, TANISHA_EMAIL } from '../../seed/samples';
import { referenceSeeds } from '../../seed/reference';
import { phone, setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let colleague: StaffUser;
let auditor: TestUser;
let teacher: TestUser;

const post = (user: { token: string }, json: unknown) =>
  authedRequest(user, '/ops/api/v1/x', { method: 'POST', json });
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const sessions = (...hours: number[]) =>
  hours.map((h) => ({ startsAt: hoursFromNow(h), subject: 'English' }));

type Demo = {
  id: string;
  leadId: string;
  admissionId: string;
  plannedSessionCount: number;
  plannedDayCount: number;
  sessions: { id: string; sessionNumber: number; dayNumber: number }[];
};
type List = {
  counts: Record<string, number>;
  kpis: { current: number; followUpsDue: number; followUpsDueByView: Record<string, number> };
  rows: { demo: { id: string } }[];
  total: number;
};

let n = 0;
/** A fresh lead owned by `owner`, walked to `counselled` through the real routes. */
async function counselledCase(owner: StaffUser, contact: object = { studentPhone: phone() }) {
  n += 1;
  const lead = await callRoute<{ lead: { id: string }; admission: { id: string } }>(
    createLead,
    post(owner, {
      studentName: `Demo Test ${n}`,
      ...contact,
      programmeCode: 'CLAT',
      sourceCode: 'WEBINAR',
    }),
  );
  const { id: leadId } = lead.data!.lead;
  await callRoute(activity, post(owner, { kind: 'call', outcome: 'connected_two_way' }), {
    id: leadId,
  });
  const s = await callRoute<{ id: string }>(
    counselling,
    post(owner, {
      admissionId: lead.data!.admission.id,
      type: 'student_counselling',
      startsAt: hoursFromNow(-200),
      mode: 'online',
    }),
  );
  await callRoute(counsellingUpdate, post(owner, { action: 'complete', outcome: 'Wants a demo' }), {
    id: s.data!.id,
  });
  return lead.data!.admission.id;
}

async function book(owner: StaffUser, hours: number[]) {
  const res = await callRoute<Demo>(
    createDemo,
    post(owner, { admissionId: await counselledCase(owner), sessions: sessions(...hours) }),
  );
  expect(res.status).toBe(201);
  return res.data!;
}

const act = (user: { token: string }, demo: Demo, session: number, body: unknown) =>
  callRoute(sessionAction, post(user, body), {
    id: demo.id,
    sessionId: demo.sessions[session - 1]!.id,
  });
const list = (user: { token: string }, query: string) =>
  callRoute<List>(listDemos, authedRequest(user, `/ops/api/v1/demos?${query}`));

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  colleague = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
  teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
});

describe('book a demo (POST /demos)', () => {
  it('401 / 403 / 400 / 201 with N = 3 sessions, audit row, case → demo_scheduled; one open demo per case', async () => {
    const admissionId = await counselledCase(counsellor);
    const body = { admissionId, sessions: sessions(24, 48, 72) };
    expect(
      (await callRoute(createDemo, buildRequest('/x', { method: 'POST', json: body }))).status,
    ).toBe(401);
    expect((await callRoute(createDemo, post(teacher, body))).status).toBe(403);
    expect((await callRoute(createDemo, post(colleague, body))).status).toBe(403); // own scope
    const two = await callRoute(
      createDemo,
      post(counsellor, { ...body, sessions: sessions(24, 48) }),
    );
    expect(two.status).toBe(400);
    expect(
      (await callRoute(createDemo, post(counsellor, { ...body, sessions: sessions(24, 24.5, 72) })))
        .status,
    ).toBe(400); // overlap
    const res = await callRoute<Demo>(createDemo, post(counsellor, body));
    expect(res.status).toBe(201);
    expect(res.data!.plannedSessionCount).toBe(3);
    expect(res.data!.sessions.map((s) => s.sessionNumber)).toEqual([1, 2, 3]);
    const [a] = await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, admissionId as never));
    expect(a?.status).toBe('demo_scheduled');
    const audit = await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, res.data!.id), eq(auditEvents.action, 'demo.booked')));
    expect(audit).toHaveLength(1);
    expect((await callRoute(createDemo, post(counsellor, body))).status).toBe(409);
  });
});

describe('attendance (POST /demos/[id]/sessions/[sessionId])', () => {
  it('records, refuses before start, corrections need a reason and keep history; only present counts', async () => {
    const demo = await book(counsellor, [-50, -26, 30]);
    expect(
      (await act(counsellor, demo, 1, { action: 'attendance', attendance: 'present' })).status,
    ).toBe(200);
    expect(
      (await act(counsellor, demo, 2, { action: 'attendance', attendance: 'absent' })).status,
    ).toBe(200);
    expect(
      (await act(counsellor, demo, 3, { action: 'attendance', attendance: 'present' })).status,
    ).toBe(400);
    expect(
      (await act(counsellor, demo, 2, { action: 'attendance', attendance: 'present' })).status,
    ).toBe(400);
    expect(
      (await act(colleague, demo, 2, { action: 'attendance', attendance: 'present', reason: 'x' }))
        .status,
    ).toBe(403);
    expect((await act(counsellor, demo, 2, { action: 'bogus' })).status).toBe(400);
    const fix = { action: 'attendance', attendance: 'present', reason: 'Marked the wrong student' };
    expect((await act(counsellor, demo, 2, fix)).status).toBe(200);
    const history = await ctx.db
      .select()
      .from(opsDemoSessionChanges)
      .where(eq(opsDemoSessionChanges.sessionId, demo.sessions[1]!.id as never));
    expect(history.map((h) => [h.previousValue, h.newValue, h.reason]).sort()).toEqual([
      ['absent', 'present', 'Marked the wrong student'],
      ['scheduled', 'absent', null],
    ]);
    expect(
      (await act(counsellor, demo, 3, { action: 'cancel', reason: 'Teacher unwell' })).status,
    ).toBe(200);
    const d = await callRoute<{ progress: { attended: number; planned: number } }>(
      getDemo,
      authedRequest(counsellor, '/x'),
      { id: demo.id },
    );
    expect(d.data!.progress).toMatchObject({ attended: 2, planned: 3 }); // days; cancelled is not attended
    const rec = await loadDemo(ctx.db, counsellor, demo.id);
    expect(rec.names[rec.sessions[0]!.recordedBy!]).toBeTruthy(); // "recorded by" has a name
    const [row] = await ctx.db
      .select()
      .from(opsDemos)
      .where(eq(opsDemos.id, demo.id as never));
    expect(row?.completedAt).not.toBeNull(); // every session has a final attendance
    const [a] = await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, row!.admissionId));
    expect(a?.status).toBe('demo_attended');
  });
  it('reschedule needs a reason and marks the session rescheduled (still not attended)', async () => {
    const demo = await book(counsellor, [20, 44, 68]);
    expect(
      (await act(counsellor, demo, 1, { action: 'reschedule', startsAt: hoursFromNow(90) })).status,
    ).toBe(400);
    const r = await act(counsellor, demo, 1, {
      action: 'reschedule',
      startsAt: hoursFromNow(90),
      reason: 'Family travelling',
    });
    expect(r.data).toMatchObject({ attendance: 'rescheduled' });
    const [s] = await ctx.db
      .select()
      .from(opsDemoSessions)
      .where(eq(opsDemoSessions.id, demo.sessions[0]!.id as never));
    expect(s?.exceptionReason).toBe('Family travelling');
  });
});

describe('teacher booking lock (shared with appointments)', () => {
  it('a demo class cannot overlap the teacher’s appointment: book, reschedule and assign → 409', async () => {
    const t = await staffUser(ctx.db, ['teacher']);
    const admissionId = await counselledCase(counsellor);
    const startsAt = hoursFromNow(300);
    const meeting = { type: 'teacher_academic', staffId: t.staffId, admissionId, mode: 'online' };
    expect((await callRoute(schedule, post(manager, { ...meeting, startsAt }))).status).toBe(201);
    const clash = { startsAt, subject: 'English', teacherStaffId: t.staffId };
    const booking = { admissionId, sessions: [clash, ...sessions(324, 348)] };
    expect((await callRoute(createDemo, post(counsellor, booking))).status).toBe(409);
    const demo = await book(counsellor, [324, 348, 372]);
    const assign = { action: 'assign', teacherStaffId: t.staffId, subject: 'English' };
    expect((await act(counsellor, demo, 1, assign)).status).toBe(200);
    const move = { action: 'reschedule', startsAt, reason: 'Teacher asked' };
    expect((await act(counsellor, demo, 1, move)).status).toBe(409);
    const other = await book(counsellor, [300.5, 380, 404]);
    expect((await act(counsellor, other, 1, assign)).status).toBe(409);
  });
});

describe('list views (GET /demos)', () => {
  it('upcoming / current / previous filter correctly, counts come from the same query, own scope applies', async () => {
    const upcoming = await book(counsellor, [100, 124, 148]);
    const current = await book(counsellor, [-3, 120, 144]);
    const closed = await book(counsellor, [200, 224, 248]);
    const theirs = await book(colleague, [-3, 150, 174]);
    expect(
      (
        await callRoute(
          demoAction,
          post(counsellor, {
            action: 'outcome',
            outcome: 'declined',
            reason: 'Chose another institute',
          }),
          { id: closed.id },
        )
      ).status,
    ).toBe(200);
    const ids = (l: List) => l.rows.map((r) => r.demo.id);
    const up = (await list(counsellor, 'view=upcoming')).data!;
    expect(ids(up)).toContain(upcoming.id);
    expect(ids(up)).not.toContain(current.id);
    const cur = (await list(counsellor, 'view=current')).data!;
    expect(ids(cur)).toContain(current.id);
    expect(ids(cur)).not.toContain(theirs.id); // own scope
    const prev = (await list(counsellor, 'view=previous&outcome=declined')).data!;
    expect(ids(prev)).toEqual([closed.id]);
    expect(prev.counts.previous).toBe(prev.total);
    expect(cur.counts.current).toBe(cur.kpis.current);
    const due = Object.values(cur.kpis.followUpsDueByView);
    expect(due.reduce((a, b) => a + b, 0)).toBe(cur.kpis.followUpsDue);
    const all = (await list(manager, 'view=current')).data!;
    expect(ids(all)).toEqual(expect.arrayContaining([current.id, theirs.id]));
    const search = (await list(manager, 'view=upcoming&q=nobody-has-this-name')).data!;
    expect(search.total).toBe(0);
    expect((await list(teacher, 'view=current')).status).toBe(403);
    expect((await list(counsellor, 'view=sideways')).status).toBe(400);
  });
});

describe('outcome, checklist, detail access', () => {
  it('outcome needs a reason, cannot be "converted" by hand, closes pending sessions; closed demos refuse reschedule', async () => {
    const demo = await book(counsellor, [-30, 40, 64]);
    const outcome = (body: object) =>
      callRoute(demoAction, post(counsellor, { action: 'outcome', ...body }), { id: demo.id });
    expect((await outcome({ outcome: 'not_converted' })).status).toBe(400);
    expect((await outcome({ outcome: 'converted', reason: 'x' })).status).toBe(400);
    expect(
      (await outcome({ outcome: 'not_converted', reason: 'Wants to wait a year' })).status,
    ).toBe(200);
    const left = await ctx.db
      .select({ attendance: opsDemoSessions.attendance })
      .from(opsDemoSessions)
      .where(eq(opsDemoSessions.demoId, demo.id as never));
    expect(left.map((s) => s.attendance).sort()).toEqual([
      'cancelled',
      'cancelled',
      'not_recorded',
    ]);
    expect(
      (
        await act(counsellor, demo, 2, {
          action: 'reschedule',
          startsAt: hoursFromNow(80),
          reason: 'x',
        })
      ).status,
    ).toBe(409);
    expect((await outcome({ outcome: 'declined', reason: 'x' })).status).toBe(400); // already closed
  });
  it('checklist: waiver needs a reason, derived items are read-only, latest entry wins', async () => {
    const demo = await book(counsellor, [10, 34, 58]);
    const set = (body: object) => callRoute(checklist, post(counsellor, body), { id: demo.id });
    expect((await set({ itemKey: 'guardian_feedback', status: 'waived' })).status).toBe(400);
    expect((await set({ itemKey: 'sessions_recorded', status: 'complete' })).status).toBe(400);
    expect((await set({ itemKey: 'fee_structure_explained', status: 'pending' })).status).toBe(201);
    expect((await set({ itemKey: 'fee_structure_explained', status: 'complete' })).status).toBe(
      201,
    );
    expect(
      (await set({ itemKey: 'guardian_feedback', status: 'waived', reason: 'Guardian abroad' }))
        .status,
    ).toBe(201);
    const d = await loadDemo(ctx.db, counsellor, demo.id);
    const item = (k: string) => d.checklist.items.find((i) => i.key === k);
    expect(item('fee_structure_explained')?.status).toBe('complete');
    expect(item('guardian_feedback')?.entry?.reason).toBe('Guardian abroad');
    expect(d.checklistHistory).toHaveLength(3);
  });
  it('detail: 404 unknown, 403 for another counsellor, auditor reads but cannot write', async () => {
    const demo = await book(counsellor, [10, 34, 58]);
    const read = (user: { token: string }, id = demo.id) =>
      callRoute(getDemo, authedRequest(user, '/x'), { id });
    expect((await read(counsellor, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await read(colleague)).status).toBe(403);
    expect((await read(auditor)).status).toBe(200);
    expect((await act(auditor, demo, 1, { action: 'cancel', reason: 'x' })).status).toBe(403);
  });
});

describe('ops.samples seed', () => {
  it('creates Tanisha as described in the brief, labelled sample, idempotently', async () => {
    const context = { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} };
    const all = [...coreSeeds, ...referenceSeeds, ...sampleSeeds];
    await runSeeds(ctx.db, all, context);
    await runSeeds(ctx.db, all, context);
    const leads = await ctx.db
      .select()
      .from(opsLeads)
      .where(inArray(opsLeads.studentEmail, [TANISHA_EMAIL]));
    expect(leads).toHaveLength(1);
    const tanisha = leads[0]!;
    expect(tanisha).toMatchObject({ studentName: 'Tanisha Demo Student', isSample: true });
    expect(tanisha.studentPhone).toBeNull();
    const [demo] = await ctx.db.select().from(opsDemos).where(eq(opsDemos.leadId, tanisha.id));
    const d = await loadDemo(ctx.db, manager, demo!.id);
    expect(d.demo.isSample).toBe(true);
    expect(d.sessions.map((s) => s.attendance)).toEqual(['present', 'present', 'scheduled']);
    expect(d.progress.label).toBe('2 of 3 days attended');
    expect(d.view).toBe('current');
    expect(d.mock).toBe('pending');
    const item = (k: string) => d.checklist.items.find((i) => i.key === k)!;
    expect(item('fee_structure_explained')).toMatchObject({ status: 'pending', recorded: true });
    expect(item('admission_process_explained').status).toBe('pending');
    expect(item('student_feedback').recorded).toBe(false);
    expect(item('guardian_feedback').recorded).toBe(false);
  });
});

// --- demo days, KYC, fees, duplicates (owner brief 21 Oct 2026 §5) ------------------------------

/** ISO instant at `hour`:00 IST on the IST date `days` from today. */
const ist = (days: number, hour: number) =>
  new Date(
    `${istToday(new Date(Date.now() + days * 86_400_000))}T${String(hour).padStart(2, '0')}:00:00+05:30`,
  ).toISOString();

describe('demo days with several classes (acceptance 2)', () => {
  let t1: StaffUser;
  let sub: StaffUser;
  beforeAll(async () => {
    t1 = await staffUser(ctx.db, ['teacher'], { name: 'Sample Maths Teacher' });
    sub = await staffUser(ctx.db, ['teacher'], { name: 'Sample Substitute Teacher' });
  });
  /** Day 1: two classes, day 2: one, day 3: two — in the past (from `base` days) so attendance can be recorded. */
  const plan = (base = -6) => [
    { dayNumber: 1, startsAt: ist(base, 10), subject: 'English' },
    { dayNumber: 1, startsAt: ist(base, 12), subject: 'Maths', teacherStaffId: t1.staffId },
    { dayNumber: 2, startsAt: ist(base + 1, 10), subject: 'Logic' },
    { dayNumber: 3, startsAt: ist(base + 2, 10), subject: 'English' },
    { dayNumber: 3, startsAt: ist(base + 2, 12), subject: 'GK' },
  ];
  /** Each booking gets its own days, so the teacher is never double-booked. */
  let base = -6;
  async function bookPlan() {
    const res = await callRoute<Demo>(
      createDemo,
      post(counsellor, {
        admissionId: await counselledCase(counsellor),
        sessions: plan((base -= 4)),
      }),
    );
    expect(res.status).toBe(201);
    return res.data!;
  }

  it('a day keeps one date: no make-up class on a later date, no moving one class off its day; the whole day moves with a reason; an attended (late) class never moves', async () => {
    const demo = await bookPlan();
    const [d1a, d1b, d2] = demo.sessions;
    const act = (sessionId: string, body: object) =>
      callRoute(sessionAction, post(counsellor, body), { id: demo.id, sessionId });
    expect((await act(d2!.id, { action: 'attendance', attendance: 'absent' })).status).toBe(200);
    const makeUp = { dayNumber: 2, startsAt: ist(-1, 10), subject: 'Logic', reason: 'Missed' };
    const refused = await callRoute(addSession, post(counsellor, makeUp), { id: demo.id });
    expect(refused.status).toBe(400); // an absent day is never "made up" on a later date
    const move = { action: 'reschedule', startsAt: ist(-3, 10), reason: 'Family function' };
    expect((await act(d1a!.id, move)).status).toBe(400); // day 1's other class stays behind
    const ontoDay2 = { ...move, startsAt: ist(base + 1, 15), wholeDay: true };
    expect((await act(d1a!.id, ontoDay2)).status).toBe(400); // day 2's date is taken
    const early = { ...move, startsAt: ist(base - 1, 10), wholeDay: true };
    expect((await act(d1a!.id, early)).status).toBe(200);
    const d = await loadDemo(ctx.db, counsellor, demo.id);
    expect(d.days[0]!.dates).toEqual([istToday(new Date(ist(base - 1, 10)))]);
    expect(d.days[0]!.sessions.map((s) => s.attendance)).toEqual(['rescheduled', 'rescheduled']);
    const moved = d.changes.filter((c) => c.field === 'schedule');
    expect(moved.map((c) => c.sessionId).sort()).toEqual([d1a!.id, d1b!.id].sort()); // originals kept
    expect(moved.every((c) => c.reason === 'Family function')).toBe(true);
    const day3 = demo.sessions[3]!.id;
    expect((await act(day3, { action: 'attendance', attendance: 'late' })).status).toBe(200);
    expect((await act(day3, { ...move, startsAt: ist(base + 2, 15) })).status).toBe(400);
  });

  it('books 3 days × several classes; a 4th day is refused at booking and when adding a class', async () => {
    const admissionId = await counselledCase(counsellor);
    const four = [...plan(), { dayNumber: 4, startsAt: ist(-3, 10), subject: 'Maths' }];
    const refused = await callRoute(createDemo, post(counsellor, { admissionId, sessions: four }));
    expect(refused.status).toBe(400);
    expect(refused.error?.message).toContain('3 demo day(s)');
    const res = await callRoute<Demo>(
      createDemo,
      post(counsellor, { admissionId, sessions: plan() }),
    );
    expect(res.data).toMatchObject({ plannedDayCount: 3, plannedSessionCount: 5 });
    expect(res.data!.sessions.map((s) => s.dayNumber)).toEqual([1, 1, 2, 3, 3]);
    const add = (body: object, user = counsellor) =>
      callRoute(addSession, post(user, body), { id: res.data!.id });
    const extraDay = { dayNumber: 4, startsAt: ist(-3, 10), subject: 'Maths', reason: 'Missed' };
    const fourth = await add(extraDay);
    expect(fourth.status).toBe(400);
    expect(fourth.error?.message).toContain('"Extra demo days"');
    expect((await add({ dayNumber: 2, startsAt: ist(-5, 14), subject: 'Maths' })).status).toBe(201);
    expect((await add({ dayNumber: 2, startsAt: ist(-5, 14), subject: 'GK' })).status).toBe(400); // overlap
    const d = await loadDemo(ctx.db, counsellor, res.data!.id);
    expect(d.days.map((x) => x.sessions.length)).toEqual([2, 2, 2]);
    expect(d.progress).toMatchObject({ daysScheduled: 3, planned: 3, liveSessions: 6 });
    const body = { dayNumber: 2, startsAt: ist(-5, 16), subject: 'Maths' };
    expect(
      (
        await callRoute(addSession, buildRequest('/x', { method: 'POST', json: body }), {
          id: res.data!.id,
        })
      ).status,
    ).toBe(401);
    expect((await add(body, teacher as StaffUser)).status).toBe(403);
    expect((await add(body, colleague)).status).toBe(403); // own scope
    expect((await add({ ...body, dayNumber: 0 })).status).toBe(400);
  });

  it('day summary from mixed classes; corrections need a reason and permission and keep history', async () => {
    const demo = await bookPlan();
    const rec = (i: number, body: object, user: { token: string } = counsellor) =>
      callRoute(sessionAction, post(user, body), { id: demo.id, sessionId: demo.sessions[i]!.id });
    const mark = (i: number, attendance: string) => rec(i, { action: 'attendance', attendance });
    for (const [i, a] of [
      [0, 'absent'],
      [1, 'present'],
      [2, 'late'],
      [3, 'excused'],
      [4, 'absent'],
    ] as const)
      expect((await mark(i, a)).status).toBe(200);
    let d = await loadDemo(ctx.db, counsellor, demo.id);
    expect(d.days.map((x) => x.state)).toEqual(['attended', 'attended', 'absent']);
    expect(d.progress).toMatchObject({ attended: 2, sessionsAttended: 2, liveSessions: 5 });
    expect(d.progress.label).toBe('2 of 3 days attended');
    const fix = { action: 'attendance', attendance: 'present', reason: 'Register checked again' };
    expect((await rec(4, { action: 'attendance', attendance: 'present' })).status).toBe(400);
    expect((await rec(4, fix, colleague)).status).toBe(403);
    expect((await rec(4, fix, auditor)).status).toBe(403);
    expect((await rec(4, fix)).status).toBe(200);
    d = await loadDemo(ctx.db, counsellor, demo.id);
    expect(d.progress.attended).toBe(3);
    const history = d.changes.filter((c) => c.sessionId === demo.sessions[4]!.id);
    expect(history.map((h) => [h.previousValue, h.newValue, h.reason]).sort()).toEqual([
      ['absent', 'present', 'Register checked again'],
      ['scheduled', 'absent', null],
    ]);
  });

  it('a substitute is recorded per class, needs a reason once recorded, and the history keeps both teachers', async () => {
    const demo = await bookPlan();
    const rec = (body: object) =>
      callRoute(sessionAction, post(counsellor, body), {
        id: demo.id,
        sessionId: demo.sessions[1]!.id,
      });
    expect((await rec({ action: 'attendance', attendance: 'present' })).status).toBe(200);
    const swap = {
      action: 'assign',
      teacherStaffId: sub.staffId,
      subject: 'Maths',
      isSubstitute: true,
    };
    expect((await rec(swap)).status).toBe(400);
    expect((await rec({ ...swap, reason: 'Planned teacher was ill' })).status).toBe(200);
    const d = await loadDemo(ctx.db, counsellor, demo.id);
    const s = d.sessions.find((x) => x.id === demo.sessions[1]!.id)!;
    expect(s).toMatchObject({
      teacherStaffId: sub.staffId,
      isSubstitute: true,
      attendance: 'present',
    });
    const teacherRows = d.changes.filter((c) => c.field === 'teacher');
    expect(teacherRows).toHaveLength(2);
    expect(teacherRows.map((c) => [c.previousValue, c.newValue])).toEqual(
      expect.arrayContaining([
        ['Planned teacher', 'Substitute'],
        [t1.staffId, sub.staffId],
      ]),
    );
    expect(teacherRows.every((c) => c.reason === 'Planned teacher was ill')).toBe(true);
    expect(d.teacherNames[t1.staffId]).toBe('Sample Maths Teacher');
    // Day 1's review is due from the substitute who taught the attended class (no teacher on the other).
    expect(d.feedback.find((f) => f.dayNumber === 1)?.teachers).toEqual([
      expect.objectContaining({ staffId: sub.staffId, isSubstitute: true, state: 'pending' }),
    ]);
  });
});

const caseOf = async (id: string) =>
  (
    await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, id as never))
  )[0]!;

describe('canonical identity from booking (acceptance 1, brief §3)', () => {
  it('booking creates and links one core.students row; booking again for the case reuses it', async () => {
    const demo = await book(counsellor, [24, 48, 72]);
    const { studentId, leadId } = await caseOf(demo.admissionId);
    expect(studentId).toBeTruthy();
    const [lead] = await ctx.db.select().from(opsLeads).where(eq(opsLeads.id, leadId));
    const named = () =>
      ctx.db.select().from(students).where(eq(students.fullName, lead!.studentName));
    expect(await named()).toEqual([expect.objectContaining({ id: studentId, isSample: false })]);
    const close = { action: 'outcome', outcome: 'cancelled', reason: 'Family travelling' };
    expect((await callRoute(demoAction, post(counsellor, close), { id: demo.id })).status).toBe(
      200,
    );
    const again = await callRoute<Demo>(
      createDemo,
      post(counsellor, { admissionId: demo.admissionId, sessions: sessions(100, 124, 148) }),
    );
    expect(again.status).toBe(201);
    expect((await caseOf(demo.admissionId)).studentId).toBe(studentId);
    expect(await named()).toHaveLength(1);
  });

  it('two cases of one lead booked at the same time share one identity', async () => {
    const firstCase = await counselledCase(counsellor);
    const { leadId } = await caseOf(firstCase);
    const enq = await callRoute<{ admission: { id: string } }>(
      enquiry,
      post(counsellor, { sourceCode: 'WEBINAR', programmeCode: 'CUET' }),
      { id: leadId },
    );
    const secondCase = enq.data!.admission.id;
    await callRoute(activity, post(counsellor, { kind: 'call', outcome: 'connected_two_way' }), {
      id: leadId,
    });
    const s = await callRoute<{ id: string }>(
      counselling,
      post(counsellor, {
        admissionId: secondCase,
        type: 'student_counselling',
        startsAt: hoursFromNow(-190),
        mode: 'online',
      }),
    );
    await callRoute(counsellingUpdate, post(counsellor, { action: 'complete', outcome: 'Demo' }), {
      id: s.data!.id,
    });
    const booked = await Promise.all(
      [firstCase, secondCase].map((admissionId, i) =>
        callRoute(
          createDemo,
          post(counsellor, { admissionId, sessions: sessions(500 + i, 524 + i, 548 + i) }),
        ),
      ),
    );
    expect(booked.map((b) => b.status)).toEqual([201, 201]);
    const ids = [(await caseOf(firstCase)).studentId, (await caseOf(secondCase)).studentId];
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBe(ids[0]);
  });

  it('a teacher can store a review of a demo class for a demo student (one feedback store)', async () => {
    const t = await staffUser(ctx.db, ['teacher'], { name: 'Sample Review Teacher' });
    const res = await callRoute<Demo>(
      createDemo,
      post(counsellor, {
        admissionId: await counselledCase(counsellor),
        sessions: [-30, -29, -28].map((d, i) => ({
          startsAt: ist(d, 11),
          subject: 'Logic',
          teacherStaffId: i === 0 ? t.staffId : null,
        })),
      }),
    );
    expect(res.status).toBe(201);
    const demo = res.data!;
    const s1 = demo.sessions[0]!.id;
    await callRoute(
      sessionAction,
      post(counsellor, { action: 'attendance', attendance: 'present' }),
      {
        id: demo.id,
        sessionId: s1,
      },
    );
    const { studentId } = await caseOf(demo.admissionId);
    await createTeacherFeedback(ctx.db, t, {
      studentId: studentId!,
      scope: 'demo_session',
      demoSessionId: s1,
      subject: 'Logic',
      observedOn: istToday(new Date(Date.now() - 30 * 86_400_000)),
      observations: 'Followed the argument structure well.',
      status: 'final',
      visibility: 'internal',
    } as never);
    const d = await loadDemo(ctx.db, manager, demo.id);
    expect(d.feedback[0]?.teachers).toEqual([
      expect.objectContaining({ staffId: t.staffId, state: 'submitted' }),
    ]);
    expect(d.reviewTexts.map((r) => r.observations)).toEqual([
      'Followed the argument structure well.',
    ]);
  });
});

describe('demo KYC (acceptance 1) and shared guardian contacts (acceptance 3)', () => {
  it('booking and the KYC action write the configured basics on the lead; invalid input is 400', async () => {
    const admissionId = await counselledCase(counsellor);
    const res = await callRoute<Demo>(
      createDemo,
      post(counsellor, {
        admissionId,
        sessions: sessions(24, 48, 72),
        kyc: {
          city: 'Sikar',
          currentStage: 'gap_year',
          interestedProgrammeCodes: { CLAT: true, CUET: false },
        },
      }),
    );
    expect(res.status).toBe(201);
    const kyc = (body: object, user: { token: string } = counsellor) =>
      callRoute(demoAction, post(user, { action: 'kyc', ...body }), { id: res.data!.id });
    expect(
      (
        await kyc({
          guardianName: 'Sample Guardian',
          guardianRelationship: 'mother',
          emergencyContactPhone: '98765 43210',
          interestedProgrammeCodes: ['CLAT', 'CUET'],
          intendedStartDate: '2027-04-01',
        })
      ).status,
    ).toBe(200);
    expect((await kyc({ emergencyContactPhone: '12' })).status).toBe(400);
    expect((await kyc({ interestedProgrammeCodes: ['NOPE'] })).status).toBe(400);
    expect((await kyc({ city: 'x' }, colleague)).status).toBe(403);
    const [lead] = await ctx.db
      .select()
      .from(opsLeads)
      .where(eq(opsLeads.id, res.data!.leadId as never));
    expect(lead).toMatchObject({
      city: 'Sikar',
      currentStage: 'gap_year',
      guardianName: 'Sample Guardian',
      emergencyContactPhone: '+919876543210',
      interestedProgrammeCodes: ['CLAT', 'CUET'],
    });
    const d = await loadDemo(ctx.db, counsellor, res.data!.id);
    expect(d.kyc).toMatchObject({ privateVisible: true, startDate: '2027-04-01' });
    const hidden = await loadDemo(ctx.db, auditor, res.data!.id); // no ops:student_private:read
    expect(hidden.kyc.privateVisible).toBe(false);
    for (const k of ['guardianName', 'guardianPhone', 'city', 'emergencyContactPhone'])
      expect(hidden.kyc.lead).not.toHaveProperty(k);
    expect(hidden.kyc.lead.interestedProgrammeCodes).toEqual(['CLAT', 'CUET']);
    expect(d.kyc.sources.map((s) => s.code)).toEqual(['WEBINAR']);
  });

  it('siblings whose parent number sits in the student phone field are flagged "exact" yet never merged', async () => {
    const parent = phone();
    const lead = (studentName: string) =>
      callRoute<{ lead: { id: string } }>(
        createLead,
        post(counsellor, {
          studentName,
          studentPhone: parent,
          sourceCode: 'WEBINAR',
          acknowledgeDuplicates: { reason: 'Same parent phone, a sibling' },
        }),
      );
    const a = (await lead('Anaya Testcase')).data!.lead.id;
    const b = (await lead('Kabir Example')).data!.lead.id;
    const flags = await ctx.db
      .select()
      .from(opsDuplicateFlags)
      .where(eq(opsDuplicateFlags.leadId, b as never));
    expect(flags.map((f) => f.level)).toEqual(['exact']);
    const merge = await callRoute(
      mergeLead,
      post(manager, { targetLeadId: a, note: 'Same family' }),
      {
        id: b,
      },
    );
    expect(merge.status).toBe(409);
    expect(merge.error?.message).toContain('correct the name first');
  });

  it('two children sharing a parent phone are flagged "possible", shown on the demo, and never merged', async () => {
    const guardianPhone = phone();
    const first = await counselledCase(counsellor, { guardianPhone, studentName: 'Ira Testcase' });
    const second = await counselledCase(counsellor, {
      guardianPhone,
      studentName: 'Vihaan Example',
    });
    const leadOf = async (id: string) =>
      (
        await ctx.db
          .select()
          .from(opsAdmissions)
          .where(eq(opsAdmissions.id, id as never))
      )[0]!.leadId;
    const [a, b] = [await leadOf(first), await leadOf(second)];
    const flags = await ctx.db
      .select()
      .from(opsDuplicateFlags)
      .where(eq(opsDuplicateFlags.leadId, b));
    expect(flags.map((f) => [f.matchedLeadId, f.level])).toEqual([[a, 'possible']]);
    const demo = await callRoute<Demo>(
      createDemo,
      post(counsellor, { admissionId: second, sessions: sessions(24, 48, 72) }),
    );
    const d = await loadDemo(ctx.db, counsellor, demo.data!.id);
    expect(d.kyc.duplicates).toEqual([expect.objectContaining({ level: 'possible' })]);
    const demoA = await callRoute<Demo>(
      createDemo,
      post(counsellor, { admissionId: first, sessions: sessions(24, 48, 72) }),
    );
    expect(demoA.status).toBe(201);
    const ids = [(await caseOf(first)).studentId, (await caseOf(second)).studentId];
    expect(new Set(ids).size).toBe(2); // two children, two identities: never linked by a shared phone
    const merge = await callRoute(
      mergeLead,
      post(manager, { targetLeadId: a, note: 'Same family' }),
      {
        id: b,
      },
    );
    expect(merge.status).toBe(409);
    expect(merge.error?.message).toContain('siblings');
    const [still] = await ctx.db.select().from(opsLeads).where(eq(opsLeads.id, b));
    expect(still?.mergedIntoLeadId).toBeNull();
  });
});

describe('demo fee from ledger rows (no paid checkbox)', () => {
  it('unpaid → part paid → paid → refund back to part paid; a waiver settles another demo; record_fee is gone', async () => {
    const finance = await staffUser(ctx.db, ['finance_officer']);
    const today = istToday(new Date());
    const fees = async (demo: Demo) => (await loadDemo(ctx.db, manager, demo.id)).fees;
    const entry = (demo: Demo, input: object) =>
      recordFee(ctx.db, finance, demo.admissionId, {
        chargeCategory: 'demo',
        demoId: demo.id,
        ...input,
      } as never);
    const pay = (demo: Demo, rupees: string, ref: string) =>
      entry(demo, {
        kind: 'received',
        amountRupees: rupees,
        paymentDate: today,
        method: 'cash',
        receiptReference: ref,
      });
    const demo = await book(counsellor, [24, 48, 72]);
    expect(await fees(demo)).toMatchObject({ state: 'not_assessed', balancePaise: null });
    await entry(demo, { kind: 'due', amountRupees: '1000' });
    expect(await fees(demo)).toMatchObject({ state: 'unpaid', assessedPaise: 100000 });
    const first = await pay(demo, '400', 'test-only-R1');
    expect(await fees(demo)).toMatchObject({
      state: 'part_paid',
      paidPaise: 40000,
      balancePaise: 60000,
    });
    await pay(demo, '600', 'test-only-R2');
    expect(await fees(demo)).toMatchObject({ state: 'paid', balancePaise: 0 });
    await feeRecordAction(ctx.db, finance, first.id, {
      action: 'refund',
      amountRupees: '400',
      paymentDate: today,
      receiptReference: 'test-only-R3',
      notes: 'Family asked for part of it back',
    } as never);
    expect(await fees(demo)).toMatchObject({
      state: 'part_paid',
      paidPaise: 60000,
      refundedPaise: 40000,
    });
    const other = await book(counsellor, [24, 48, 72]);
    await entry(other, { kind: 'due', amountRupees: '1000' });
    await entry(other, { kind: 'waiver', amountRupees: '1000', notes: 'Sibling already enrolled' });
    expect(await fees(other)).toMatchObject({ state: 'waived', paidPaise: 0, balancePaise: 0 });
    const legacy = { action: 'record_fee', feeStatus: 'paid_verified', feeReference: 'x' };
    expect((await callRoute(demoAction, post(counsellor, legacy), { id: other.id })).status).toBe(
      400,
    );
  });
});
