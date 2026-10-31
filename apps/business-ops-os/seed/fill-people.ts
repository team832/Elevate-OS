/**
 * Owner, 31 Oct 2026: "Fill everything, every detail, with mock data." People and attendance of the
 * sample staff: the made-up Schar and the setting that names them, staff details, work schedules,
 * holidays, recent weeks of punches, HR's marked days, corrections in each state and leave. All
 * sample (D-036): real staff never get a row here, so their days stay as they are. Tables without an
 * `is_sample` column are recorded with markSampleRows; db:clear-samples removes those rows and puts
 * the setting back. Safe to run again on any day.
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  branches,
  opsAttendanceCorrections,
  opsAttendanceImports,
  opsAttendancePunches,
  opsDailyAttendance,
  opsHolidays,
  opsLeaveApplications,
  opsLeaveRecords,
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
  sampleText as why,
} from '@elevate/database/seed';
import type { StaffMemberId } from '@elevate/shared-types';
import { datesBetween } from '../src/domain/attendance';
import { addDays, istInstant, weekdayOf, type IsoDate } from '../src/domain/dates';
import { recordLeave } from '../src/server/attendance-actions';
import { decideCorrection, requestCorrection } from '../src/server/attendance-corrections';
import {
  applyForLeave,
  cancelLeaveApplication,
  decideLeave,
} from '../src/server/leave-applications';
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
  ['Centre foundation day', -12, 'approved'],
  ['Staff training day', -5, 'approved'],
  ['Local festival, to be confirmed', 6, 'proposed'],
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
    .then((rows) => markSampleRows(db, 'core.branches', rows.map((r) => r.id)));
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
  await markSampleRows(db, 'ops.work_schedules', newSchedules.map((s) => s.id));
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
    await markSampleRows(db, 'ops.holidays', added.map((h) => h.id));
  }
  const schedules = await db
    .select({ id: opsWorkSchedules.id, name: opsWorkSchedules.name })
    .from(opsWorkSchedules)
    .where(inArray(opsWorkSchedules.id, await sampleRowIds(db, 'ops.work_schedules')));
  const scheduleId = (word: string) => schedules.find((s) => s.name.startsWith(word))!.id;
  // Only what is still empty: an edit on the screen stays (a sample row may refresh, it need not).
  await db.execute(sql`
    UPDATE ops.staff_profiles p SET
      staff_code = coalesce(p.staff_code, 'EMP-' || upper(left(p.staff_id::text, 6))),
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
      notes = coalesce(p.notes, 'Fictional staff record for trying the screens (sample).')
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
}

const roll = (s: string) => {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 100;
};
const shift = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000);

/** Same result for the same person and day, whenever it runs. */
function dayShape(staffId: string, date: string) {
  const r = roll(`${staffId}:${date}`);
  if (r < 72) return { in: (r % 13) - 7, out: r % 25 };
  if (r < 84) return { in: 20 + (r % 40), out: r % 20 };
  if (r < 88) return { in: (r % 9) - 4, out: null };
  if (r < 93) return { in: (r % 7) - 3, short: 270 };
  if (r < 96) return null; // no punch at all: the review list's unmarked day
  return { in: -12, out: 45 };
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const IMPORT_FROM = -20;
const IMPORT_TO = -8;
const FILE = 'Punch export, last three weeks.csv';

/**
 * Leave first (days on leave have no punches), corrections last (they refer to the days). Every
 * application state through the real service. A teacher's approved leave is in the past: approving
 * future leave for a teacher asks Academic OS about classes, and a seed runs with no server up.
 * [person, from, to, type, reason, then: approve | reject | HR cancels after approving | they cancel].
 */
const LEAVE: readonly [string, number, number, string, string, string?, string?][] = [
  [
    'EMP-T02',
    -9,
    -8,
    'Casual',
    'Family function (sample).',
    'approve',
    'Cover arranged (sample).',
  ],
  [
    'EMP-T05',
    -3,
    -3,
    'Sick',
    'Fever; doctor advised rest (sample).',
    'approve',
    'Get well soon (sample).',
  ],
  ['demo', -6, -6, 'Casual', 'Personal work in Jaipur (sample).', 'approve'],
  [
    'EMP-T08',
    -2,
    -2,
    'Casual',
    'A family visit (sample).',
    'revoke',
    'The visit moved, and the teacher came to work (sample).',
  ],
  [
    'rohit.saini@example.test',
    4,
    5,
    'Earned',
    'A family trip (sample).',
    'approve',
    'Pooja covers the calendar (sample).',
  ],
  ['demo', 5, 6, 'Earned', 'A family wedding in Jaipur (sample).'],
  ['EMP-T07', 3, 5, 'Earned', 'Going home for a family wedding (sample).'],
  [
    'EMP-T09',
    9,
    9,
    'Casual',
    'Bank work (sample).',
    'reject',
    'He is on exam duty that day; please choose another date (sample).',
  ],
  [
    'EMP-T04',
    12,
    12,
    'Unpaid',
    'A cousin is visiting (sample).',
    'withdraw',
    'The visit was called off (sample).',
  ],
];

/** [person, day, what they ask, why, HR's answer: null = waiting]. */
const CORRECTIONS: readonly [
  string,
  number,
  { requestedStatus?: 'present'; requestedIn?: string; requestedOut?: string },
  string,
  { decision: 'approved' | 'rejected'; note: string } | null,
][] = [
  [
    'demo',
    -1,
    { requestedOut: '17:35' },
    'I forgot to check out after the evening class (sample).',
    null,
  ],
  [
    'EMP-T04',
    -2,
    { requestedIn: '09:02' },
    'The check-in did not record at the gate (sample).',
    null,
  ],
  [
    'EMP-T03',
    -4,
    { requestedOut: '17:10' },
    'Left at the usual time, no check-out shown (sample).',
    { decision: 'approved', note: 'Matches the class register (sample).' },
  ],
  [
    'EMP-T06',
    -7,
    { requestedStatus: 'present' },
    'I was at the Jaipur test centre that day (sample).',
    { decision: 'approved', note: 'Duty letter seen (sample).' },
  ],
  [
    'demo',
    -10,
    { requestedIn: '08:40' },
    'I arrived before the first class (sample).',
    {
      decision: 'rejected',
      note: 'The first class started at 11:00 that day and the register shows no earlier work (sample).',
    },
  ],
];

/** [person, day, status, note]: HR's decisions on days the punches leave open. */
const DECISIONS: readonly [string, number, 'absent' | 'half_day' | 'present', string][] = [
  ['EMP-T01', -4, 'absent', 'No check-in and no leave recorded; spoke to the teacher (sample).'],
  ['EMP-T09', -3, 'half_day', 'Left at 13:30 with the manager’s permission (sample).'],
  [
    'EMP-T11',
    -2,
    'present',
    'Worked at the Sikar centre annexe; no punch machine there (sample).',
  ],
];

export async function seedFillAttendance(db: Database, log: (m: string) => void = () => {}) {
  const roster = await sampleRoster(db);
  if (!roster.length) return log('ops.fill-attendance skipped: no sample staff');
  const hr = (await seedActor(db, 'hr-manager@example.test'))!;
  const anchor = sampleAnchorDate() as IsoDate;
  const now = new Date(); // the real clock on purpose: a punch is never in the future
  const person = (key: string) =>
    roster.find((r) =>
      key === 'demo' ? r.email === DEMO_TEACHER_EMAIL : r.code === key || r.email === key,
    )!;

  // Leave, once: every application state, and leave HR recorded with no application.
  if (!(await db.$count(opsLeaveApplications, eq(opsLeaveApplications.isSample, true)))) {
    for (const [who, from, to, kind, reason, then, note] of LEAVE) {
      const p = person(who);
      const self = (await seedActor(db, p.email))!.actor;
      const a = await applyForLeave(db, self, {
        kind,
        reason,
        fromDate: addDays(anchor, from),
        toDate: addDays(anchor, to),
      });
      const version = a.version;
      if (then === 'withdraw')
        await cancelLeaveApplication(db, self, a.id, { reason: note!, version } as never);
      if (then === 'reject')
        await decideLeave(db, hr.actor, a.id, { decision: 'rejected', note, version } as never);
      if (then === 'approve' || then === 'revoke') {
        const done = await decideLeave(db, hr.actor, a.id, {
          decision: 'approved',
          note,
          version,
        } as never);
        if (then === 'revoke')
          await cancelLeaveApplication(db, hr.actor, a.id, {
            reason: note!,
            version: done.version,
          } as never);
      }
    }
    await recordLeave(db, hr.actor, {
      staffId: person('EMP-T11').staffId,
      fromDate: addDays(anchor, -15),
      toDate: addDays(anchor, -14),
      kind: 'Casual',
      reason: 'Told HR in person; recorded by HR with no application (sample).',
      isSample: true,
    } as never);
    const ids = roster.map((r) => r.staffId);
    for (const t of [opsLeaveApplications, opsLeaveRecords])
      await db.update(t).set({ isSample: true }).where(inArray(t.staffId, ids));
  }
  const leave = await db
    .select()
    .from(opsLeaveRecords)
    .where(and(eq(opsLeaveRecords.isSample, true), eq(opsLeaveRecords.status, 'approved')));
  const holidays = await db
    .select({ on: opsHolidays.holidayOn })
    .from(opsHolidays)
    .where(
      and(
        inArray(opsHolidays.id, await sampleRowIds(db, 'ops.holidays')),
        eq(opsHolidays.decisionState, 'approved'),
      ),
    );
  const schedules = await db.select().from(opsWorkSchedules);

  // One committed file for the older weeks, one still in preview; the same file is one row.
  const sha = createHash('sha256').update(FILE).digest('hex');
  const [imported] = await db
    .insert(opsAttendanceImports)
    .values({
      sha256: sha,
      sourceLabel: `Imported from ${FILE}; no device is connected`,
      rows: [],
      status: 'committed',
      createdBy: hr.actor.id,
      committedAt: istInstant(addDays(anchor, IMPORT_TO + 1), '10:00'),
      committedBy: hr.actor.id,
      isSample: true,
    })
    .onConflictDoNothing()
    .returning({ id: opsAttendanceImports.id });
  const importId =
    imported?.id ??
    (
      await db
        .select({ id: opsAttendanceImports.id })
        .from(opsAttendanceImports)
        .where(eq(opsAttendanceImports.sha256, sha))
    )[0]!.id;

  const punches: (typeof opsAttendancePunches.$inferInsert)[] = [];
  const dates = datesBetween(addDays(anchor, IMPORT_FROM), anchor);
  const importedLast = addDays(anchor, IMPORT_TO);
  for (const r of roster) {
    const pattern = schedules.find((s) => s.id === r.scheduleId)?.weeklyPattern;
    if (!pattern) continue;
    for (const date of dates) {
      const day = pattern[DAY_KEYS[weekdayOf(date)]!];
      if (
        !day ||
        holidays.some((h) => h.on === date) ||
        leave.some((l) => l.staffId === r.staffId && l.fromDate <= date && l.toDate >= date)
      )
        continue;
      const shape = dayShape(r.staffId, date);
      if (!shape) continue;
      const row = {
        staffId: r.staffId,
        enteredBy: hr.actor.id,
        isSample: true,
        ...(date <= importedLast
          ? { source: 'import' as const, importId, sourceRef: FILE }
          : { source: 'manual' as const, sourceRef: why('Entered by HR from the register') }),
      };
      const inAt = shift(istInstant(date, day.start), shape.in);
      if (inAt > now) continue;
      punches.push({ ...row, punchedAt: inAt, direction: 'in' });
      const outAt =
        'short' in shape
          ? shift(inAt, shape.short!)
          : shape.out === null
            ? null
            : shift(istInstant(date, day.end), shape.out);
      if (outAt && outAt <= now) punches.push({ ...row, punchedAt: outAt, direction: 'out' });
    }
  }
  for (let i = 0; i < punches.length; i += 400)
    await db
      .insert(opsAttendancePunches)
      .values(punches.slice(i, i + 400))
      .onConflictDoNothing();
  const fromFile = punches.filter((p) => p.importId).length;
  await db
    .update(opsAttendanceImports)
    .set({ rowsTotal: fromFile, rowsValid: fromFile })
    .where(eq(opsAttendanceImports.id, importId));

  // A file HR has not committed: one good row, one bad, one already stored.
  const t1 = person('EMP-T01');
  const previewFile = 'Punch export, this week.csv';
  await db
    .insert(opsAttendanceImports)
    .values({
      sha256: createHash('sha256').update(previewFile).digest('hex'),
      sourceLabel: `Imported from ${previewFile}`,
      rows: [
        {
          line: 2,
          staffCode: t1.code,
          at: istInstant(anchor, '09:01').toISOString(),
          direction: 'in',
          errors: [],
          staffId: t1.staffId,
          staffName: t1.name,
          outcome: 'valid',
        },
        {
          line: 3,
          staffCode: 'EMP-T99',
          at: null,
          direction: 'in',
          errors: ['No staff member has this code', 'The date-time cannot be read'],
          staffId: null,
          staffName: null,
          outcome: 'invalid',
        },
        {
          line: 4,
          staffCode: t1.code,
          at: punches[0]!.punchedAt!.toISOString(),
          direction: 'in',
          errors: [],
          staffId: t1.staffId,
          staffName: t1.name,
          outcome: 'duplicate',
        },
      ],
      rowsTotal: 3,
      rowsValid: 1,
      rowsInvalid: 1,
      rowsDuplicate: 1,
      createdBy: hr.actor.id,
      isSample: true,
    })
    .onConflictDoNothing();

  // HR's decisions and the corrections, once, through the real services.
  if (!(await db.$count(opsAttendanceCorrections, eq(opsAttendanceCorrections.isSample, true)))) {
    for (const [who, day, status, note] of DECISIONS) {
      await db
        .insert(opsDailyAttendance)
        .values({
          staffId: person(who).staffId,
          workDate: addDays(anchor, day),
          status,
          basis: 'hr_decision',
          decidedByUserId: hr.actor.id,
          note,
          isSample: true,
        })
        .onConflictDoNothing();
    }
    for (const [who, day, ask, reason, answer] of CORRECTIONS) {
      const p = person(who);
      const date = addDays(anchor, day);
      const row = await requestCorrection(db, { id: p.userId, roles: ['teacher'] }, {
        workDate: date,
        reason,
        requestedStatus: ask.requestedStatus ?? null,
        requestedIn: ask.requestedIn ? istInstant(date, ask.requestedIn) : null,
        requestedOut: ask.requestedOut ? istInstant(date, ask.requestedOut) : null,
      } as never);
      if (answer) await decideCorrection(db, hr.actor, row.id, answer as never);
    }
    // No route may set the sample flag; what the services wrote belongs to sample staff only.
    const ids = roster.map((r) => r.staffId);
    for (const t of [opsAttendanceCorrections, opsAttendancePunches, opsDailyAttendance])
      await db.update(t).set({ isSample: true }).where(inArray(t.staffId, ids));
  }
  log(
    `ops.fill-attendance: ${punches.length} punches for ${roster.length} sample staff around ${anchor}`,
  );
}
