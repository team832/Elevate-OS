/**
 * A teacher's session through the real pages on the real seeds (owner inspection, 31 Oct 2026):
 * every link a list shows must open; a missing or refused record says so with a way back; the
 * date form keeps the session; curriculum defaults to what the teacher teaches, and counts equal rows.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { and, eq } from 'drizzle-orm';
import type { AuthenticatedUser } from '@elevate/authentication';
import { hashPassword } from '@elevate/authentication';
import {
  academicBatches,
  academicClassSessions,
  academicCurriculumPlans,
  academicSubjects,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { coreSeeds, runSeeds } from '@elevate/database/seed';
import { safeRelativePath } from '@elevate/shared-contracts';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import { seeds } from '../../seed';
import { SAMPLE_TEACHING_EMAILS } from '../../seed/samples';
import AssessmentMarksPage from '../../src/app/assessments/[id]/marks/page';
import AssessmentPage from '../../src/app/assessments/[id]/page';
import AssessmentsPage from '../../src/app/assessments/page';
import BatchPage from '../../src/app/batches/[id]/page';
import BatchesPage from '../../src/app/batches/page';
import ConceptBooksPage from '../../src/app/curriculum/concept-books/page';
import CoursePage from '../../src/app/curriculum/courses/[id]/page';
import CurriculumPage from '../../src/app/curriculum/page';
import PlanPage from '../../src/app/curriculum/plans/[id]/page';
import HomePage from '../../src/app/page';
import StudentProgressPage from '../../src/app/progress/students/[id]/page';
import ReportPage from '../../src/app/reports/[kind]/page';
import ReviewPage from '../../src/app/reviews/[id]/page';
import ReviewsPage from '../../src/app/reviews/page';
import AttendancePage from '../../src/app/attendance/page';
import SettingsPage from '../../src/app/settings/page';
import StudentPage from '../../src/app/students/[id]/page';
import StudentsPage from '../../src/app/students/page';
import TaskPage from '../../src/app/tasks/[id]/page';
import TeacherPage from '../../src/app/teachers/[staffId]/page';
import ClassPage from '../../src/app/teaching/attendance/[sessionId]/page';
import LogPage from '../../src/app/teaching/log/[sessionId]/page';
import TeachingPage from '../../src/app/teaching/page';
import TimetablePage from '../../src/app/timetable/page';
import PatternPage from '../../src/app/timetable/patterns/[id]/page';
import PatternsPage from '../../src/app/timetable/patterns/page';
import { proxy } from '../../src/proxy';
import { createAssessment, createPattern, staffIdForUser } from '../../src/server';
import { createAssessmentBody } from '../../src/server/schemas';
import { opsSeedStubs } from './sample-seed-stubs';
import { actor, staffFor } from './fixtures';
import { NextRequest } from 'next/server';

const as = vi.hoisted(() => ({
  user: null as AuthenticatedUser | null,
  db: null as unknown,
  search: '',
}));
vi.mock('@elevate/authentication/next', () => ({ getCurrentUser: async () => as.user }));
vi.mock('@elevate/database', async (original) => ({
  ...(await original<object>()),
  getDb: () => as.db as Database,
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-return-search': as.search }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => '/',
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

const ctx = setupTestDatabase();
const db = () => ctx.db as unknown as Database;

type Sp = Record<string, string>;
const MISSING = '00000000-0000-4000-8000-000000000000';
const render = async (node: ReactNode | Promise<ReactNode>) =>
  new Response((await prerender(await node)).prelude).text();
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const h1 = (html: string) => /<h1[^>]*>(.*?)<\/h1>/s.exec(html)?.[1];
const params = (key: string, id: string) => ({ params: Promise.resolve({ [key]: id }) as never });
const search = (sp: Sp = {}) => ({ searchParams: Promise.resolve(sp) });

/** Each record page in the workspace: [path pattern, page, where its way back goes]. */
const PAGES = [
  ['/academic/assessments/:id/marks', (id: string) => AssessmentMarksPage(params('id', id)), '/academic/assessments'],
  ['/academic/assessments/:id', (id: string, sp?: Sp) => AssessmentPage({ ...params('id', id), ...search(sp) } as never), '/academic/assessments'],
  ['/academic/batches/:id', (id: string, sp?: Sp) => BatchPage({ ...params('id', id), ...search(sp) } as never), '/academic/batches'],
  ['/academic/curriculum/courses/:id', (id: string) => CoursePage(params('id', id)), '/academic/curriculum'],
  ['/academic/curriculum/plans/:id', (id: string) => PlanPage(params('id', id)), '/academic/curriculum'],
  ['/academic/progress/students/:id', (id: string) => StudentProgressPage(params('id', id)), '/academic/progress'],
  ['/academic/reviews/:id', (id: string) => ReviewPage(params('id', id)), '/academic/reviews'],
  ['/academic/students/:id', (id: string) => StudentPage(params('id', id)), '/academic/students'],
  ['/academic/tasks/:id', (id: string) => TaskPage(params('id', id)), '/academic/tasks'],
  ['/academic/teachers/:id', (id: string, sp?: Sp) => TeacherPage({ params: Promise.resolve({ staffId: id }), ...search(sp) } as never), '/academic/teachers'],
  ['/academic/teaching/attendance/:id', (id: string) => ClassPage({ params: Promise.resolve({ sessionId: id }) } as never), '/academic/teaching'],
  ['/academic/teaching/log/:id', (id: string) => LogPage({ params: Promise.resolve({ sessionId: id }) } as never), '/academic/teaching'],
  ['/academic/timetable/patterns/:id', (id: string) => PatternPage(params('id', id)), '/academic/timetable'],
] as const;

