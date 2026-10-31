/**
 * A stopped workspace (D-011.2, RVD-005, 006, 008, 009): every screen and job that reads Academic
 * says so and states nothing false. Each row runs with Academic refusing connections, and again
 * with it up as the control: the honest words then go away and the real facts are shown.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { eq } from 'drizzle-orm';
import { can, type Permission } from '@elevate/authorization';
import { opsAdmissions, opsDemoSessions, opsDemos } from '@elevate/database';
import { authedRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import AdmissionsPage from '../../src/app/admissions/page';
import { GET as testRoute } from '../../src/app/api/v1/assessments/[id]/route';
import { POST as runJob } from '../../src/app/api/v1/jobs/[job]/route';
import { GET as openReport, POST as makeReport } from '../../src/app/api/v1/students/[id]/report/route';
import StudentPage from '../../src/app/students/[id]/page';
import StudentsPage from '../../src/app/students/page';
import EditTestPage from '../../src/app/tests/[id]/edit/page';
import TestPage from '../../src/app/tests/[id]/page';
import TestsPage from '../../src/app/tests/page';
import { istToday } from '../../src/domain/dates';
import { previewConversion } from '../../src/server/conversion';
import { refusal } from '../../src/server/assessments';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { caseOf, identity } from './lifecycle-fixtures';
import { TEST_ID, testDetail } from './tests-ops-fixtures';

const access = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('../../src/ui/frame', async (orig) => ({
  ...(await orig<object>()),
  gate: async (permission: Permission) => ({
    status: can(access.user as never, permission) ? 'allowed' : 'forbidden',
    user: access.user,
    modules: ['ops'],
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

const ctx = setupTestDatabase();
let manager: StaffUser;
let studentId: string;
let enrolmentId: string;
let demoId: string;
/** Classes Academic holds a mark for. */
const marked: string[] = [];
let filterDates: string[];
let farClass: string;
const AT = '2026-10-01T00:00:00.000Z';
const BATCH = 'Sample CLAT batch A';
const TEACHER = 'Sample Actual Teacher';

/** A real refused connection, as `fetch` reports it when nothing listens on the port. */
const stopped = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }),
  );

/** Academic answering each internal route Ops reads here. Fictional data only. */
const running = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const { pathname, searchParams } = new URL(String(input));
      const data = pathname.endsWith('/demo-attendance')
        ? {
            items: marked
              .filter((id) => searchParams.get('ids')!.split(',').includes(id))
              .map((opsDemoSessionId) => ({
                opsDemoSessionId,
                academicSessionId: crypto.randomUUID(),
                status: 'present',
                recordedAt: AT,
                teacherStaffIds: [],
                teacherNames: [TEACHER],
              })),
          }
        : pathname.endsWith('/summary')
          ? {
              contract: 'academic.student_summary',
              version: 1,
              generatedAt: AT,
              studentId: crypto.randomUUID(),
              window: { from: '2026-09-01', to: '2026-09-30' },
              enrolments: [
                {
                  enrolmentId,
                  programmeCode: 'CLAT',
                  batchId: null,
                  batchName: BATCH,
                  status: 'active',
                  teachers: [],
                },
              ],
              attendance: { held: 0, present: 0, partial: 0, late: 0, absent: 0, excused: 0 },
              results: [],
            }
          : pathname.endsWith('/teaching-assignments')
            ? {
                contract: 'academic.teaching_assignments',
                version: 1,
                generatedAt: AT,
                total: 0,
                page: 1,
                pageSize: 100,
                items: [],
              }
            : pathname.endsWith('/enrolment-exits/run')
              ? { processed: 0, failed: 0, skipped: 0 }
              : pathname.endsWith('/reviews')
                ? { contract: 'academic.student_reviews', version: 1, generatedAt: AT, student: null, reviews: [] }
                : testDetail();
      return Response.json({ data });
    }),
  );

const page = async (node: ReactNode) => {
  access.user = manager;
  return (await new Response((await prerender(node)).prelude).text()).replaceAll('<!-- -->', '');
};

/** Status, code, words, answer and anything logged: what a person and the log would see. */
const job = async (name: string) => {
  const logged: string[] = [];
  for (const s of [process.stdout, process.stderr])
    vi.spyOn(s, 'write').mockImplementation((c) => (logged.push(String(c)), true));
  const r = await callRoute(
    runJob,
    authedRequest(manager, `/ops/api/v1/jobs/${name}`, { method: 'POST' }),
    { job: name },
  );
  vi.restoreAllMocks();
  return JSON.stringify({ status: r.status, code: r.error?.code, message: r.error?.message, data: r.data, logged });
};
const student = (tab: string) => () =>
  page(
    <StudentPage
      params={Promise.resolve({ id: studentId })}
      searchParams={Promise.resolve({ tab })}
    />,
  );

