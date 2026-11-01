/**
 * Owner, 31 Oct 2026: "Fill everything, every detail, with mock data" and "made up everything". After
 * `npm run db:seed` every screen the owner named has complete made-up records in every state, the
 * demo teacher's login is populated through the services its screens call, no real teacher is in any
 * row, every phone is from the fake block, and db:clear-samples removes it all by the record the seed
 * left (never by a name), puts the Schar setting back to unset and leaves real rows alone; the
 * reference seed then brings the real teachers back with no sample history.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { checkPassword, hashPassword, type AuthenticatedUser } from '@elevate/authentication';
import {
  academicBatches,
  academicClassRecords,
  academicClassSessions,
  academicRooms,
  academicSubjects,
  academicTeacherReviews,
  academicTimetablePatterns,
  branches,
  opsAttendanceCorrections,
  opsEodReports,
  opsHolidays,
  opsHrRequestEvents,
  opsHrRequests,
  opsLeaveApplications,
  opsSettings,
  opsStaffProfiles,
  opsStaffTasks,
  opsTaskEvents,
  opsTaskSubmissions,
  opsWorkSchedules,
  staffMembers,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import {
  COVER_TEACHERS,
  coreSeeds,
  everySampleName,
  FAKE_PHONE_PATTERN,
  retireSampleLogins,
  runSeeds,
  SAMPLE_SCHAR,
  sampleRowIds,
} from '@elevate/database/seed';
import {
  addDays,
  toIsoDate,
  type RoleKey,
  type SessionId,
  type UserId,
} from '@elevate/shared-types';
import { setupTestDatabase } from '@elevate/testing';
import { seeds as academicSeeds } from '@elevate/academic-os/seed';
import {
  ClearSamplesRefused,
  clearSamples,
  seeds as opsSeeds,
} from '@elevate/business-ops-os/seed';
import { seeds as marketingSeeds } from '@elevate/marketing-os/seed';
import { seeds as platformSeeds } from '../../seed';
import { referenceSeedList } from '../../../../scripts/release/reference-seeds';
import { OWNER_SUPPLIED_STAFF } from '../../../business-ops-os/seed/teachers';
import {
  deriveDays,
  attendanceStaff,
  listRange,
} from '../../../business-ops-os/src/server/attendance';
import { myFeedback } from '../../../business-ops-os/src/server/feedback-teacher';
import { hrRequestListQuery } from '../../../business-ops-os/src/server/hr-requests-schemas';
import { hrQueue } from '../../../business-ops-os/src/server/hr-requests-read';
import { loadSettings } from '../../../business-ops-os/src/server/settings';
import { listTeachers as listOpsTeachers } from '../../../business-ops-os/src/server/teachers';
import { teacherDay } from '../../../academic-os/src/server/services/my-day';
import { previewPattern } from '../../../academic-os/src/server/services/patterns';

const ctx = setupTestDatabase();
const db = () => ctx.db as Database;
const context = { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} };
const DEMO = 'teacher@elevateeducation.in';

async function userOf(email: string) {
  const [u] = await db().select().from(users).where(eq(users.email, email));
  const roles = await db()
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, u!.id));
  const [staff] = await db().select().from(staffMembers).where(eq(staffMembers.userId, u!.id));
  const user = {
    id: u!.id as UserId,
    email,
    displayName: u!.displayName,
    roles: roles.map((r) => r.role as RoleKey),
    sessionId: 't' as SessionId,
  } as AuthenticatedUser;
  return { user, staffId: staff?.id ?? null };
}
const rows = async (q: string) =>
  ((await db().execute(sql.raw(q))) as unknown as { rows: Record<string, unknown>[] }).rows;
const groupCount = async <T extends { status: string }>(list: Promise<T[]>) =>
  (await list).reduce<Record<string, number>>(
    (m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }),
    {},
  );
/** A real person the seeds know nothing about. */
const realStaff = async (fullName: string) => {
  const [s] = await db().insert(staffMembers).values({ fullName }).returning();
  await db().insert(opsStaffProfiles).values({ staffId: s!.id });
  return s!;
};
const states = async (
  table: Parameters<ReturnType<Database['select']>['from']>[0] & { isSample: never; status: never },
) => groupCount(db().select().from(table).where(eq(table.isSample, true)) as never);