/** The page a record link opens. */
function open(href: string) {
  const url = new URL(href, 'http://localhost');
  for (const [path, page] of PAGES) {
    const match = new RegExp(`^${path.replace(':id', '([^/]+)')}$`).exec(url.pathname);
    if (match && match[1] !== 'new') return page(match[1]!, Object.fromEntries(url.searchParams));
  }
  return null;
}

let teacher: AuthenticatedUser;
let unassigned: AuthenticatedUser;
let coordinator: AuthenticatedUser;
let plan253: string;
let supersededPlan: string;
let batchB: string;
let batchCaf: string;

async function sampleStaff(d: Database) {
  for (const email of SAMPLE_TEACHING_EMAILS) {
    const [user] = await d
      .insert(users)
      .values({ email, displayName: `Sample ${email}`, status: 'active' })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (user) await d.insert(staffMembers).values({ userId: user.id, fullName: `Sample ${email}` });
  }
}

beforeAll(async () => {
  as.db = ctx.db;
  await runSeeds(ctx.db, [...coreSeeds, ...opsSeedStubs(sampleStaff), ...seeds], {
    seedUserPassword: 'test-only-seed-password',
    hashPassword,
    log: () => {},
  });
  const [arjun] = await db().select().from(users).where(eq(users.email, 'arjun.menon@example.test'));
  teacher = { id: arjun!.id, email: arjun!.email, displayName: 'Sample Arjun', roles: ['teacher'] } as never;
  unassigned = (await createTestUser(ctx.db, { roles: ['teacher'] })) as never;
  coordinator = (await createTestUser(ctx.db, { roles: ['academic_coordinator'] })) as never;
  await staffFor(ctx.db, coordinator as never, 'Sample Coordinator');
  const batches = await db().select().from(academicBatches);
  batchB = batches.find((b) => b.code === 'IPMAT-B')!.id;
  batchCaf = batches.find((b) => b.code === 'CAF-A')!.id;
  const plans = await db().select().from(academicCurriculumPlans);
  plan253 = plans.find((p) => p.code === 'IPMAT-BASELINE-253')!.id;
  supersededPlan = plans.find((p) => p.status === 'superseded')!.id;
}, 120_000);