const STOPPED = 'That workspace is not running';
const HEADER: Row = [
  ['batch to be assigned'],
  ['batch not known, Academic OS unavailable'],
  [`batch ${BATCH}, from Academic OS`],
];
/** [false when down, honest when down (gone when up), true when up] */
type Row = [string[], string[], string[]];
const CASES: [string, () => Promise<string>, ...Row][] = [
  [
    '/ops/admissions: the list says so and asserts no attendance (RVD-005)',
    () => page(<AdmissionsPage searchParams={Promise.resolve({ view: 'current' })} />),
    ['2 of 3 days attended', 'Attendance to record', 'No teacher assigned', 'Not held or not recorded yet'],
    ['Source unavailable', STOPPED, 'Attendance not known: Academic OS unavailable'],
    ['3 of 3 days attended', 'No class ahead', TEACHER],
  ],
  [
    '/ops/admissions: the demo record',
    () => page(<AdmissionsPage searchParams={Promise.resolve({ open: demoId })} />),
    ['2 of 3 days attended', 'Attendance to record'],
    ['Attendance not known: Academic OS unavailable', 'Not known: Academic OS unavailable'],
    ['3 of 3 days attended', TEACHER],
  ],
  ...['overview', 'kyc', 'enrolments', 'onboarding', 'fees', 'attendance', 'assessments', 'feedback', 'reports', 'timeline'].map(
    (tab): [string, () => Promise<string>, ...Row] => [`student record, ${tab} tab (RVD-006, STU-03)`, student(tab), ...HEADER],
  ),
  [
    '/ops/tests/:id/edit names the cause (RVD-009)',
    () => page(<EditTestPage params={Promise.resolve({ id: TEST_ID })} />),
    ['Something went wrong'],
    ['Source unavailable', 'Academic OS could not be read', STOPPED],
    ['Save changes'],
  ],
  [
    'GET a test: a stopped workspace is a plain refusal, not a 500',
    async () => {
      const r = await callRoute(testRoute, authedRequest(manager, '/ops/api/v1/x'), { id: TEST_ID });
      return JSON.stringify({ status: r.status, code: r.error?.code, message: r.error?.message });
    },
    ['"status":500', 'INTERNAL'],
    ['"status":409', STOPPED],
    ['"status":200'],
  ],
  [
    'enrolment-exits job: plain words, nothing alarming in the log (RVD-008)',
    () => job('enrolment-exits'),
    ['"status":500', 'INTERNAL', 'request failed'],
    ['"status":409', 'could not be reached', STOPPED, 'nothing was changed'],
    ['"status":200', '"processed":0'],
  ],
  [
    'demo marks job: refused, never "Done." with a count of nothing',
    () => job('demo-academic-marks'),
    ['"status":200', 'request failed'],
    ['"status":409', 'could not be reached', STOPPED, 'nothing was copied'],
    ['"synced"'],
  ],
  [
    'student report: the frozen copy states no false batch',
    async () => {
      const made = await callRoute<{ referenceCode: string }>(
        makeReport,
        authedRequest(manager, '/ops/api/v1/x', {
          method: 'POST',
          json: { audience: 'internal', from: '2026-09-01', to: '2026-09-30' },
        }),
        { id: studentId },
      );
      const r = await callRoute<{ view: { programmes: unknown } }>(
        openReport,
        authedRequest(manager, `/ops/api/v1/x?ref=${made.data!.referenceCode}`),
        { id: studentId },
      );
      return JSON.stringify(r.data!.view.programmes);
    },
    ['To be assigned'],
    ['Kept in Academic OS'],
    [BATCH],
  ],
  [
    'conversion preview: the checklist count is a floor',
    async () => JSON.stringify((await previewConversion(ctx.db, manager, demoId)).checklist.label),
    [],
    ['At least', 'Academic OS unavailable'],
    ['of 11 done'],
  ],
];

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Manager' });

  const enrolled = await caseOf(ctx.db, manager.id, await identity(ctx.db, 'Sample Placed Student'), 'enrolled');
  studentId = enrolled.studentId!;
  enrolmentId = enrolled.enrolmentId!;
  // Academic placed the batch after enrolment: Ops holds the enrolment and no batch.
  await ctx.db.update(opsAdmissions).set({ enrolledBatchId: null }).where(eq(opsAdmissions.id, enrolled.id));

  /** A demo with these classes on consecutive days, the last one `lastDaysAgo` back. */
  const demoWith = async (name: string, attendances: readonly ('present' | 'scheduled')[], lastDaysAgo = 1) => {
    const a = await caseOf(ctx.db, manager.id, await identity(ctx.db, name), 'demo_scheduled');
    const [demo] = await ctx.db
      .insert(opsDemos)
      .values({
        admissionId: a.id,
        leadId: a.leadId,
        feeTermsState: 'not_discussed',
        plannedSessionCount: 3,
        plannedDayCount: 3,
        createdBy: manager.id,
      })
      .returning();
    const rows = await ctx.db
      .insert(opsDemoSessions)
      .values(
        attendances.map((attendance, i) => ({
          demoId: demo!.id,
          sessionNumber: i + 1,
          dayNumber: i + 1,
          startsAt: new Date(Date.now() - (attendances.length - 1 - i + lastDaysAgo) * 86_400_000),
          subject: 'Legal reasoning',
          attendance,
          ...(attendance === 'present' ? { recordedAt: new Date(), recordedBy: manager.id } : {}),
        })),
      )
      .returning();
    return { id: demo!.id, classes: rows.sort((x, y) => x.sessionNumber - y.sessionNumber) };
  };
  // Days 1 and 2 recorded here; day 3 marked by its teacher in Academic, which Ops cannot know while it is down.
  const recorded = await demoWith('Sample Demo Student', ['present', 'present', 'scheduled']);
  demoId = recorded.id;
  // Nothing recorded here; only day 3 marked in Academic.
  const unrecorded = await demoWith('Sample Filter Student', ['scheduled', 'scheduled', 'scheduled']);
  marked.push(recorded.classes[2]!.id, unrecorded.classes[2]!.id);
  filterDates = unrecorded.classes.map((c) => istToday(c.startsAt));
  farClass = (await demoWith('Sample Far Student', ['scheduled'], 20)).classes[0]!.id;
  marked.push(farClass);
});

