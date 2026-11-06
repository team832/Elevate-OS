/** F4-08: the Academic calendar shows each viewer exactly what the source pages show them, and prints as a month. */
import { prerender } from 'react-dom/static';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '@elevate/authentication';
import { academicAssessments, opsStaffTasks, type Database } from '@elevate/database';
import { setupTestDatabase, type TestUser } from '@elevate/testing';
import CalendarPage from '../../src/app/calendar/page';
import {
  createAssessment,
  createExclusion,
  createSessions,
  createUnavailability,
} from '../../src/server';
import { createAssessmentBody, createExclusionBody } from '../../src/server/schemas';
import { actor, users, world, type Users, type World } from './fixtures';

const as = vi.hoisted(() => ({ user: null as AuthenticatedUser | null, db: null as unknown }));
vi.mock('@elevate/authentication/next', () => ({ getCurrentUser: async () => as.user }));
vi.mock('@elevate/database', async (original) => ({
  ...(await original<object>()),
  getDb: () => as.db as Database,
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
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
let u: Users;
let w: World;
let taskId: string;
const page = async (user: TestUser, sp: Record<string, string> = { date: '2099-03-01' }) => {
  as.user = user;
  // prerender separates adjacent text with <!-- -->; the reader sees one line.
  return (
    await new Response(
      (await prerender(await CalendarPage({ searchParams: Promise.resolve(sp) }))).prelude,
    ).text()
  ).replaceAll('<!-- -->', '');
};

beforeAll(async () => {
  as.db = ctx.db;
  u = await users(ctx.db);
  w = await world(ctx.db, u);
  const coord = actor(u.coordinator);
  const cls = (teacherStaffId: string, subjectId: string, date: string) => ({
    batchId: w.batch.id,
    subjectId,
    teacherStaffId,
    sessionType: 'teaching' as const,
    date,
    startTime: '09:00',
    durationMinutes: 75,
  });
  await createSessions(ctx.db, coord, [
    cls(w.teacherStaff, w.quant.id, '2099-03-02'),
    cls(w.teacher2Staff, w.verbal.id, '2099-03-03'),
  ]);
  await createAssessment(
    ctx.db,
    coord,
    createAssessmentBody.parse({
      code: 'CAL-1',
      title: 'Quant chapter test (fictional)',
      kind: 'chapter_test',
      batchId: w.batch.id,
      subjectId: w.quant.id,
      scheduledDate: '2099-03-04',
      startTime: '11:00',
      sections: [],
    }),
  );
  await createUnavailability(ctx.db, coord, {
    staffId: w.teacherStaff,
    fromDate: '2099-03-09',
    toDate: '2099-03-10',
    reason: 'Exam duty (fictional)',
  });
  await createUnavailability(ctx.db, coord, {
    staffId: w.teacher2Staff,
    fromDate: '2099-03-09',
    toDate: '2099-03-09',
    reason: 'Exam duty (fictional)',
  });
  await createExclusion(
    ctx.db,
    coord,
    createExclusionBody.parse({
      batchId: w.batch.id,
      kind: 'holiday',
      label: 'Holi (fictional)',
      date: '2099-03-12',
    }),
  );
  await createExclusion(
    ctx.db,
    coord,
    createExclusionBody.parse({
      kind: 'other',
      label: 'Centre maintenance (fictional)',
      date: '2099-03-13',
    }),
  );
  const [task] = await ctx.db
    .insert(opsStaffTasks)
    .values({
      staffId: w.teacherStaff,
      title: 'Upload worksheet (fictional)',
      dueOn: '2099-03-05',
      originalDueOn: '2099-03-05',
      createdBy: u.teacher.id,
      isSample: true,
    })
    .returning();
  taskId = task!.id;
});

describe('Academic calendar', () => {
  it('a teacher sees their own classes, tests, leave and tasks, each linked to its record', async () => {
    const html = await page(u.teacher);
    expect(html).toMatch(
      /<a class="el-cal-item" data-kind="class" href="\/academic\/teaching\/attendance\/[0-9a-f-]{36}"><span class="el-cal-kind">Class<\/span> <span class="el-cal-time">9:00 am<\/span> [^<]+ · Quant<\/a>/,
    );
    expect(html).toMatch(
      /data-kind="test" href="\/academic\/assessments\/[0-9a-f-]{36}">.*11:00 am<\/span> Quant chapter test \(fictional\)/,
    );
    expect(html.match(/Tina Teacher \(fictional\): not available/g)).toHaveLength(2); // 9 and 10 March
    expect(html).toContain(`href="/academic/tasks/${taskId}"`);
    expect(html).toContain(
      '<span class="el-cal-item" data-kind="closure"><span class="el-cal-kind">Closure</span> Centre maintenance (fictional) · centre-wide</span>',
    );
    expect(html).toContain(`data-kind="holiday" href="/academic/batches/${w.batch.id}"`);
  });

  it('a teacher never sees another teacher’s leave or classes', async () => {
    const html = await page(u.teacher);
    expect(html).not.toContain('Tom Teacher');
    expect(html).not.toContain('Verbal');
    expect(await page(u.teacher2)).not.toContain('Quant chapter test');
  });

  it('a coordinator sees every teacher’s classes and leave', async () => {
    const html = await page(u.coordinator);
    for (const item of [
      '· Quant',
      '· Verbal',
      'Tina Teacher (fictional): not available',
      'Tom Teacher (fictional): not available',
    ])
      expect(html).toContain(item);
    expect(html).not.toContain('Upload worksheet'); // another person's task
  });

  it('prints: the print line, the Print button and the month grid; navigation is by query string', async () => {
    const html = await page(u.coordinator);
    expect(html).toContain('class="el-print-header"');
    expect(html).toContain('>Print</button>');
    expect(html).toContain('<h2 id="el-cal-title">March 2099</h2>');
    expect(html).toContain('href="/academic/calendar?view=month&amp;date=2099-04-01"');
  });

  it('a month’s tests show however many earlier tests exist (over 1,000)', async () => {
    const test = (n: number, scheduledDate: string) => ({
      code: `CAL-BULK-${n}`,
      title: `Bulk test ${n} (fictional)`,
      kind: 'chapter_test' as const,
      batchId: w.batch.id,
      scheduledDate,
      status: 'scheduled' as const,
      isSample: true,
    });
    await ctx.db
      .insert(academicAssessments)
      .values(Array.from({ length: 1001 }, (_, n) => test(n, '2099-01-15')));
    await ctx.db
      .insert(academicAssessments)
      .values({ ...test(9999, '2099-03-27'), title: 'Late March mock (fictional)' });
    const html = await page(u.coordinator);
    expect(html).toContain('Late March mock (fictional)');
    expect(html).not.toContain('Showing the first');
  });
});