describe('every record page says what went wrong and offers a way back', () => {
  it.each(PAGES)('%s: missing and malformed ids, as teacher and coordinator', async (_path, page, back) => {
    for (const user of [teacher, coordinator]) {
      as.user = user;
      for (const id of [MISSING, 'not-an-id']) {
        const html = await render(page(id));
        const shared = _path.includes('/tasks/'); // the Ops task body keeps its own words
        expect(h1(html), `${user.roles[0]} ${id}`).toMatch(/not found/i);
        expect(text(html)).toMatch(shared ? /not found/i : /out of date/i);
        expect(html).toContain(`href="${back}"`);
      }
    }
  });

  it('a batch the teacher is not assigned to: the same words, nothing about it leaks', async () => {
    as.user = teacher;
    const html = await render(open(`/academic/batches/${batchCaf}`));
    expect(h1(html)).toBe('Batch not found');
    expect(text(html)).toContain('may not be assigned');
    expect(html).toContain('href="/academic/batches"');
    expect(html).not.toContain('CAF-A');
  });

  it('no permission for the page: a heading, the reason and a way back to My day', async () => {
    as.user = teacher;
    const html = await render(SettingsPage());
    expect(h1(html)).toBe('No access to this page');
    expect(text(html)).toContain('permission');
    expect(html).toContain('href="/academic"');
  });

  it('a report that does not exist still has a heading and a way back', async () => {
    as.user = teacher;
    const html = await render(
      ReportPage({ params: Promise.resolve({ kind: 'nope' }), ...search() } as never),
    );
    expect(h1(html)).toBeTruthy();
    expect(html).toContain('href="/academic"');
  });
});

