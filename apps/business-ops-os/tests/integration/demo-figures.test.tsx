/**
 * One definition of "days attended" on every screen (D-060): a demo whose classes were all marked
 * present by the teacher in Academic reads 3 of 3 on the demo list, the admissions overview and the
 * funnel; with Academic stopped those figures are missing with "Source unavailable", never 0.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { eq } from 'drizzle-orm';
import { can, type Permission } from '@elevate/authorization';
import { opsDemoSessions, opsDemos, opsLeads } from '@elevate/database';
import { setupTestDatabase } from '@elevate/testing';
import AdmissionsOverviewPage from '../../src/app/admissions/overview/page';
import AdmissionsPage from '../../src/app/admissions/page';
import AdmissionsReportPage from '../../src/app/reports/admissions/page';
import ReportsPage from '../../src/app/reports/page';
import { addDays, istToday } from '../../src/domain/dates';
import { buildAdmissionsOverview } from '../../src/server/admissions-overview';
import { getDemo } from '../../src/server/demos';
import { buildOverview } from '../../src/server/overview';
import { buildAdmissionsFunnel } from '../../src/server/reports/admissions-funnel';
import { reviewsPayload, stubAcademic } from './academic-stub';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { caseOf, identity } from './lifecycle-fixtures';

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
const marked: string[] = [];
const today = istToday(new Date());
const period = { from: addDays(today, -29), to: today };

const stopped = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }),
  );
/** Academic holds a "present" for every class of these demos. Other internal routes fail. */
const running = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const { pathname, searchParams } = new URL(String(input));
      if (!pathname.endsWith('/demo-attendance')) return new Response('nope', { status: 503 });
      return Response.json({
        data: {
          items: marked
            .filter((id) => searchParams.get('ids')!.split(',').includes(id))
            .map((opsDemoSessionId) => ({
              opsDemoSessionId,
              academicSessionId: crypto.randomUUID(),
              status: 'present',
              recordedAt: null,
              teacherStaffIds: [],
              teacherNames: [],
            })),
        },
      });
    }),
  );

const page = async (node: ReactNode) => {
  access.user = manager;
  return (await new Response((await prerender(node)).prelude).text()).replaceAll('<!-- -->', '');
};
const stages = async () =>
  JSON.stringify(
    Object.fromEntries(
      (await buildAdmissionsFunnel(ctx.db, manager, period)).funnel.map((s) => [s.key, s.count]),
    ),
  );

/** [screen, what it shows, true with Academic up, true with it down, false with it down] */
const SCREENS: [string, () => Promise<string>, string[], string[], string[]][] = [
  [
    'demo list',
    () => page(<AdmissionsPage searchParams={Promise.resolve({ view: 'current' })} />),
    ['3 of 3 days attended'],
    ['Source unavailable', 'Attendance not known: Academic OS unavailable'],
    ['0 of 3 days attended'],
  ],
  [
    'admissions overview',
    async () =>
      (await page(<AdmissionsOverviewPage searchParams={Promise.resolve(period)} />)) +
      JSON.stringify((await buildAdmissionsOverview(ctx.db, manager, period)).demos.days),
    ['3 of 3 planned days', '"allDaysAttended":1'],
    ['Source unavailable: Academic OS could not be read', '"allDaysAttended":null'],
    ['0 of 3 planned days', '"allDaysAttended":0'],
  ],
  [
    'admissions funnel',
    async () =>
      (await page(<AdmissionsReportPage searchParams={Promise.resolve(period)} />)) + (await stages()),
    ['"attended":2', '"completed":2', '"converted":1'],
    ['Source unavailable', '"attended":null', '"completed":null', '"converted":null'],
    ['"attended":0', '"completed":0', '"converted":0'],
  ],
  [
    'reports card',
    () => page(<ReportsPage />),
    ['· 1 converted'],
    ['Source unavailable for converted and enrolled'],
    ['· 0 converted', '· 0 enrolled'],
  ],
];

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Manager' });
  const demoOf = async (name: string, status: 'demo_scheduled' | 'demo_attended', daysAgo: number[], converted = false) => {
    const a = await caseOf(ctx.db, manager.id, await identity(ctx.db, name), status);
    await ctx.db.update(opsLeads).set({ firstReceivedAt: new Date(Date.now() - 86_400_000) }).where(eq(opsLeads.id, a.leadId));
    const [demo] = await ctx.db
      .insert(opsDemos)
      .values({
        admissionId: a.id,
        leadId: a.leadId,
        feeTermsState: 'not_discussed',
        plannedSessionCount: daysAgo.length,
        plannedDayCount: daysAgo.length,
        createdBy: manager.id,
        ...(converted ? { outcome: 'converted', outcomeAt: new Date(), convertedAdmissionId: a.id } : {}),
      })
      .returning();
    const rows = await ctx.db
      .insert(opsDemoSessions)
      .values(
        daysAgo.map((d, i) => ({
          demoId: demo!.id,
          sessionNumber: i + 1,
          dayNumber: i + 1,
          startsAt: new Date(Date.now() - d * 86_400_000),
          subject: 'Quant',
        })),
      )
      .returning();
    marked.push(...rows.map((r) => r.id));
  };
  // Nothing recorded in Ops; every class marked present in Academic.
  await demoOf('Sample All Marked', 'demo_scheduled', [3, 2, 1]);
  // A converted lead whose only class is outside the overview's period, marked in Academic alone.
  await demoOf('Sample Converted', 'demo_attended', [40], true);
});