beforeAll(async () => {
  await runSeeds(
    db(),
    [...coreSeeds, ...marketingSeeds, ...academicSeeds, ...opsSeeds, ...platformSeeds],
    context,
  );
}, 280_000);

describe('tasks', () => {
  it('every sample task has a brief, a deliverable, done-when, department and requester', async () => {
    const tasks = await db().select().from(opsStaffTasks).where(eq(opsStaffTasks.isSample, true));
    expect(tasks.length).toBeGreaterThan(30);
    expect(
      tasks.filter((t) => !t.details || t.details.startsWith('Sample task:')).map((t) => t.title),
    ).toEqual([]);
    expect(tasks.filter((t) => !t.expectedDeliverable).map((t) => t.title)).toEqual([]);
    expect(tasks.filter((t) => !t.acceptanceCriteria).map((t) => t.title)).toEqual([]);
    expect(tasks.filter((t) => !t.departmentId).map((t) => t.title)).toEqual([]);
    expect(
      tasks
        .filter((t) => t.source !== 'self' && !t.requesterStaffId && !t.requesterNote)
        .map((t) => t.title),
    ).toEqual([]);
    // Submitted work carries its evidence, as the service requires when a deliverable is expected.
    const subs = await db().select().from(opsTaskSubmissions);
    expect(subs.filter((s) => !s.evidence || s.completionNote.startsWith('Version'))).toEqual([]);
  });

  it('the demo teacher has every state, and deadline changes say who and why', async () => {
    const { staffId } = await userOf(DEMO);
    const mine = await db().select().from(opsStaffTasks).where(eq(opsStaffTasks.staffId, staffId!));
    expect(new Set(mine.map((t) => t.status))).toEqual(
      new Set([
        'pending',
        'in_progress',
        'in_review',
        'changes_requested',
        'done',
        'cancelled',
        'draft',
      ]),
    );
    expect(mine.some((t) => t.blockedAt)).toBe(true);
    expect(mine.every((t) => !/race|^test/i.test(t.title))).toBe(true);
    const changes = await db()
      .select()
      .from(opsTaskEvents)
      .where(eq(opsTaskEvents.kind, 'due_changed'));
    expect(changes.length).toBeGreaterThan(2);
    expect(changes.every((c) => c.reason && c.actorUserId && c.data)).toBe(true);
    expect(await db().$count(opsTaskEvents, eq(opsTaskEvents.kind, 'comment'))).toBeGreaterThan(2);
    for (const task of mine.filter((t) => t.originalDueOn !== t.dueOn))
      expect(changes.some((c) => c.taskId === task.id)).toBe(true);
  });
});

