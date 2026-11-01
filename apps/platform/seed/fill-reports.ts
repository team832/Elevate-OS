/**
 * Owner, 31 Oct 2026: "The report is being downloaded". The Reports lists show past reports, so some
 * exist: made by the real services (generate, review, finalise, all audited), each frozen from the
 * sample rows as they stand. A report asks Academic OS over its internal routes, and no server runs
 * during a seed, so `withLocalAcademic` answers those same routes from Academic's own services in
 * this process. Only the platform may touch both modules (D-011.3). Teacher reports have no flag of
 * their own: markSampleRows records them for db:clear-samples.
 */
import { and, eq } from 'drizzle-orm';
import {
  opsReportExports,
  opsTeacherReportExports,
  students,
  users,
  staffMembers,
  type Database,
} from '@elevate/database';
import { knownPerson, markSampleRows } from '@elevate/database/seed';
import {
  buildStudentReviewsV1,
  buildStudentSummary,
  teacherActivity,
  todayIst,
} from '@elevate/academic-os/server';
import {
  generateStudentReport,
  generateTeacherReport,
  setStudentReportStatus,
} from '@elevate/business-ops-os/server';
import { seedActor } from '@elevate/business-ops-os/seed';
import { addDays, type IsoDate } from '@elevate/shared-types';

type Handler = (db: Database, id: string, q: URLSearchParams) => Promise<unknown>;
const window = (q: URLSearchParams) => ({ from: q.get('from')!, to: q.get('to')! });
const ROUTES: readonly [RegExp, Handler][] = [
  [/\/internal\/v1\/students\/([^/]+)\/summary/, (db, id, q) => buildStudentSummary(db, id, window(q))],
  [/\/internal\/v1\/reviews/, (db, _, q) => buildStudentReviewsV1(db, Object.fromEntries(q) as never)],
  [/\/internal\/v1\/teachers\/([^/]+)\/activity/, (db, id, q) => teacherActivity(db, id, window(q))],
];

