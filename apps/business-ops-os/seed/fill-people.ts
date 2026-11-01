/**
 * Owner, 31 Oct 2026: "Fill everything, every detail, with mock data." People and attendance of the
 * sample staff: the made-up Schar and the setting that names them, staff details, work schedules,
 * holidays, recent weeks of punches, HR's marked days, corrections in each state and leave. All
 * sample (D-036): real staff never get a row here, so their days stay as they are. Tables without an
 * `is_sample` column are recorded with markSampleRows; db:clear-samples removes those rows and puts
 * the setting back. Safe to run again on any day.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  branches,
  opsHolidays,
  opsSettings,
  opsStaffPrivateDetails,
  opsStaffProfiles,
  opsWorkSchedules,
  staffMembers,
  users,
  type Database,
  type OpsWeeklyPattern,
} from '@elevate/database';
import {
  DEMO_ACCOUNTS,
  ensureDemoStaff,
  markSampleRows,
  SAMPLE_SCHAR,
  sampleRowIds,
  sampleStaffDetails,
} from '@elevate/database/seed';
import type { StaffMemberId } from '@elevate/shared-types';
import { addDays, type IsoDate } from '../src/domain/dates';
import { opsAudit } from '../src/server/ops-common';
import { sampleAnchorDate } from './sample-staff';
import { seedActor } from './samples';

export const DEMO_TEACHER_EMAIL = 'teacher@elevateeducation.in';
const SAMPLE_SCHAR_SOURCE = 'Sample set: a made-up Schar (D-096); replace with the real person';

const hours = (start: string, end: string, off: (keyof OpsWeeklyPattern)[]) =>
  Object.fromEntries(
    (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((d) => [
      d,
      off.includes(d) ? null : { start, end },
    ]),
  ) as OpsWeeklyPattern;

/** [name, pattern, grace minutes]. No schedule is the default: real staff must not pick one up. */
const SCHEDULES = [
  ['Teaching days, 9 to 5', hours('09:00', '17:00', ['sun']), 10],
  ['Office days, 10 to 6', hours('10:00', '18:00', ['sun']), 15],
  ['Weekend classes, 11 to 7', hours('11:00', '19:00', ['mon', 'tue']), 5],
] as const;

export const SAMPLE_BRANCH_CODE = 'FATEHPUR_ROAD';
/** [name, day offset, decision state]: on the sample branch only, so no real person's day changes. */
const HOLIDAYS = [
  ['Centre foundation day', -19, 'approved'],
  ['Staff training day', -14, 'approved'],
  ['Local festival, to be confirmed', 6, 'proposed'],
  ['Festival break', 8, 'approved'],
] as const;

/** Sample staff who hold a login and are in work: the people these rows belong to. */
export async function sampleRoster(db: Database) {
  return db
    .select({
      staffId: staffMembers.id,
      userId: users.id,
      name: staffMembers.fullName,
      email: users.email,
      code: opsStaffProfiles.staffCode,
      departmentId: staffMembers.departmentId,
      scheduleId: opsStaffProfiles.workScheduleId,
    })
    .from(staffMembers)
    .innerJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .where(and(eq(opsStaffProfiles.isSample, true), eq(staffMembers.status, 'active')))
    .orderBy(staffMembers.fullName);
}

const auditSetting = opsAudit('setting');

/** Name the made-up Schar unless someone has already chosen. Never overwrites a stored choice. */
async function nameSchar(db: Database, staffId: StaffMemberId) {
  const hr = await seedActor(db, 'hr-manager@example.test');
  const [after] = await db
    .insert(opsSettings)
    .values({
      key: 'hr.request_recipients',
      value: { schar: staffId },
      decisionState: 'proposed',
      source: SAMPLE_SCHAR_SOURCE,
      ownerDecision: 'D-096: the owner names the real person',
      note: 'Sample — replace',
      updatedBy: hr!.actor.id,
    })
    .onConflictDoNothing({ target: opsSettings.key })
    .returning();
  if (after) await auditSetting(db, hr!.actor, after.key, 'setting.changed', { after });
}