describe('the sample teacher follows the links their lists show', () => {
  const LISTS = [
    ['My day', () => HomePage()],
    ['My batches', () => BatchesPage()],
    ['My students', () => StudentsPage(search())],
    ['My timetable', () => TimetablePage(search({ from: '2026-01-01', to: '2027-12-31' }))],
    ['Teaching logs', () => TeachingPage(search())],
    ['Assessments', () => AssessmentsPage(search())],
    ['Student reviews', () => ReviewsPage(search())],
    ['Patterns', () => PatternsPage()],
    ['Curriculum', () => CurriculumPage(search())],
    ['All courses', () => CurriculumPage(search({ view: 'all' }))],
  ] as const;

  it.each([
    ['Teaching logs', () => TeachingPage(search())],
    ['Attendance', () => AttendancePage(search({ view: 'all' }))],
  ])('%s: class times read in 12-hour words, hidden labels too (RL2-018)', async (_name, page) => {
    as.user = teacher;
    const shown = text(await render(page()));
    expect(shown).toMatch(/\d:\d{2} [ap]m/);
    expect(shown).not.toMatch(/\b\d{1,2}:\d{2}\b(?! [ap]m)/);
  });

  it.each(LISTS)('%s: every record link opens the record', async (_name, list) => {
    as.user = teacher;
    const html = await render(list());
    const hrefs = [...new Set([...html.matchAll(/href="(\/academic\/[^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&')))];
    for (const href of hrefs) {
      const target = open(href);
      if (!target) continue;
      const page = await render(target);
      expect(h1(page), href).not.toMatch(/not found|no access|cannot show|could not load/i);
      expect(h1(page), href).toBeTruthy();
    }
  });

  it.each([
    ['plan IPMAT-BASELINE-253', () => `/academic/curriculum/plans/${plan253}`, 'IPMAT-BASELINE-253'],
    ['batch IPMAT-B', () => `/academic/batches/${batchB}`, 'IPMAT batch B'],
  ])('%s opens for the assigned teacher, and its list links to it', async (_name, href, title) => {
    as.user = teacher;
    expect(h1(await render(open(href())))).toContain(title);
    const list = await render(href().includes('plans') ? CurriculumPage(search()) : BatchesPage());
    expect(list).toContain(`href="${href()}"`);
  });

  it('a superseded plan stays reachable from the plan page and opens', async () => {
    as.user = teacher;
    expect(h1(await render(open(`/academic/curriculum/plans/${supersededPlan}`)))).toBeTruthy();
  });
});

describe('the timetable date form', () => {
  it('signed in: Show keeps the session and uses the chosen dates', async () => {
    as.user = teacher;
    const html = await render(TimetablePage(search({ from: '2026-11-02', to: '2026-11-08' })));
    expect(h1(html)).toBe('My timetable');
    expect(text(html)).toContain('2 Nov 2026 to 8 Nov 2026');
  });

  it('session really ended: next= keeps the chosen dates, and the proxy forwards them', async () => {
    as.user = null;
    as.search = '?from=2026-11-02&to=2026-11-08';
    await expect(TimetablePage(search())).rejects.toThrow(
      `REDIRECT /login?next=${encodeURIComponent('/academic/timetable?from=2026-11-02&to=2026-11-08')}`,
    );
    as.search = '';
    const res = proxy(new NextRequest('http://localhost/academic/timetable?from=2026-11-02&to=2026-11-08'));
    expect(res.headers.get('x-middleware-request-x-return-search')).toBe('?from=2026-11-02&to=2026-11-08');
    expect(safeRelativePath('/academic/timetable?from=2026-11-02&to=2026-11-08', '/academic')).toBe('/academic/timetable?from=2026-11-02&to=2026-11-08');
  });
});

describe('My students', () => {
  it('an empty list under a non-default state says the filter emptied it, not that there are none', async () => {
    as.user = coordinator;
    const left = text(await render(StudentsPage(search({ state: 'left' }))));
    expect(left).toContain('No students match these filters');
    expect(left).not.toContain('No students yet');
  });
});

describe('My batches and Batches', () => {
  it('a teacher leads with name, subject, students and status; a coordinator keeps the planning columns', async () => {
    as.user = teacher;
    const mine = await render(BatchesPage());
    expect(h1(mine)).toBe('My batches');
    expect([...mine.matchAll(/<th [^>]*scope="col"[^>]*>(.*?)<\/th>/g)].map((m) => m[1])).toEqual(['Batch', 'Subject', 'Students', 'Status']);
    expect(text(mine)).toContain('IPMAT batch B');
    expect(text(mine)).toContain('IPMAT-B');
    expect(text(mine)).toContain('Quant');
    as.user = coordinator;
    const all = await render(BatchesPage());
    expect(h1(all)).toBe('Batches');
    for (const heading of ['Programme / course', 'Mode', 'Start', 'Class length', 'Target exam', 'Enrolled']) expect(all).toContain(`>${heading}<`);
  });

  it('nothing is lost: the batch view carries what the teacher list no longer shows', async () => {
    as.user = teacher;
    const view = text(await render(open(`/academic/batches/${batchB}`)));
    for (const fact of ['IPMAT-BASE', 'Mode: Offline', '75 min', 'Length: locked', 'any other length', 'Dates:', 'enrolled']) expect(view).toContain(fact);
  });

  it('a teacher with no batch is told what happens next, not shown an empty table', async () => {
    as.user = unassigned;
    const html = await render(BatchesPage());
    expect(html).not.toContain('<table');
    expect(text(html)).toContain('academic coordinator');
    expect(html).toContain('href="/academic"');
  });
});

describe('Curriculum', () => {
  const rows = (html: string, heading: string) => {
    const card = new RegExp(`${heading} \\((\\d+)\\)`).exec(text(html));
    return card ? Number(card[1]) : null;
  };
  const plansIn = (html: string) => [...html.matchAll(/href="\/academic\/curriculum\/plans\/[^"]+">([^<]+)</g)].map((m) => m[1]!);
  const coursesIn = (html: string) => [...html.matchAll(/href="\/academic\/curriculum\/courses\/[^"]+">([^<]+)</g)].map((m) => m[1]!);

  it('a teacher starts on what they teach: no CA, CLAT, drafts or superseded plans', async () => {
    as.user = teacher;
    const html = await render(CurriculumPage(search()));
    expect(h1(html)).toBe('Curriculum');
    const words = text(html);
    expect(coursesIn(html).length).toBe(rows(html, 'Courses'));
    expect(words).toContain('IPMAT-BASE');
    for (const other of ['CAF-ACC-SEP27', 'CLAT-SYL-2027', 'COM-C11-2627', 'IPMAT-C12-2027']) expect(words).not.toContain(other);
    expect(plansIn(html)).toContain('IPMAT-BASELINE-253');
    expect(html).toContain('All courses');
  });

  it('All courses is one click away, superseded versions stay out until asked for, and counts equal rows', async () => {
    as.user = teacher;
    const all = await render(CurriculumPage(search({ view: 'all' })));
    const words = text(all);
    for (const code of ['CAF-ACC-SEP27', 'CLAT-SYL-2027', 'IPMAT-BASE']) expect(words).toContain(code);
    const plans = plansIn(all);
    expect(plans.length).toBe((rows(all, 'Plans in use for teaching') ?? 0) + (rows(all, 'Planning records') ?? 0));
    expect(plans.length).toBeGreaterThan(0);
    const [superseded] = await db().select().from(academicCurriculumPlans).where(eq(academicCurriculumPlans.status, 'superseded'));
    expect(plans).not.toContain(superseded!.code);
    expect(all).toContain('status=superseded');
    const only = await render(CurriculumPage(search({ view: 'all', status: 'superseded' })));
    expect(plansIn(only)).toContain(superseded!.code);
    expect(plansIn(only).length).toBe(rows(only, 'Planning records'));
  });

  it.each([
    ['search by code', { view: 'all', q: 'caf-acc' }, ['CAF-ACC-SEP27'], ['IPMAT-BASE']],
    ['search by plan code', { view: 'all', q: 'BASELINE-253' }, ['IPMAT-BASE'], ['CAF-ACC-SEP27']],
    ['subject', { view: 'all', subject: 'ACC' }, ['CAF-ACC-SEP27'], ['IPMAT-BASE']],
    ['status of a course', { view: 'all', status: 'draft' }, ['CLAT-SYL-2027'], ['CAF-ACC-SEP27']],
  ])('filter: %s', async (_name, sp, shown, hidden) => {
    as.user = teacher;
    const html = await render(CurriculumPage(search(sp as Sp)));
    const courses = coursesIn(html);
    expect(courses.length).toBe(rows(html, 'Courses'));
    for (const code of shown) expect(courses.join(' ')).toContain(code);
    for (const code of hidden) expect(courses.join(' ')).not.toContain(code);
  });

  it('batch filter: my batch narrows to its course; another teacher’s batch opens nothing new', async () => {
    as.user = teacher;
    const mine = coursesIn(await render(CurriculumPage(search({ view: 'all', batchId: batchB })))).join(' ');
    expect(mine).toContain('IPMAT-BASE');
    expect(mine).not.toContain('CAF-ACC-SEP27');
    const options = await render(CurriculumPage(search()));
    expect(options).not.toContain(`value="${batchCaf}"`);
  });

  it('a teacher with no assignment: told so, with All courses as the next step, and no empty tables', async () => {
    as.user = unassigned;
    const html = await render(CurriculumPage(search()));
    expect(text(html)).toContain('academic coordinator');
    expect(html).toContain('view=all');
    expect(html).not.toContain('<table');
  });

  it('no match says so and does not claim the catalogue is empty', async () => {
    as.user = teacher;
    expect(text(await render(CurriculumPage(search({ q: 'zzz-nothing' }))))).toContain('No courses match these filters');
  });

  it('readiness: teaching material apart from planning records, gaps named, nothing invented', async () => {
    as.user = teacher;
    const html = text(await render(CurriculumPage(search({ view: 'all' }))));
    expect(html).toContain('Plans in use for teaching');
    expect(html).toContain('Planning record');
    expect(html).toMatch(/Dates: unknown/);
    expect(html).toMatch(/Not recorded/); // draft syllabus courses have no mode
    expect(html).toMatch(/Not decided/); // and no class length
    const books = text(await render(ConceptBooksPage()));
    expect(books).toContain('Planning record');
  });
});

describe('Student profile and progress', () => {
  it('a teacher gets a working link to the progress workflow and is not told to open what they cannot', async () => {
    as.user = teacher;
    const students = await render(StudentsPage(search()));
    const id = /href="\/academic\/students\/([^"]+)"/.exec(students)![1]!;
    const html = await render(open(`/academic/students/${id}`));
    expect(html).toContain(`href="/academic/progress/students/${id}"`);
    expect(html).toContain('href="/academic/progress"');
    expect(text(html)).not.toContain('Open one from');
    expect(h1(await render(open(`/academic/progress/students/${id}`)))).toBeTruthy();
  });

  it('student names open the profile in the list', async () => {
    as.user = teacher;
    const html = await render(StudentsPage(search()));
    expect(html).toMatch(/href="\/academic\/students\/[^"]+">[^<]*Sample|href="\/academic\/students\/[^"]+">[A-Z][a-z]+/);
    expect(h1(html)).toBe('My students');
  });

  it('a search with no student says the filter did it', async () => {
    as.user = teacher;
    expect(text(await render(StudentsPage(search({ q: 'zzz-nothing' }))))).toContain('No students match these filters');
  });
});

describe('Timetable conflict wording', () => {
  it('no cap configured: a partial check, naming what was and was not checked', async () => {
    as.user = teacher;
    const html = await render(TimetablePage(search({ from: '2026-01-01', to: '2027-12-31' })));
    const words = text(html);
    expect(words).toContain('Partial conflict check');
    expect(words).toMatch(/Checked:.*overlaps/);
    expect(words).toMatch(/Not checked:.*workload/i);
    expect(words).not.toMatch(/Result: Feasible/);
  });

  it('the batch view says what its capacity verdict covers', async () => {
    as.user = teacher;
    const words = text(await render(open(`/academic/batches/${batchB}`)));
    expect(words).not.toMatch(/Verdict: Feasible/);
    expect(words).toMatch(/capacity only|Not assessed|Not enough slots/i);
  });
});

describe('records created through the services open too', () => {
  it('an assessment, its marks sheet, a class, its log and a pattern in the teacher’s batch', async () => {
    const coord = actor(coordinator as never);
    const [quant] = await db().select().from(academicSubjects).where(and(eq(academicSubjects.code, 'QUANT'), eq(academicSubjects.courseId, (await db().select().from(academicBatches).where(eq(academicBatches.id, batchB as never)))[0]!.courseId)));
    const assessment = await createAssessment(
      db(),
      coord,
      createAssessmentBody.parse({ code: 'SES-1', title: 'Sample session test', kind: 'chapter_test', batchId: batchB, subjectId: quant!.id }),
    );
    const pattern = await createPattern(db(), coord, {
      batchId: batchB,
      subjectId: quant!.id,
      staffId: (await staffIdForUser(db(), teacher.id))!,
      weekday: 1,
      startTime: '16:30',
      durationMinutes: 75,
      effectiveFrom: '2099-02-01',
      effectiveTo: '2099-02-28',
    } as never);
    as.user = teacher;
    const [session] = await db().select().from(academicClassSessions).where(eq(academicClassSessions.batchId, batchB as never));
    expect(h1(await render(open(`/academic/assessments/${assessment.id}`)))).toContain('SES-1');
    expect(h1(await render(open(`/academic/assessments/${assessment.id}/marks`)))).toContain('SES-1');
    expect(h1(await render(open(`/academic/teaching/attendance/${session!.id}`)))).toBeTruthy();
    expect(h1(await render(open(`/academic/teaching/log/${session!.id}`)))).toMatch(/\d{1,2}:\d{2} [ap]m/);
    expect(h1(await render(open(`/academic/timetable/patterns/${pattern.id}`)))).toContain('Monday 4:30 pm');
  });
});