/** Runs `work` with Academic's internal read routes answered in this process. */
export async function withLocalAcademic<T>(db: Database, work: () => Promise<T>) {
  const real = globalThis.fetch;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  // Nothing leaves the process, so nothing needs a real token.
  process.env.INTERNAL_SERVICE_TOKEN = token || 'local-seed-call-reaches-no-network-at-all';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    for (const [pattern, handler] of ROUTES) {
      const m = pattern.exec(url.pathname);
      if (m)
        return Response.json({ data: await handler(db, m[1] ?? '', url.searchParams) });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    return await work();
  } finally {
    globalThis.fetch = real;
    if (token === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = token;
  }
}

const STUDENT_REPORTS: readonly {
  first: string;
  audience: 'internal' | 'guardian';
  status: 'draft' | 'reviewed' | 'final';
  /** Days since it was made, and how many days it covers. */
  madeAgo: number;
  covers: number;
  comment: string;
  fees?: true;
}[] = [
  {
    first: 'Zoya',
    audience: 'internal',
    status: 'final',
    madeAgo: 1,
    covers: 60,
    comment: 'Settling in well. Fees are on track and the parent is responsive.',
  },
  {
    first: 'Zoya',
    audience: 'guardian',
    status: 'final',
    madeAgo: 1,
    covers: 60,
    comment: 'Zoya has made a confident start. Please encourage the weekly timed practice at home.',
  },
  {
    first: 'Kavya',
    audience: 'internal',
    status: 'final',
    madeAgo: 2,
    covers: 60,
    comment: 'All dues are clear. Her attendance needs watching: she missed two chapter tests.',
  },
  {
    first: 'Kavya',
    audience: 'guardian',
    status: 'reviewed',
    madeAgo: 2,
    covers: 60,
    comment: 'Kavya explains methods well to her group. Coming to every test is the next step.',
    fees: true,
  },
  {
    first: 'Diya',
    audience: 'internal',
    status: 'draft',
    madeAgo: 0,
    covers: 45,
    comment: 'Two missed classes and an overdue instalment; speak to the parent this week.',
  },
  {
    first: 'Diya',
    audience: 'guardian',
    status: 'final',
    madeAgo: 3,
    covers: 45,
    comment: 'Diya is strong in algebra. A short catch-up on percentages will help her most.',
  },
  {
    first: 'Arjun',
    audience: 'guardian',
    status: 'draft',
    madeAgo: 0,
    covers: 60,
    comment: 'Regular with homework and careful in his working.',
  },
  {
    first: 'Aditya',
    audience: 'internal',
    status: 'final',
    madeAgo: 1,
    covers: 90,
    comment: 'Left to prepare at home. The balance is with accounts.',
  },
  {
    first: 'Rohan',
    audience: 'internal',
    status: 'reviewed',
    madeAgo: 4,
    covers: 60,
    comment: 'Coming back into study well after a gap year.',
  },
];

const TEACHER_REPORTS: readonly [email: string, madeAgo: number, covers: number, comment: string][] =
  [
    [
      'teacher@example.test',
      1,
      30,
      'Steady month. Attendance marked on time; two teaching logs came in late.',
    ],
    [
      'teacher@example.test',
      31,
      30,
      'Took over the second Quant batch this month and settled quickly.',
    ],
    ['arjun.menon@example.test', 2, 30, 'Delivered every planned class; one review still to send.'],
    ['aditi.mehra@example.test', 5, 60, 'Good feedback from students; a few logs are overdue.'],
  ];

export async function seedFillReports(db: Database, log: (m: string) => void = () => {}) {
  const counsellor = await seedActor(db, 'admissions-counsellor@example.test');
  const manager = await seedActor(db, 'operations-manager@example.test');
  if (!counsellor || !manager) return log('platform.fill-reports skipped: no sample staff');
  const today = todayIst() as IsoDate;
  let made = 0;
  await withLocalAcademic(db, async () => {
    for (const r of STUDENT_REPORTS) {
      const [student] = await db
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.fullName, knownPerson(r.first).fullName), eq(students.isSample, true)));
      if (!student) continue;
      const seen = await db.$count(
        opsReportExports,
        and(eq(opsReportExports.studentId, student.id), eq(opsReportExports.audience, r.audience)),
      );
      if (seen) continue;
      const to = addDays(today, -r.madeAgo);
      const report = await generateStudentReport(db, counsellor.actor, student.id, {
        from: addDays(to, -r.covers),
        to,
        audience: r.audience,
        acknowledgement: r.audience === 'guardian',
        comment: r.comment,
        ...(r.fees ? { sections: ['overview', 'programmes', 'results', 'attendance', 'feedback', 'summary', 'fees'] } : {}),
      } as never);
      for (const move of r.status === 'final' ? (['reviewed', 'final'] as const) : r.status === 'reviewed' ? (['reviewed'] as const) : [])
        await setStudentReportStatus(db, manager.actor, student.id, report.referenceCode, move);
      await db
        .update(opsReportExports)
        .set({ at: new Date(`${to}T06:30:00.000Z`) })
        .where(eq(opsReportExports.id, report.id));
      made += 1;
    }
    for (const [email, madeAgo, covers, comment] of TEACHER_REPORTS) {
      const [teacher] = await db
        .select({ id: staffMembers.id })
        .from(staffMembers)
        .innerJoin(users, eq(users.id, staffMembers.userId))
        .where(eq(users.email, email));
      if (!teacher) continue;
      const to = addDays(today, -madeAgo);
      const from = addDays(to, -covers);
      const seen = await db.$count(
        opsTeacherReportExports,
        and(eq(opsTeacherReportExports.staffId, teacher.id), eq(opsTeacherReportExports.periodTo, to)),
      );
      if (seen) continue;
      const row = await generateTeacherReport(db, manager.actor, teacher.id, { from, to, comment });
      await db
        .update(opsTeacherReportExports)
        .set({ createdAt: new Date(`${to}T06:30:00.000Z`) })
        .where(eq(opsTeacherReportExports.id, row.id));
      await markSampleRows(db, 'ops.teacher_report_exports', [row.id]);
      made += 1;
    }
  });
  log(`platform.fill-reports: ${made} past report(s) made`);
}
