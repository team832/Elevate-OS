/**
 * AI draft helpers (owner request 23 Oct 2026): OpenAI is simulated (fetch to https://ai.test);
 * the real API is never called. Not set up, permissions per feature, min group size, redaction,
 * the key never leaving the server, the daily limit, timeouts and bad output. Fictional people only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDatabase } from '@elevate/testing';
import { auditEvents, opsStaffTasks, students } from '@elevate/database';
import * as csvRoute from '../../src/app/api/v1/ai/csv-mapping/route';
import * as feedbackRoute from '../../src/app/api/v1/ai/feedback-summary/route';
import * as taskBriefRoute from '../../src/app/api/v1/ai/task-brief/route';
import { workRoutes } from '../../src/work';
import { updateSetting } from '../../src/server/settings';
import type { StaffUser } from './fixtures';
import { ADMISSION_NUMBER, call, feedbackFixtures } from './feedback-fixtures';

const ctx = setupTestDatabase();
const { f, record, moderate, newSummary, patchSummary, upload, act } = feedbackFixtures(ctx);
const KEY = 'test-only-openai-key-123456';
type Items = { items: { name: string; label: string; value: string; shown?: string }[] };

const sent: { auth: string | null; body: Record<string, string> }[] = [];
let reply: () => Response | Promise<Response>;
const answer = (obj: unknown) => () =>
  Response.json({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(obj) }] }],
  });

beforeAll(async () => {
  // Real-looking (non-sample) fictional people: their names must never leave Elevate OS.
  await ctx.db
    .insert(students)
    .values(['Priya Malhotra', 'Rohit Jain', 'Riya Sharma'].map((fullName) => ({ fullName })));
  vi.stubEnv('OPENAI_API_KEY', KEY);
  vi.stubEnv('OPENAI_MODEL', 'test-model');
  vi.stubEnv('OPENAI_BASE_URL', 'https://ai.test/v1');
  const academic = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).startsWith('https://ai.test/')) return academic(input, init);
      sent.push({
        auth: new Headers(init?.headers).get('authorization'),
        body: JSON.parse(String(init?.body)),
      });
      return reply();
    }),
  );
});
afterEach(() => {
  sent.length = 0;
});

const draftSummary = (who: StaffUser, summaryId: string) =>
  call<Items>(feedbackRoute, 'POST', who, '/ops/api/v1/ai/feedback-summary', { summaryId });
const csv = (who: StaffUser, json: object) =>
  call<Items>(csvRoute, 'POST', who, '/ops/api/v1/ai/csv-mapping', json);
const aiAudit = (who: StaffUser) =>
  ctx.db.select().from(auditEvents).where(eq(auditEvents.actorUserId, who.id));

async function summaryWith(n: number, month: string) {
  for (let i = 0; i < n; i++) {
    const r = await record({
      studentId: f.studentId,
      periodStart: `${month}-01`,
      periodEnd: `${month}-28`,
      feedbackOn: `${month}-10`,
      rating: 4,
      comment: `priya and rohit copy answers; Priya copies. राहुल सर is late. Riya Sharma EL/2026/014, roll 42, IPMATC12APR27. The teacher explains integration well. Test on 16-09-2026 and 2026-09-16. Call +91 98290 12345 or asha@example.test, ${ADMISSION_NUMBER}, batch SAMPLE-B1.`,
    });
    await moderate(r.data!.id, { action: 'approve' });
  }
  return (await newSummary({ periodStart: `${month}-01`, periodEnd: `${month}-28` })).data!;
}

describe('AI drafts', () => {
  it('not set up: refused in plain words, OpenAI never called, nothing audited', async () => {
    vi.stubEnv('OPENAI_MODEL', '');
    const s = await summaryWith(5, '2026-01');
    const res = await draftSummary(f.u.hr_manager, s.id);
    vi.stubEnv('OPENAI_MODEL', 'test-model');
    expect(res.status).toBe(409);
    expect(res.error?.message).toBe('AI drafting is not set up.');
    expect(sent).toHaveLength(0);
    expect(await aiAudit(f.u.hr_manager)).not.toContainEqual(
      expect.objectContaining({ action: 'ai.draft_requested' }),
    );
  });

  it('feedback summary: below the minimum group size there is no AI draft', async () => {
    const s = await summaryWith(4, '2026-02');
    const res = await draftSummary(f.u.hr_manager, s.id);
    expect(res.status).toBe(409);
    expect(res.error?.message).toContain('at least 5 approved responses');
    expect(sent).toHaveLength(0);
  });

  it('feedback summary: only redacted comments and means go out; the key never comes back or into the audit', async () => {
    const s = await summaryWith(5, '2026-03');
    reply = answer({ strengths: 'Explains clearly.', areasToImprove: 'Doubt clearing is slow.' });
    const res = await draftSummary(f.u.hr_manager, s.id);
    expect(res.status).toBe(200);
    expect(res.data!.items).toEqual([
      { name: 'strengths', label: 'Strengths', value: 'Explains clearly.' },
      { name: 'areasToImprove', label: 'Areas to improve', value: 'Doubt clearing is slow.' },
    ]);
    const [req] = sent;
    expect(req!.auth).toBe(`Bearer ${KEY}`);
    expect(req!.body).toMatchObject({ model: 'test-model', store: false });
    expect(req!.body.input).toContain('Overall rating: 4 of 5');
    for (const kept of ['The teacher explains integration well', '16-09-2026', '2026-09-16'])
      expect(req!.body.input).toContain(kept);
    for (const secret of [
      'priya',
      'Priya',
      'rohit',
      'राहुल',
      'Riya',
      'Sharma',
      'EL/2026',
      'roll 42',
      'IPMATC12APR27',
      '98290',
      'example.test',
      ADMISSION_NUMBER,
      'SAMPLE-B1',
      KEY,
    ])
      expect(JSON.stringify(req!.body)).not.toContain(secret);
    expect(req!.body.instructions).toContain('never soften');
    expect(JSON.stringify(res)).not.toContain(KEY);
    const rows = (await aiAudit(f.u.hr_manager)).filter((r) => r.action.startsWith('ai.'));
    expect(rows.map((r) => [r.action, r.metadata])).toEqual([
      ['ai.draft_requested', { feature: 'feedbackSummary', inputChars: req!.body.input!.length }],
      ['ai.draft_finished', { feature: 'feedbackSummary', status: 'ok' }],
    ]);
    expect(rows[1]!.entityId).toBe(rows[0]!.id);
    expect(JSON.stringify(rows)).not.toMatch(/Explains clearly|doubts|test-only-openai/);
    // An approved summary is no longer drafted.
    expect((await patchSummary(s.id, { action: 'approve' })).status).toBe(200);
    expect((await draftSummary(f.u.hr_manager, s.id)).status).toBe(409);
    expect(sent).toHaveLength(1);
  });

  it('permissions: a teacher cannot use the feedback or CSV helpers; nobody drafts a summary about themselves', async () => {
    const s = await summaryWith(5, '2026-04');
    expect((await draftSummary(f.u.teacher, s.id)).status).toBe(403);
    expect(
      (await csv(f.u.teacher, { kind: 'feedback', headers: ['Teacher'], samples: [] })).status,
    ).toBe(403);
    const own = await newSummary({
      teacherStaffId: f.hrSubject.staffId,
      periodStart: '2026-04-01',
      periodEnd: '2026-04-28',
    });
    expect((await draftSummary(f.hrSubject, own.data!.id)).status).toBe(404);
    expect(sent).toHaveLength(0);
  });

  it('round 8: comments from imported rows that may be about the drafter never go out', async () => {
    const s = await summaryWith(5, '2026-05');
    const p = await upload(
      'Teacher,Batch,Period start,Period end,Rating,Comment\nDEMO-T01,SAMPLE-B1,2026-05-01,2026-05-28,4,Sample HR Subject ran zebra drills.',
      'ai-round8.csv',
    );
    await act(p.data!.id, 'commit', { approve: true });
    reply = answer({ strengths: 'Sample.', areasToImprove: 'Sample.' });
    for (const who of [f.hrSubject, f.u.hr_manager])
      expect((await draftSummary(who, s.id)).status).toBe(200);
    expect(sent.map((r) => JSON.stringify(r.body).includes('zebra'))).toEqual([false, true]);
  });

  it('CSV matching: headings and value shapes only (a raw value is refused); suggestions are checked', async () => {
    const raw = await csv(f.u.hr_manager, {
      kind: 'feedback',
      headers: ['Tutor'],
      samples: [['Sample Respondent Asha']],
    });
    expect(raw.status).toBe(400);
    reply = answer({
      columns: [
        { index: 0, field: 'teacher' },
        { index: 1, field: 'teacher' }, // a field twice: dropped
        { index: 2, field: 'no_such_field' },
      ],
    });
    const res = await csv(f.u.hr_manager, {
      kind: 'feedback',
      headers: ['Tutor', 'Faculty', 'Remarks'],
      samples: [['code (letters and digits)', 'short text', 'long text']],
    });
    expect(res.data!.items).toEqual([
      {
        name: 'fields.0',
        label: 'Column “Tutor”',
        value: 'teacher',
        shown: 'Teacher (staff code or exact full name)',
      },
    ]);
    expect(sent[0]!.body.input).toContain('"Remarks" — samples: long text');
    // Headings are redacted; a heading that looks like a value (a header-less file) is "[value]".
    sent.length = 0;
    for (const headers of [
      ['Riya Sharma', 'EL/2026/014', 'Mr Gupta explains badly about doubts in the evening batch'],
      ['DEMO-T01', '2026-10-19 09:02', 'in', 'Sample Respondent Asha'],
      ['Teacher', 'Subject', 'Student name'],
    ])
      expect((await csv(f.u.hr_manager, { kind: 'feedback', headers, samples: [] })).status).toBe(
        200,
      );
    const out = sent.map((x) => x.body.input).join(' ');
    expect(out).toContain('0. "[name]"');
    expect(out).toContain('1. "[value]"');
    expect(out).toContain('2. "Mr [name] explains badly about doubts in"');
    for (const heading of ['0. "Teacher"', '1. "Subject"', '2. "Student name"'])
      expect(out).toContain(heading);
    for (const leak of [
      'Riya',
      'Sharma',
      'Gupta',
      'EL/2026',
      'evening',
      'DEMO-T01',
      '2026-10-19',
      'Asha',
    ])
      expect(out).not.toContain(leak);
    expect(
      (await csv(f.u.admissions_counsellor, { kind: 'attendance', headers: ['x'], samples: [] }))
        .status,
    ).toBe(403);
  });

  it('daily limit per person (setting), counted from the audit rows of today', async () => {
    const me = f.u.operations_manager;
    await updateSetting(ctx.db, me, { key: 'ai.daily_limit_per_user', value: { limit: 1 } });
    reply = answer({ columns: [{ index: 0, field: 'staffCode' }] });
    const body = { kind: 'attendance', headers: ['Emp'], samples: [] };
    expect((await csv(me, body)).status).toBe(200);
    const second = await csv(me, body);
    expect(second.status).toBe(429);
    expect(second.error?.message).toContain("today's AI drafts");
    await updateSetting(ctx.db, me, { key: 'ai.daily_limit_per_user', value: { limit: 0 } });
    const off = await csv(f.u.hr_manager, body);
    expect([off.status, off.error?.message]).toEqual([409, 'AI drafting is switched off.']);
    await updateSetting(ctx.db, me, { key: 'ai.daily_limit_per_user', value: { limit: 50 } });
  });

  it.each([
    ['timeout', () => Promise.reject(new DOMException('aborted', 'TimeoutError'))],
    ['upstream_error', () => new Response(`bad key ${KEY}`, { status: 401 })],
    ['invalid_output', answer({ strengths: 42 })],
    ['invalid_output', () => Response.json({ status: 'incomplete', output: [] })],
  ] as const)('%s: a plain message, never the key or a stack', async (status, r) => {
    reply = r;
    const logs: string[] = [];
    for (const s of [process.stdout, process.stderr])
      vi.spyOn(s, 'write').mockImplementation((c) => (logs.push(String(c)), true));
    const res = await call<Items>(
      taskBriefRoute,
      'POST',
      f.u.hr_manager,
      '/ops/api/v1/ai/task-brief',
      {
        text: 'Make the mock test answer key by Friday',
      },
    );
    vi.restoreAllMocks();
    expect(res.status).toBe(500);
    expect(res.error?.message).toBe("AI drafting didn't respond. Try again or write it yourself.");
    expect(JSON.stringify(res) + logs.join('')).not.toContain(KEY);
    const [last] = (await aiAudit(f.u.hr_manager))
      .filter((x) => x.action === 'ai.draft_finished')
      .slice(-1);
    expect(last!.metadata).toMatchObject({ feature: 'taskBrief', status });
  });

  it('task brief: names and codes masked, counts and dates kept', async () => {
    reply = answer({
      title: 'Grade papers',
      expectedDeliverable: 'Graded papers',
      acceptanceCriteria: ['All graded'],
      checklist: ['Collect', 'Grade'],
      dueOn: '2026-09-16',
      dueTime: null,
    });
    const res = await call<Items>(
      taskBriefRoute,
      'POST',
      f.u.hr_manager,
      '/ops/api/v1/ai/task-brief',
      {
        text: 'Ask Priya to grade 120 papers of IPMATC12APR27 by 2026-09-16',
      },
    );
    expect(res.data!.items.map((i) => i.name)).toEqual([
      'title',
      'expectedDeliverable',
      'acceptanceCriteria',
      'checklist',
      'dueOn',
    ]);
    expect(sent[0]!.body.input).toContain('Ask [name] to grade 120 papers of [code] by 2026-09-16');
  });

  it('report draft: only the signed-in person’s own recorded work, through the Academic mount', async () => {
    const day = '2026-09-15';
    for (const [who, title] of [
      [f.u.teacher, 'Worksheet for chapter 4, graded 120 papers, call Priya about EL/2026/014'],
      [f.teacherB, 'Other secret plan'],
    ] as const)
      await ctx.db.insert(opsStaffTasks).values({
        staffId: who.staffId,
        title,
        dueOn: day,
        originalDueOn: day,
        createdBy: who.id,
        createdAt: new Date(`${day}T08:00:00+05:30`),
        status: 'in_progress',
      });
    reply = answer({
      summary: 'Worked on the worksheet.',
      notes: 'None recorded.',
      nextDayPlan: 'Finish it.',
    });
    const res = await call<Items>(
      workRoutes['ai/report-draft'],
      'POST',
      f.u.teacher,
      '/academic/api/v1/ai/report-draft',
      { periodKind: 'day', reportDate: day },
    );
    expect(res.status).toBe(200);
    expect(res.data!.items.map((i) => i.label)).toEqual([
      'Progress and deliverables',
      'Blockers',
      'Plan for the next working day',
    ]);
    expect(sent[0]!.body.input).toContain(
      'Worksheet for chapter 4, graded 120 papers, call [name] about [code] (due 2026-09-15)',
    );
    expect(sent[0]!.body.input).not.toContain('secret');
    expect(sent[0]!.body.input).not.toContain('Sample teacher'); // no name sent
  });
});