describe('people and attendance', () => {
  it('names the made-up Schar for the sample set', async () => {
    const schar = await userOf(SAMPLE_SCHAR.email);
    expect((await loadSettings(db()))['hr.request_recipients'].value).toEqual({
      schar: schar.staffId,
    });
  });

  it('sample staff have a schedule and marked days; real staff get no sample row', async () => {
    const profiles = await db()
      .select()
      .from(opsStaffProfiles)
      .where(eq(opsStaffProfiles.isSample, true));
    expect(profiles.filter((p) => !p.workScheduleId)).toEqual([]);
    expect(await db().$count(opsWorkSchedules, eq(opsWorkSchedules.isDefault, true))).toBe(0);
    const people = await attendanceStaff(db(), { ids: profiles.map((p) => p.staffId) });
    const { from, to } = listRange({});
    const days = [...(await deriveDays(db(), people, from, to)).values()].flat();
    const count = (s: string) => days.filter((d) => d.status === s).length;
    expect(count('present')).toBeGreaterThan(count('unmarked'));
    expect(days.every((d) => d.scheduled !== null)).toBe(true);
    expect(await states(opsAttendanceCorrections as never)).toMatchObject({
      pending: 2,
      approved: 2,
      rejected: 1,
    });
    expect(await states(opsLeaveApplications as never)).toEqual({
      pending: 2,
      approved: 4,
      rejected: 1,
      cancelled: 2,
    });
  });

  it('a sample holiday changes no real person’s day, even one on the real branch', async () => {
    const [sikar] = await db().select().from(branches).where(eq(branches.code, 'SIKAR'));
    const real = await realStaff('Mohit Nandan');
    await db()
      .update(opsStaffProfiles)
      .set({ branchId: sikar!.id })
      .where(eq(opsStaffProfiles.staffId, real!.id));
    const demo = (await userOf(DEMO)).staffId!;
    const people = await attendanceStaff(db(), { ids: [real!.id, demo] });
    const today = toIsoDate();
    const days = await deriveDays(db(), people, addDays(today, -13), today);
    expect(days.get(demo)!.filter((d) => d.holiday)).toHaveLength(2);
    expect(days.get(real!.id)!.filter((d) => d.holiday || d.proposedHoliday)).toEqual([]);
  });

  it.each([
    ['ops.staff_tasks', 'staff_id'],
    ['ops.daily_attendance', 'staff_id'],
    ['ops.attendance_punches', 'staff_id'],
    ['ops.leave_applications', 'staff_id'],
    ['ops.attendance_corrections', 'staff_id'],
    ['ops.hr_requests', 'sender_staff_id'],
    ['ops.student_teacher_feedback', 'teacher_staff_id'],
    ['ops.teacher_feedback_summaries', 'teacher_staff_id'],
    ['ops.eod_reports', 'staff_id'],
  ])('no real teacher is on sample rows of %s', async (table, column) => {
    const names = OWNER_SUPPLIED_STAFF.map((t) => `'${t.fullName.replace(/'/g, "''")}'`).join(', ');
    const [r] = await rows(
      `SELECT count(*)::int AS n FROM ${table} t JOIN core.staff_members s ON s.id = t.${column}
       WHERE t.is_sample AND s.full_name IN (${names})`,
    );
    expect(r!.n).toBe(0);
  });

  it('every phone column is filled, and only from the fake block', async () => {
    const columns = await rows(
      `SELECT c.table_schema || '.' || c.table_name AS t, c.column_name AS c FROM information_schema.columns c
       WHERE c.table_schema IN ('ops', 'academic', 'marketing', 'core')
         AND c.column_name ~ 'phone|mobile|whatsapp'`,
    );
    expect(columns.length).toBe(8);
    for (const { t, c } of columns) {
      const [r] = await rows(
        `SELECT count(*) FILTER (WHERE ${String(c)} IS NULL)::int AS blank,
           count(*) FILTER (WHERE ${String(c)} !~ '${FAKE_PHONE_PATTERN}')::int AS other,
           count(*)::int AS n FROM ${String(t)}`,
      );
      expect(r, `${String(t)}.${String(c)}`).toMatchObject({ blank: 0, other: 0 });
      expect(r!.n, `${String(t)}.${String(c)}`).toBeGreaterThan(0);
    }
  });

  it('no row anywhere holds a word of a real teacher’s name', async () => {
    const words = OWNER_SUPPLIED_STAFF.flatMap((t) => t.fullName.split(' ')).filter(
      (w) => w !== "Ma'am",
    );
    const pattern = `\\m(${[...new Set(words)].join('|')})\\M`;
    const [control] = await rows(`SELECT 'on leave: Sobha.' ~* '${pattern}' AS hit`);
    expect(control!.hit).toBe(true);
    const tables = await rows(
      `SELECT table_schema || '.' || table_name AS t FROM information_schema.tables
       WHERE table_schema IN ('core', 'ops', 'academic', 'marketing') AND table_type = 'BASE TABLE'`,
    );
    expect(tables.length).toBeGreaterThan(100);
    const found: string[] = [];
    for (const { t } of tables) {
      const [r] = await rows(
        `SELECT count(*)::int AS n FROM ${String(t)} x WHERE x::text ~* '${pattern}'`,
      );
      if (r!.n) found.push(String(t));
    }
    expect(found).toEqual([]);
  });

  it.each([
    ['core.users', 'display_name'],
    ['core.staff_members', 'full_name'],
    ['core.students', 'full_name'],
    ['academic.students', 'full_name'],
    ['academic.students', 'guardian_name'],
    ['academic.session_demo_attendees', 'display_name'],
    ['ops.leads', 'student_name'],
    ['ops.leads', 'guardian_name'],
    ['ops.leads', 'emergency_contact_name'],
    ['ops.guardians', 'full_name'],
    ['ops.staff_private_details', 'emergency_contact_name'],
  ])('%s.%s holds normal two-word names only', async (table, column) => {
    const wrong = await rows(
      `SELECT ${column} AS name FROM ${table} WHERE ${column} !~ '^[A-Z][a-z]+ [A-Z][a-z]+$'
         OR ${column} ~* '(sample|demo|test|mock|fictional|teacher|manager|parent|student)'`,
    );
    expect(wrong).toEqual([]);
    expect(await rows(`SELECT 1 FROM ${table} LIMIT 1`)).toHaveLength(1);
  });

  it.each([
    ['academic.batches', 'code', 'is_sample'],
    ['academic.batches', 'name', 'is_sample'],
    ['academic.assessments', 'code', 'is_sample'],
    ['academic.assessments', 'title', 'is_sample'],
    ['academic.rooms', 'name', 'true'],
    ['marketing.campaigns', 'code', 'is_sample'],
    ['marketing.campaigns', 'name', 'is_sample'],
    ['marketing.calendar_items', 'title', 'is_sample'],
    ['marketing.ideas', 'title', 'is_sample'],
    ['marketing.optimisation_items', 'topic', 'is_sample'],
    ['marketing.metric_imports', 'file_name', 'true'],
    ['ops.staff_tasks', 'title', 'is_sample'],
    ['ops.hr_requests', 'subject', 'is_sample'],
    ['ops.follow_ups', 'title', 'true'],
    ['ops.appointments', 'title', 'title IS NOT NULL'],
    ['ops.work_schedules', 'name', 'true'],
    ['ops.holidays', 'name', 'true'],
    ['core.branches', 'name', 'true'],
    ['core.staff_members', 'title', 'true'],
    ['ops.staff_profiles', 'staff_code', 'is_sample'],
  ])('%s.%s reads like a real one', async (table, column, where) => {
    expect(
      await rows(
        `SELECT ${column} AS title FROM ${table} WHERE ${where} AND ${column} ~* 'sample|fictional|\\mdemo account\\M'`,
      ),
    ).toEqual([]);
  });

  it('every sample student has a father and a mother with a name, email, number and address', async () => {
    const families = await rows(
      `SELECT s.id, count(DISTINCT g.relationship)::int AS parents,
         count(g.email)::int AS emails, count(g.phone)::int AS phones, count(g.address)::int AS addresses
       FROM core.students s LEFT JOIN ops.guardians g ON g.student_id = s.id WHERE s.is_sample GROUP BY 1`,
    );
    expect(families.length).toBeGreaterThan(20);
    expect(
      families.filter(
        (f) => f.parents !== 2 || f.emails !== 2 || f.phones !== 2 || f.addresses !== 2,
      ),
    ).toEqual([]);
    // A lead with no student record holds the other parent as its emergency contact.
    expect(
      await rows(
        `SELECT student_name FROM ops.leads WHERE is_sample AND (guardian_name = emergency_contact_name
           OR address IS NULL OR previous_school IS NULL OR school_board IS NULL OR city IS NULL OR date_of_birth IS NULL)`,
      ),
    ).toEqual([]);
    expect(
      await rows(
        `SELECT full_name FROM academic.students WHERE is_sample AND (date_of_birth IS NULL
           OR school_board IS NULL OR city IS NULL OR guardian_name IS NULL OR guardian_email IS NULL)`,
      ),
    ).toEqual([]);
  });

  it('every sample staff member has private details', async () => {
    expect(
      await rows(
        `SELECT p.staff_id FROM ops.staff_profiles p LEFT JOIN ops.staff_private_details d ON d.staff_id = p.staff_id
         WHERE p.is_sample AND (d.staff_id IS NULL OR d.address IS NULL OR d.personal_email IS NULL OR d.emergency_contact_name IS NULL)`,
      ),
    ).toEqual([]);
  });

  it('made-up teachers hold the real teachers’ subjects with assignments on sample batches', async () => {
    for (const t of COVER_TEACHERS) {
      const [row] = await rows(
        `SELECT (SELECT count(*)::int FROM ops.staff_subject_capabilities c WHERE c.staff_id = m.id) AS subjects,
           (SELECT count(*)::int FROM academic.teacher_assignments a JOIN academic.batches b ON b.id = a.batch_id
             WHERE a.staff_member_id = m.id AND a.status = 'active' AND b.is_sample) AS assignments
         FROM core.staff_members m WHERE m.full_name = '${t.fullName}'`,
      );
      expect(row, t.fullName).toEqual({
        subjects: t.subjects.length,
        assignments: t.assignments.length,
      });
    }
  });

  it('Ops marks its teachers by its own flag', async () => {
    const { user } = await userOf('operations-manager@example.test');
    const { teachers } = await listOpsTeachers(db(), user);
    expect(teachers.length).toBeGreaterThan(10);
    expect(teachers.filter((t) => !t.isSample)).toEqual([]);
  });

  it('RL1-004: the seeded metric import has the shape the import page reads', async () => {
    const [imported] = await rows(`SELECT rejected FROM marketing.metric_imports`);
    expect(imported!.rejected).toEqual([
      { rowNumber: 1, reasons: [expect.any(String)] },
      { rowNumber: 2, reasons: [expect.any(String)] },
    ]);
  });

  it('RL1-005: the seeded weekly pattern has an end date and its page opens', async () => {
    const [pattern] = await db().select().from(academicTimetablePatterns);
    expect(pattern!.effectiveTo).not.toBeNull();
    const { user } = await userOf('academic-coordinator@example.test');
    await expect(previewPattern(db(), { user } as never, pattern!.id)).resolves.toBeTruthy();
  });

  it('RL1-007: every placement of a sample student is marked sample', async () => {
    expect(
      await rows(
        `SELECT p.id FROM academic.batch_placements p JOIN academic.enrolments e ON e.id = p.enrolment_id
         JOIN academic.students s ON s.id = e.student_id WHERE s.is_sample AND NOT p.is_sample`,
      ),
    ).toEqual([]);
  });
});