afterEach(() => vi.unstubAllGlobals());

describe('Academic stopped', () => {
  it.each(CASES)('%s', async (_name, run, falseWords, honest) => {
    stopped();
    const out = await run();
    for (const words of falseWords) expect(out).not.toContain(words);
    for (const words of honest) expect(out).toContain(words);
  });
});

describe('control: Academic running', () => {
  it.each(CASES)('%s', async (_name, run, _false, honest, truth) => {
    running();
    const out = await run();
    for (const words of truth) expect(out).toContain(words);
    for (const words of honest) expect(out).not.toContain(words);
  });
});

describe('a test Academic does not have', () => {
  it.each([
    ['the test page', () => <TestPage params={Promise.resolve({ id: TEST_ID })} />],
    ['the edit page', () => <EditTestPage params={Promise.resolve({ id: TEST_ID })} />],
  ])('%s says Not found, not "Source unavailable"', async (_name, node) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'NOT_FOUND', message: 'x' } }, { status: 404 })));
    const out = await page(node());
    expect(out).toContain('Not found');
    expect(out).not.toContain('Source unavailable');
  });
});

describe('a failed read is not followed by another (a hung Academic would wait twice)', () => {
  it.each([
    ['the edit page', () => <EditTestPage params={Promise.resolve({ id: TEST_ID })} />],
    ['the test list', () => <TestsPage searchParams={Promise.resolve({})} />],
  ])('%s does not then ask for the teachers', async (_name, node) => {
    stopped();
    await page(node());
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/assessments'))).toBe(true);
    expect(urls.filter((u) => u.includes('/teaching-assignments'))).toEqual([]);
  });
});

describe('student list and Enrolments tab with no batch known to Ops (either way)', () => {
  it.each([
    ['the list', () => page(<StudentsPage searchParams={Promise.resolve({})} />), 'Batch to be assigned', 'Batch kept in Academic OS'],
    ['the Enrolments table', student('enrolments'), 'To be assigned', 'Kept in Academic OS'],
  ])('%s does not claim an enrolled student has no batch', async (_name, run, falseWords, honest) => {
    stopped();
    const out = await run();
    expect(out).not.toContain(falseWords);
    expect(out).toContain(honest);
  });
});

describe('date filter on /ops/admissions, Academic running: it picks demos, not which marks count', () => {
  const list = (filter: Record<string, string>) =>
    page(<AdmissionsPage searchParams={Promise.resolve({ view: 'current', ...filter })} />);

  it.each([
    ['no filter (control)', () => ({})],
    ['a range on day 1 only', () => ({ from: filterDates[0]!, to: filterDates[0]! })],
    ['a range on day 3 only', () => ({ from: filterDates[2]!, to: filterDates[2]! })],
  ])('%s: the same days attended', async (_name, filter) => {
    running();
    const out = await list(filter());
    expect(out).toContain('1 of 3 days attended');
    expect(out).toContain('3 of 3 days attended');
    expect(out).not.toContain('0 of 3 days attended');
    expect(out).not.toContain('2 of 3 days attended');
  });

  it('asks nothing about a demo with no class in the range (the Overview uses this list)', async () => {
    running();
    await list({ from: filterDates[0]!, to: filterDates[0]! });
    const asked = vi.mocked(fetch).mock.calls.map((c) => String(c[0])).join(' ');
    expect(asked).toContain(marked[1]);
    expect(asked).not.toContain(farClass);
  });
});

describe('words for a refused write to Academic', () => {
  it.each([
    [0, STOPPED, 409, /could not be reached \(That workspace is not running\), so nothing was changed/],
    [0, 'Could not reach the source', 409, /could not be reached .*so nothing was changed/],
    // A timed-out write may have been saved: never "nothing was changed".
    [0, 'Timed out', 409, /^Academic OS did not answer in time\. Check .* before trying again\.$/],
    [500, 'HTTP 500', 500, /reported a problem/],
  ])('status %i, %s', (status, message, http, words) => {
    const e = refusal({ ok: false, status, error: { code: 'UNAVAILABLE', message } });
    expect(e.status).toBe(http);
    expect(e.message).toMatch(words);
  });
});