/** Schedules, holidays, the demo staff records, Schar and the fields staff screens show. */
export async function seedFillPeople(db: Database) {
  const [director] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .where(eq(users.email, 'director@example.test'));
  const demo = await ensureDemoStaff(db, DEMO_ACCOUNTS, director?.id ?? null);
  const schar = demo.get(SAMPLE_SCHAR.email);
  if (schar) await nameSchar(db, schar.staffId);
  const hr = (await seedActor(db, 'hr-manager@example.test'))!.actor;
  const anchor = sampleAnchorDate() as IsoDate;
  await db
    .insert(branches)
    .values({
      code: SAMPLE_BRANCH_CODE,
      name: 'Fatehpur Road centre',
      status: 'provisional',
    })
    .onConflictDoNothing({ target: branches.code })
    .returning({ id: branches.id })
    .then((rows) =>
      markSampleRows(
        db,
        'core.branches',
        rows.map((r) => r.id),
      ),
    );
  const [branch] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.code, SAMPLE_BRANCH_CODE));
  const newSchedules = await db
    .insert(opsWorkSchedules)
    .values(
      SCHEDULES.map(([name, weeklyPattern, graceMinutes]) => ({
        name,
        weeklyPattern,
        graceMinutes,
        createdBy: hr.id,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: opsWorkSchedules.id });
  await markSampleRows(
    db,
    'ops.work_schedules',
    newSchedules.map((s) => s.id),
  );
  const named = await db
    .select({ name: opsHolidays.name })
    .from(opsHolidays)
    .where(inArray(opsHolidays.id, await sampleRowIds(db, 'ops.holidays')));
  const missing = HOLIDAYS.filter(([name]) => !named.some((h) => h.name === name));
  if (missing.length) {
    const added = await db
      .insert(opsHolidays)
      .values(
        missing.map(([name, day, decisionState]) => ({
          name,
          holidayOn: addDays(anchor, day),
          branchId: branch!.id,
          decisionState,
          createdBy: hr.id,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: opsHolidays.id });
    await markSampleRows(
      db,
      'ops.holidays',
      added.map((h) => h.id),
    );
  }
  const schedules = await db
    .select({ id: opsWorkSchedules.id, name: opsWorkSchedules.name })
    .from(opsWorkSchedules)
    .where(
      inArray(
        opsWorkSchedules.name,
        SCHEDULES.map(([name]) => name),
      ),
    );
  const scheduleId = (word: string) => schedules.find((s) => s.name.startsWith(word))!.id;
  // Only what is still empty: an edit on the screen stays (a sample row may refresh, it need not).
  await db.execute(sql`
    UPDATE ops.staff_profiles p SET
      staff_code = coalesce(p.staff_code, 'EMP-' || upper(left(p.staff_id::text, 6))),
      role_labels = CASE WHEN cardinality(p.role_labels) = 0 THEN ARRAY[(SELECT title FROM core.staff_members m WHERE m.id = p.staff_id)] ELSE p.role_labels END,
      role_note = coalesce(p.role_note, (SELECT title FROM core.staff_members m WHERE m.id = p.staff_id)),
      employment_status = CASE WHEN p.employment_status = 'not_recorded' THEN 'active' ELSE p.employment_status END,
      display_name = coalesce(p.display_name, (SELECT full_name FROM core.staff_members m WHERE m.id = p.staff_id)),
      joined_on = coalesce(p.joined_on, ${anchor}::date - (120 + abs(hashtext(p.staff_id::text)) % 700)),
      branch_id = ${branch!.id},
      work_schedule_id = coalesce(p.work_schedule_id, CASE
        WHEN p.staff_code IN ('EMP-T10', 'EMP-T11') THEN ${scheduleId('Weekend')}::uuid
        WHEN EXISTS (SELECT 1 FROM ops.staff_subject_capabilities c WHERE c.staff_id = p.staff_id)
          OR p.staff_id IN (SELECT id FROM core.staff_members WHERE department_id =
            (SELECT id FROM core.departments WHERE code = 'ACADEMICS'))
          THEN ${scheduleId('Teaching')}::uuid
        ELSE ${scheduleId('Office')}::uuid END),
      notes = coalesce(p.notes, 'Joined through the regular hiring round.')
    WHERE p.is_sample`);
  // Every sample person, login or not; a sample record renamed on screen keeps what it has.
  const everyone = await db
    .select({ staffId: staffMembers.id, name: staffMembers.fullName })
    .from(staffMembers)
    .innerJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
    .where(eq(opsStaffProfiles.isSample, true));
  await db
    .insert(opsStaffPrivateDetails)
    .values(
      everyone.flatMap((r) => {
        const details = sampleStaffDetails(r.name);
        return details ? [{ staffId: r.staffId, ...details, updatedBy: hr.id }] : [];
      }),
    )
    .onConflictDoNothing();
  await fillEmployment(db, hr.id, anchor);
}

/** A teacher who has left and one serving notice: HR's records and the timetable show both states. */
export const LEFT_TEACHER = { name: 'Imran Qureshi', lastDay: -8, cover: 'Dev Malhotra' };
const ON_NOTICE = { name: 'Hemant Joshi', lastDay: 20 };

/** What HR's record shows beyond the name: subjects, employment facts, department and manager history. */
async function fillEmployment(db: Database, hrId: string, anchor: IsoDate) {
  // The demo teacher is on the timetable: a subject puts them in the Teachers directory too.
  await db.execute(sql`INSERT INTO ops.staff_subject_capabilities (staff_id, subject, source_note)
    SELECT m.id, 'IPMAT Quantitative Aptitude (co-teaching)', 'Fictional staff record'
    FROM core.staff_members m JOIN ops.staff_profiles p ON p.staff_id = m.id
    WHERE p.is_sample AND m.title ILIKE '%teacher'
      AND NOT EXISTS (SELECT 1 FROM ops.staff_subject_capabilities c WHERE c.staff_id = m.id)`);
  await db.execute(sql`UPDATE ops.staff_subject_capabilities c SET
      verification_status = CASE WHEN abs(hashtext(c.staff_id::text)) % 4 = 0 THEN 'unverified' ELSE 'confirmed' END,
      programme_id = coalesce(c.programme_id, (SELECT g.id FROM core.programmes g WHERE g.code = CASE
        WHEN c.subject ILIKE '%IPM%' THEN 'IPMAT'
        WHEN c.subject ILIKE '%CLAT%' OR c.subject ILIKE '%legal%' OR c.subject ILIKE '%current affairs%' THEN 'CLAT'
        WHEN c.subject ILIKE '%CUET%' THEN 'CUET'
        WHEN c.subject ILIKE '%CA Foundation%' THEN 'CA_FOUNDATION'
        WHEN c.subject ILIKE '%Class 11%' THEN 'COMMERCE_11_12'
        ELSE NULL END))
    FROM ops.staff_profiles p WHERE p.staff_id = c.staff_id AND p.is_sample`);
  await db.execute(sql`UPDATE ops.staff_profiles p SET
      employment_type = CASE WHEN p.employment_type <> 'not_recorded' THEN p.employment_type
        WHEN m.user_id IS NULL THEN (ARRAY['part_time', 'visiting', 'contract'])[1 + abs(hashtext(p.staff_id::text)) % 3]
        ELSE 'full_time' END,
      verification_status = CASE WHEN abs(hashtext(p.staff_id::text)) % 5 = 0 THEN 'unverified' ELSE 'confirmed' END,
      employment_status = CASE WHEN m.full_name = ${ON_NOTICE.name} THEN 'on_notice'
        WHEN m.full_name = ${LEFT_TEACHER.name} THEN 'exited' ELSE p.employment_status END,
      left_on = CASE WHEN m.full_name = ${ON_NOTICE.name} THEN ${addDays(anchor, ON_NOTICE.lastDay)}::date
        WHEN m.full_name = ${LEFT_TEACHER.name} THEN ${addDays(anchor, LEFT_TEACHER.lastDay)}::date ELSE p.left_on END,
      updated_by = ${hrId}
    FROM core.staff_members m WHERE m.id = p.staff_id AND p.is_sample`);
  await db.execute(sql`UPDATE core.staff_members m SET status = 'inactive'
    FROM ops.staff_profiles p WHERE p.staff_id = m.id AND p.is_sample AND m.full_name = ${LEFT_TEACHER.name}`);
  // Histories: when each current row began, and one earlier manager for the teachers who moved.
  await db.execute(sql`UPDATE ops.staff_departments d SET from_date = p.joined_on
    FROM ops.staff_profiles p WHERE p.staff_id = d.staff_id AND p.is_sample AND d.from_date IS NULL`);
  await db.execute(sql`INSERT INTO ops.staff_manager_history (staff_id, manager_staff_id, from_date, to_date, changed_by, reason)
    SELECT h.staff_id, c.id, p.joined_on, ${addDays(anchor, -61)}::date, ${hrId},
      'Reported to the coordinator until the academic manager joined.'
    FROM ops.staff_manager_history h
    JOIN ops.staff_profiles p ON p.staff_id = h.staff_id AND p.is_sample AND p.joined_on < ${addDays(anchor, -61)}::date
    JOIN core.staff_members mg ON mg.id = h.manager_staff_id AND mg.title = 'Academic manager'
    JOIN core.staff_members c ON c.title = 'Academic coordinator'
    WHERE h.to_date IS NULL
      AND NOT EXISTS (SELECT 1 FROM ops.staff_manager_history x WHERE x.staff_id = h.staff_id AND x.to_date IS NOT NULL)`);
  await db.execute(sql`UPDATE ops.staff_manager_history h SET
      from_date = coalesce(h.from_date, CASE WHEN EXISTS (SELECT 1 FROM ops.staff_manager_history x WHERE x.staff_id = h.staff_id AND x.to_date IS NOT NULL)
        THEN ${addDays(anchor, -60)}::date ELSE p.joined_on END),
      reason = CASE WHEN h.reason = 'Seed data' THEN 'Set when the staff record was created.' ELSE h.reason END
    FROM ops.staff_profiles p WHERE p.staff_id = h.staff_id AND p.is_sample AND h.to_date IS NULL`);
}