describe('requests through HR', () => {
  it('holds every state, with a forward answered and relayed', async () => {
    expect(new Set(Object.keys(await states(opsHrRequests as never)))).toEqual(
      new Set(['draft', 'submitted', 'reviewed', 'forwarded', 'resolved', 'declined']),
    );
    const [answered] = await db()
      .select()
      .from(opsHrRequests)
      .where(eq(opsHrRequests.subject, 'Dates for the campus visit'));
    const kinds = (
      await db()
        .select()
        .from(opsHrRequestEvents)
        .where(eq(opsHrRequestEvents.requestId, answered!.id))
    ).map((e) => e.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['forwarded', 'recipient_responded', 'response_relayed', 'resolved']),
    );
    const hr = await userOf('hr-manager@example.test');
    const q = await hrQueue(db(), hr.user, hrRequestListQuery.parse({ view: 'queue' }));
    expect(Object.values(q.counts).reduce((a, b) => a + b, 0)).toBeGreaterThan(4);
  });
});

describe('the demo teacher’s login', () => {
  it('My day has classes to mark, logs to write, tests to mark and a draft review', async () => {
    const { user } = await userOf(DEMO);
    const day = await teacherDay(db(), { user });
    if (day.kind !== 'teacher') throw new Error('not a teacher');
    expect(day.attendanceMissing.length).toBeGreaterThan(0);
    expect(day.logsMissing.length).toBeGreaterThan(0);
    expect(day.draftReviews).toBeGreaterThan(0);
    expect(day.assessmentsToMark.length).toBeGreaterThan(0);
    expect(day.support.length).toBeGreaterThan(0);
    expect(day.students.length).toBeGreaterThan(0);
  });

  it('has teaching logs at every stage and a review in every state', async () => {
    const { staffId } = await userOf(DEMO);
    const logs = await db()
      .select()
      .from(academicClassRecords)
      .where(eq(academicClassRecords.teacherStaffId, staffId!));
    expect(new Set(logs.map((l) => l.state))).toEqual(
      new Set(['draft', 'submitted', 'verified', 'superseded']),
    );
    expect(logs.every((l) => l.materials && l.homework && l.nextPlan)).toBe(true);
    const reviews = await db()
      .select()
      .from(academicTeacherReviews)
      .where(eq(academicTeacherReviews.authorStaffId, staffId!));
    expect(new Set(reviews.map((r) => r.status))).toEqual(
      new Set(['draft', 'submitted', 'withdrawn']),
    );
  });

  it('sees an approved summary with figures, one held back by the 5-response rule, and actions', async () => {
    const { user } = await userOf(DEMO);
    const f = await myFeedback(db(), user);
    const [recent, older] = f.summaries;
    expect(recent).toMatchObject({ responseCount: 8, enough: true });
    expect(older).toMatchObject({ responseCount: null, categoryMeans: null, enough: false });
    expect(f.actions.length).toBeGreaterThanOrEqual(3);
    expect(f.actions.some((a) => a.agreedAt === null)).toBe(true);
    expect(new Set(f.actions.map((a) => a.status))).toEqual(new Set(['open', 'done']));
  });

  it('has an EOD report to send, and reports by day, week and month', async () => {
    const { staffId } = await userOf(DEMO);
    const reports = await db()
      .select()
      .from(opsEodReports)
      .where(eq(opsEodReports.staffId, staffId!));
    expect(reports.some((r) => r.periodKind === 'day' && r.status === 'draft')).toBe(true);
    expect(new Set(reports.map((r) => r.periodKind))).toEqual(new Set(['day', 'week', 'month']));
    expect(new Set(reports.map((r) => r.status))).toEqual(
      new Set(['draft', 'submitted', 'acknowledged', 'revision_requested']),
    );
  });
});