afterEach(() => vi.unstubAllGlobals());

describe('every screen counts the same days attended', () => {
  it.each(SCREENS)('%s, Academic running', async (_screen, show, truth, honest) => {
    running();
    const out = await show();
    for (const words of truth) expect(out).toContain(words);
    for (const words of honest.filter((w) => w !== 'Source unavailable')) expect(out).not.toContain(words);
  });

  it.each(SCREENS)('%s, Academic stopped: missing, never 0', async (_screen, show, _truth, honest, falseWords) => {
    stopped();
    const out = await show();
    for (const words of honest) expect(out).toContain(words);
    for (const words of falseWords) expect(out).not.toContain(words);
  });
});

describe('the /ops home', () => {
  it('asks Academic about each class once, however many blocks count them', async () => {
    running();
    await buildOverview(ctx.db, manager, period, { now: new Date() });
    const asked = vi
      .mocked(fetch)
      .mock.calls.map((c) => new URL(String(c[0])))
      .filter((u) => u.pathname.endsWith('/demo-attendance'))
      .flatMap((u) => u.searchParams.get('ids')!.split(','));
    expect(asked.sort()).toEqual([...marked].sort());
  });

  it('with Academic stopped its blocks read missing too', async () => {
    stopped();
    const o = await buildOverview(ctx.db, manager, period, { now: new Date() });
    expect(o.funnel).toMatchObject({ ok: true, data: { academicUnavailable: { reason: expect.any(String) } } });
    expect(o.pipeline).toMatchObject({ ok: true, data: { demos: { days: { allDaysAttended: null } } } });
  });
});

describe('a demo record states nothing it cannot know (RVD-011, RVD-012)', () => {
  let actual: StaffUser;
  let linked: { demo: string; session: string };
  let planned: { demo: string; session: string };
  const record = (open: string) =>
    page(<AdmissionsPage searchParams={Promise.resolve({ view: 'current', open })} />);
  const up = () =>
    stubAcademic({
      reviews: (url: URL) => reviewsPayload([], url.searchParams.get('coreStudentId')),
      'demo-attendance': {
        items: [linked, planned].map((c) => ({
          opsDemoSessionId: c.session,
          academicSessionId: c.session,
          status: 'present',
          recordedAt: null,
          teacherStaffIds: [actual.staffId],
          teacherNames: ['Sample Actual Teacher'],
        })),
      },
    });
  const demoWith = async (name: string, session: Partial<typeof opsDemoSessions.$inferInsert>) => {
    const a = await caseOf(ctx.db, manager.id, await identity(ctx.db, name), 'demo_scheduled');
    const [demo] = await ctx.db
      .insert(opsDemos)
      .values({ admissionId: a.id, leadId: a.leadId, feeTermsState: 'not_discussed', plannedSessionCount: 1, plannedDayCount: 1, createdBy: manager.id })
      .returning();
    const [row] = await ctx.db
      .insert(opsDemoSessions)
      .values({ demoId: demo!.id, sessionNumber: 1, dayNumber: 1, startsAt: new Date(Date.now() - 86_400_000), subject: 'Quant', ...session })
      .returning();
    return { demo: demo!.id, session: row!.id };
  };

  beforeAll(async () => {
    actual = await staffUser(ctx.db, ['teacher'], { name: 'Sample Actual Teacher' });
    const plan = await staffUser(ctx.db, ['teacher'], { name: 'Sample Plan Teacher' });
    // Linked to Academic, with no teacher in Ops: only Academic can name who taught.
    linked = await demoWith('Sample Linked Demo', {});
    // Planned in Ops with its attendance stored there, so not `unknown`; Academic names someone else.
    planned = await demoWith('Sample Planned Demo', { teacherStaffId: plan.staffId, attendance: 'present', recordedAt: new Date(), recordedBy: manager.id });
  });

  const stoppedChecks = async () => {
    stopped();
    const out = await record(linked.demo);
    expect(out).toContain('Not known: Academic OS unavailable');
    for (const falseWords of ['None awaited', 'No teacher has taken a class', 'No review expected', '0 of 1 days'])
      expect(out).not.toContain(falseWords);
    expect((await getDemo(ctx.db, manager, linked.demo)).attendance).toBe('unknown');
    const other = await record(planned.demo);
    expect(other).toContain('Sample Plan Teacher (planned; Academic OS unavailable)');
    for (const falseWords of ['None awaited', '0 of 1 received']) expect(other).not.toContain(falseWords);
  };

  it('Academic stopped, before Ops has seen the link: not known, and the plan is called the plan', stoppedChecks);

  it('control, Academic running: the review is awaited, the actual teacher is named', async () => {
    up();
    const out = await record(linked.demo);
    for (const words of ['1 awaited (see Teacher feedback)', 'No review submitted', 'Sample Actual Teacher'])
      expect(out).toContain(words);
    expect(out).not.toContain('Not known: Academic OS unavailable');
    expect((await getDemo(ctx.db, manager, linked.demo)).attendance).toBe('attended');
    const other = await record(planned.demo);
    expect(other).toContain('Sample Actual Teacher');
    expect(other).not.toContain('(planned; Academic OS unavailable)');
  });

  it('Academic stopped again, with the link now stored: the same words', stoppedChecks);
});