describe('db:clear-samples after the fill', () => {
  it('removes the fill, puts the Schar setting back to unset and keeps real rows', async () => {
    const hr = await userOf('hr-manager@example.test');
    // Real rows that sit beside the fill, and a real person on a sample schedule.
    // Real rows named the way sample rows once were stay: a name decides nothing.
    await db()
      .insert(opsWorkSchedules)
      .values([
        { name: 'Real office hours', weeklyPattern: {} as never, createdBy: hr.user.id },
        { name: 'Sample schedule: ours', weeklyPattern: {} as never, createdBy: hr.user.id },
      ]);
    await db()
      .insert(opsHolidays)
      .values([
        { holidayOn: '2027-01-26', name: 'Republic Day', createdBy: hr.user.id },
        { holidayOn: '2027-01-27', name: 'Sample holiday: ours', createdBy: hr.user.id },
      ]);
    await db()
      .insert(academicRooms)
      .values([
        { code: 'ROOM-1', name: 'Real room' },
        { code: 'SAMPLE-OURS', name: 'Sample room we really have' },
      ]);
    const [sampleScheduleId] = await sampleRowIds(db(), 'ops.work_schedules');
    const teacher = await realStaff('Rupesh Nandan');
    await db()
      .update(opsStaffProfiles)
      .set({ workScheduleId: sampleScheduleId as never })
      .where(eq(opsStaffProfiles.staffId, teacher.id));
    // Real work put on the sample room and the sample branch: unlinked, never deleted or blocking.
    const [sampleRoomId] = await sampleRowIds(db(), 'academic.rooms');
    const [sampleRoom] = await db()
      .select()
      .from(academicRooms)
      .where(eq(academicRooms.id, sampleRoomId as never));
    // A sample row someone renamed on screen still goes.
    await db()
      .update(academicRooms)
      .set({ name: 'Renamed on screen' })
      .where(eq(academicRooms.id, sampleRoom!.id));
    const [sampleBranch] = await db()
      .select()
      .from(branches)
      .where(eq(branches.code, 'FATEHPUR_ROAD'));
    await db()
      .update(opsStaffProfiles)
      .set({ branchId: sampleBranch!.id })
      .where(eq(opsStaffProfiles.staffId, teacher.id));
    const [batch] = await db()
      .select()
      .from(academicBatches)
      .where(eq(academicBatches.code, 'IPMAT-C12-APR27'));
    const [quant] = await db()
      .select()
      .from(academicSubjects)
      .where(eq(academicSubjects.courseId, batch!.courseId));
    const [realClass] = await db()
      .insert(academicClassSessions)
      .values({
        batchId: batch!.id,
        roomId: sampleRoom!.id,
        date: '2027-04-05',
        startTime: '09:00',
        durationMinutes: 60,
      })
      .returning();
    const [realPattern] = await db()
      .insert(academicTimetablePatterns)
      .values({
        batchId: batch!.id,
        subjectId: quant!.id,
        staffId: teacher.id,
        roomId: sampleRoom!.id,
        weekday: 1,
        startTime: '09:00',
        durationMinutes: 60,
        effectiveFrom: '2027-04-05',
        createdByUserId: hr.user.id,
      })
      .returning();
    // A holiday without a branch means every branch, so losing the link would widen it: refuse.
    const [realHoliday] = await db()
      .insert(opsHolidays)
      .values({
        holidayOn: '2027-03-01',
        name: 'Real holiday',
        branchId: sampleBranch!.id,
        createdBy: hr.user.id,
      })
      .returning();
    const refused = await clearSamples(db()).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ClearSamplesRefused);
    expect((refused as ClearSamplesRefused).problems).toEqual([
      'Holiday "Real holiday" on 2027-03-01 is on the sample branch; move it to a real branch first.',
    ]);
    await db().delete(opsHolidays).where(eq(opsHolidays.id, realHoliday!.id));

    const lines: string[] = [];
    const deleted = await clearSamples(db(), (l) => lines.push(l));
    await retireSampleLogins(db());

    for (const table of [
      'ops.work_schedules',
      'ops.holidays',
      'ops.staff_private_details',
      'academic.rooms',
      'core.branches',
      'academic.interventions',
      'academic.catchup_tasks',
      'academic.teacher_unavailability',
      'ops.leave_applications',
      'ops.settings (Schar)',
    ])
      expect(deleted[table], table).toBeGreaterThan(0);
    expect(lines).toEqual(
      expect.arrayContaining([
        'Unlinked 1 real staff member(s) from sample work schedules',
        'Unlinked 1 real staff member(s) from the sample branch',
        'Unlinked 1 real class(es) from sample rooms',
        'Unlinked 1 real weekly pattern(s) from sample rooms',
      ]),
    );
    expect((await db().select().from(branches)).map((b) => b.code)).toEqual(['SIKAR']);
    const [classAfter] = await db()
      .select()
      .from(academicClassSessions)
      .where(eq(academicClassSessions.id, realClass!.id));
    expect(classAfter!.roomId).toBeNull();
    const [patternAfter] = await db()
      .select()
      .from(academicTimetablePatterns)
      .where(eq(academicTimetablePatterns.id, realPattern!.id));
    expect(patternAfter!.roomId).toBeNull();
    expect((await loadSettings(db()))['hr.request_recipients'].value).toEqual({ schar: null });
    expect(await db().$count(opsSettings, eq(opsSettings.key, 'hr.request_recipients'))).toBe(0);
    expect((await db().select().from(opsWorkSchedules)).map((s) => s.name).sort()).toEqual([
      'Real office hours',
      'Sample schedule: ours',
    ]);
    expect((await db().select().from(opsHolidays)).map((h) => h.name).sort()).toEqual([
      'Republic Day',
      'Sample holiday: ours',
    ]);
    expect((await db().select().from(academicRooms)).map((r) => r.code).sort()).toEqual([
      'ROOM-1',
      'SAMPLE-OURS',
    ]);
    const [profile] = await db()
      .select()
      .from(opsStaffProfiles)
      .where(eq(opsStaffProfiles.staffId, teacher.id));
    expect(profile).toMatchObject({ workScheduleId: null, branchId: null });
    expect(await rows(`SELECT id FROM ops.appointments`)).toEqual([]);
    expect(await rows(`SELECT id FROM marketing.metric_imports`)).toEqual([]);
    expect(await clearSamples(db())).toEqual({});
  });

  it('every surviving login and staff record reads as removed, and none can sign in', async () => {
    const logins = await db().select().from(users);
    expect(logins.length).toBeGreaterThan(20);
    expect(
      logins.filter(
        (u) =>
          !u.displayName.startsWith('Removed sample login ') ||
          u.status !== 'disabled' ||
          u.passwordHash !== null,
      ),
    ).toEqual([]);
    expect(
      await checkPassword(db(), 'hr-manager@example.test', context.seedUserPassword),
    ).toBeNull();
    const kept = await rows(
      `SELECT m.full_name, m.status, p.display_name FROM core.staff_members m
       JOIN ops.staff_profiles p ON p.staff_id = m.id WHERE p.is_sample`,
    );
    expect(kept.length).toBeGreaterThan(20);
    expect(
      kept.filter(
        (s) =>
          !String(s.full_name).startsWith('Removed sample staff ') ||
          s.status !== 'inactive' ||
          s.display_name !== null,
      ),
    ).toEqual([]);
    // The audit trail and the event outbox are append-only history; nothing else keeps a made-up name.
    const pattern = everySampleName().join('|');
    const tables = await rows(
      `SELECT table_schema || '.' || table_name AS t FROM information_schema.tables
       WHERE table_schema IN ('core', 'ops', 'academic', 'marketing') AND table_type = 'BASE TABLE'
         AND table_name NOT IN ('audit_events', 'integration_events')`,
    );
    const found: string[] = [];
    for (const { t } of tables)
      if ((await rows(`SELECT 1 FROM ${String(t)} x WHERE x::text ~ '${pattern}' LIMIT 1`)).length)
        found.push(String(t));
    expect(found).toEqual([]);
  });

  it('the reference seed then brings the real teachers back with no sample history', async () => {
    await runSeeds(db(), referenceSeedList(['owner-staff']), context);
    const real = await db()
      .select({
        id: staffMembers.id,
        userId: staffMembers.userId,
        isSample: opsStaffProfiles.isSample,
      })
      .from(staffMembers)
      .innerJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
      .where(
        inArray(
          staffMembers.fullName,
          OWNER_SUPPLIED_STAFF.map((t) => t.fullName),
        ),
      );
    expect(real).toHaveLength(OWNER_SUPPLIED_STAFF.length);
    expect(real.filter((r) => r.userId || r.isSample)).toEqual([]);
    const ids = real.map((r) => `'${r.id}'`).join(', ');
    for (const [table, column] of [
      ['ops.staff_tasks', 'staff_id'],
      ['ops.eod_reports', 'staff_id'],
      ['ops.attendance_punches', 'staff_id'],
      ['ops.leave_applications', 'staff_id'],
      ['ops.staff_private_details', 'staff_id'],
      ['ops.student_teacher_feedback', 'teacher_staff_id'],
      ['ops.demo_sessions', 'teacher_staff_id'],
      ['ops.appointments', 'staff_id'],
      ['academic.class_sessions', 'teacher_staff_id'],
      ['academic.session_teachers', 'staff_id'],
      ['academic.timetable_patterns', 'staff_id'],
    ]) {
      const [r] = await rows(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} IN (${ids})`);
      expect(r!.n, table).toBe(0);
    }
    // Their assignments are the owner's, on real batches or none.
    expect(
      await rows(
        `SELECT 1 FROM academic.teacher_assignments a JOIN academic.batches b ON b.id = a.batch_id
         WHERE a.staff_member_id IN (${ids}) AND b.is_sample`,
      ),
    ).toEqual([]);
  }, 120_000);

  it('never overwrites a Schar someone chose on the screen', async () => {
    const hr = await userOf('hr-manager@example.test');
    const [real] = await db()
      .select()
      .from(staffMembers)
      .where(eq(staffMembers.fullName, "Olivia Ma'am"));
    await db()
      .insert(opsSettings)
      .values({ key: 'hr.request_recipients', value: { schar: real!.id }, updatedBy: hr.user.id });
    await runSeeds(
      db(),
      [...coreSeeds, ...marketingSeeds, ...academicSeeds, ...opsSeeds, ...platformSeeds],
      context,
    );
    expect((await loadSettings(db()))['hr.request_recipients'].value).toEqual({ schar: real!.id });
    await clearSamples(db());
    expect((await loadSettings(db()))['hr.request_recipients'].value).toEqual({ schar: real!.id });
  }, 280_000);
});
