/**
 * Owner, 31 Oct 2026: "Attendance data ... totals that contradict rows." Every sample staff member,
 * login or not: about thirty days of punches with a real mix (on time, late, absent, leave, holiday,
 * short days, forgotten check-outs), HR's decision on every older day the punches leave open, so a
 * day reads Unmarked only in the last week where HR has not got to it yet. Leave in every application
 * state and corrections go through the real services and are then marked sample (no route sets the
 * flag). A teacher's approved leave is in the past: approving future leave for a teacher asks Academic
 * OS about classes, and a seed runs with no server up. Safe to run again on any day.
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsAttendanceCorrections,
  opsAttendanceImports,
  opsAttendancePunches,
  opsDailyAttendance,
  opsHolidays,
  opsLeaveApplications,
  opsLeaveRecords,
  opsStaffProfiles,
  opsWorkSchedules,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { sampleRowIds, sampleText as why } from '@elevate/database/seed';
import { datesBetween } from '../src/domain/attendance';
import { addDays, istInstant, weekdayOf, type IsoDate } from '../src/domain/dates';
import { recordLeave } from '../src/server/attendance-actions';
import { decideCorrection, requestCorrection } from '../src/server/attendance-corrections';
import {
  applyForLeave,
  cancelLeaveApplication,
  decideLeave,
} from '../src/server/leave-applications';
import { DEMO_TEACHER_EMAIL } from './fill-people';
import { hrAttendanceStaff } from '../src/server/attendance';
import { sampleAnchorDate } from './sample-staff';
import { seedActor } from './samples';

const roll = (s: string) => {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 100;
};
const shift = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000);

/** The same result for the same person and day, whenever it runs. Null = no punch at all. */
function dayShape(staffId: string, date: string) {
  const r = roll(`${staffId}:${date}`);
  if (r < 70) {
    const late = (r % 13) - 7;
    return { in: late, out: Math.max(late, 0) + (r % 25) };
  }
  if (r < 82) {
    const late = 20 + (r % 40);
    return { in: late, out: late + (r % 15) }; // late, and stayed back to make up the hours
  }
  if (r < 86) return { in: (r % 9) - 4, out: null }; // forgot to check out
  if (r < 90) return { in: (r % 7) - 3, short: 270 }; // left after a half day
  if (r < 93) return { in: (r % 5) - 2, short: 150 }; // too short for even a half day: HR decides
  if (r < 96) return null;
  return { in: -12, out: 45 };
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const IMPORT_FROM = -30;
const IMPORT_TO = -9;
const FILE = 'Punch export, last four weeks.csv';
/** HR has not reached the days after this one yet: only they may still read Unmarked. */
const DECIDED_UNTIL = -6;

/**
 * [person, from, to, type, reason, then: approve | reject | HR cancels after approving | they cancel,
 * HR's note]. A person key is a staff code, a login email, or 'demo'.
 */
const LEAVE: readonly [string, number, number, string, string, string?, string?][] = [
  ['EMP-T02', -9, -8, 'Casual', 'Family function.', 'approve', 'Cover arranged.'],
  ['EMP-T05', -3, -3, 'Sick', 'Fever; doctor advised rest.', 'approve', 'Get well soon.'],
  ['demo', -6, -6, 'Casual', 'Personal work in Jaipur.', 'approve'],
  ['EMP-T08', -2, -2, 'Casual', 'A family visit.', 'revoke', 'The visit moved, and the teacher came to work.'],
  ['rohit.saini@example.test', 4, 5, 'Earned', 'A family trip.', 'approve', 'Pooja covers the calendar.'],
  ['demo', 5, 6, 'Earned', 'A family wedding in Jaipur.'],
  ['EMP-T07', 3, 5, 'Earned', 'Going home for a family wedding.'],
  ['EMP-T09', 9, 9, 'Casual', 'Bank work.', 'reject', 'He is on exam duty that day; please choose another date.'],
  ['EMP-T04', 12, 12, 'Unpaid', 'A cousin is visiting.', 'withdraw', 'The visit was called off.'],
  ['EMP-T01', -16, -15, 'Sick', 'Viral fever; medical note attached with the coordinator.', 'approve', 'Noted; classes covered by Neel.'],
  ['EMP-T03', -24, -24, 'Casual', 'School admission work for my daughter.', 'approve'],
  ['EMP-T06', -20, -19, 'Earned', 'Sister’s engagement in Udaipur.', 'approve', 'Enjoy the function.'],
  ['EMP-T10', -11, -11, 'Casual', 'Electricity bill dispute at the board office.', 'approve'],
  ['EMP-T11', 7, 7, 'Casual', 'Renewing my driving licence.'],
  ['EMP-T12', -13, -12, 'Unpaid', 'Travelling for a family emergency.', 'approve', 'Take care; let us know if you need more days.'],
  ['EMP-T12', 15, 16, 'Earned', 'Attending a teachers’ conference in Delhi.', 'withdraw', 'The conference was postponed.'],
  ['EMP-T03', 18, 19, 'Earned', 'Attending a teaching workshop in Jaipur.'],
  ['academic-coordinator@example.test', -18, -18, 'Casual', 'Moving house.', 'approve', 'Fine; Sunanda covers the desk.'],
  ['academic-coordinator@example.test', 8, 8, 'Casual', 'Parent-teacher meeting at my son’s school.', 'approve'],
  ['admissions-counsellor@example.test', -7, -7, 'Sick', 'Migraine.', 'approve', 'Rest well.'],
  ['admissions-counsellor@example.test', 11, 12, 'Earned', 'Short trip home.', 'reject', 'The admission fair is on those days; please pick the following week.'],
  ['marketing-contributor@example.test', 6, 6, 'Casual', 'A college friend’s wedding.'],
  ['marketing-manager@example.test', -22, -21, 'Earned', 'Family trip to Ajmer.', 'approve'],
  ['operations-manager@example.test', 14, 15, 'Earned', 'Attending my brother’s graduation.'],
  ['pooja.verma@example.test', -10, -10, 'Sick', 'Dental surgery.', 'approve', 'Take care.'],
  ['pooja.verma@example.test', 20, 22, 'Earned', 'Family wedding in Kota.'],
  ['schar.mathur@elevateeducation.in', -25, -25, 'Casual', 'Passport appointment.', 'approve'],
  ['director@example.test', 25, 26, 'Earned', 'Annual family visit.'],
  ['platform-admin@example.test', -15, -15, 'Sick', 'Food poisoning.', 'approve'],
  ['hr-manager@example.test', -23, -23, 'Casual', 'Bank locker work.', 'approve'],
];

/** Leave HR recorded with no application (these people have no login): [name, from, to, type, reason]. */
const RECORDED: readonly [string, number, number, string, string][] = [
  ['Neel Shah', -15, -14, 'Casual', 'Told HR in person; recorded by HR with no application.'],
  ['Farida Khan', -11, -10, 'Sick', 'Called the front desk; medical note handed in on return.'],
  ['Kunal Vyas', -12, -11, 'Casual', 'Family wedding in Ajmer; told the coordinator a week before.'],
  ['Tanvi Gokhale', -4, -4, 'Casual', 'Audit work for a client; told HR the day before.'],
  ['Lalit Bhatt', -20, -19, 'Earned', 'Teachers’ workshop in Jaipur, agreed with the academic manager.'],
  ['Geeta Menon', -3, -2, 'Sick', 'Chest infection; her husband called the front desk.'],
];

/** [person, day, what they ask, why, HR's answer: null = waiting; second HR person decides when said]. */
const CORRECTIONS: readonly [
  string,
  number,
  { requestedStatus?: 'present' | 'half_day' | 'absent'; requestedIn?: string; requestedOut?: string },
  string,
  { decision: 'approved' | 'rejected'; note: string; by?: string } | null,
][] = [
  ['demo', -1, { requestedOut: '17:35' }, 'I forgot to check out after the evening class.', null],
  ['EMP-T04', -2, { requestedIn: '09:02' }, 'The check-in did not record at the gate.', null],
  ['EMP-T03', -4, { requestedOut: '17:10' }, 'Left at the usual time, no check-out shown.', { decision: 'approved', note: 'Matches the class register.' }],
  ['EMP-T06', -7, { requestedStatus: 'present' }, 'I was at the Jaipur test centre that day.', { decision: 'approved', note: 'Duty letter seen.' }],
  ['demo', -10, { requestedIn: '08:40' }, 'I arrived before the first class.', { decision: 'rejected', note: 'The first class started at 11:00 AM that day and the register shows no earlier work.' }],
  ['EMP-T02', -3, { requestedStatus: 'half_day' }, 'I left at lunch with the manager’s permission; please mark a half day.', { decision: 'approved', note: 'Manager confirmed.', by: 'hr@elevateeducation.in' }],
  ['EMP-T09', -12, { requestedStatus: 'absent' }, 'I was not in that day; my badge was used by mistake.', { decision: 'rejected', note: 'The class register shows you taught that morning.', by: 'hr@elevateeducation.in' }],
  ['academic-coordinator@example.test', -2, { requestedOut: '18:20' }, 'The machine was off when I left.', null],
  ['admissions-counsellor@example.test', -5, { requestedIn: '09:55' }, 'Was at the front desk with a parent; punched in late.', null],
  ['marketing-contributor@example.test', -3, { requestedStatus: 'present' }, 'I worked from the partner school all day for the seminar.', { decision: 'approved', note: 'Seminar log agrees.', by: 'hr@elevateeducation.in' }],
  ['pooja.verma@example.test', -8, { requestedOut: '18:45' }, 'Stayed late for the open-house shoot.', { decision: 'approved', note: 'Marketing manager confirmed.' }],
  ['rohit.saini@example.test', -1, { requestedStatus: 'present' }, 'I was at the seminar hall booking all morning.', null],
];

const DECISION_NOTES = {
  absent: [
    'No check-in and no leave recorded; spoke to the teacher.',
    'Did not come in and sent no message; recorded as absent after a call.',
    'Absent without leave; told the manager the next morning.',
  ],
  present: [
    'Forgot to check out; the class register confirms a full day.',
    'Check-out missed; the manager confirms they stayed until closing.',
    'Worked at the Sikar centre annexe; no punch machine there.',
  ],
  half_day: [
    'Left at 1:30 PM with the manager’s permission.',
    'Came in only for the morning classes; agreed with the coordinator.',
    'Left early for a family matter; manager informed.',
  ],
} as const;

/** Every sample staff member, login or not; someone who left has days up to their last. */
async function everyone(db: Database) {
  return db
    .select({
      staffId: staffMembers.id,
      userId: users.id,
      name: staffMembers.fullName,
      email: users.email,
      code: opsStaffProfiles.staffCode,
      scheduleId: opsStaffProfiles.workScheduleId,
      leftOn: opsStaffProfiles.leftOn,
    })
    .from(staffMembers)
    .innerJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
    .leftJoin(users, eq(users.id, staffMembers.userId))
    .where(eq(opsStaffProfiles.isSample, true))
    .orderBy(staffMembers.fullName);
}

export async function seedFillAttendance(db: Database, log: (m: string) => void = () => {}) {
  const roster = await everyone(db);
  if (!roster.length) return log('ops.fill-attendance skipped: no sample staff');
  const hr = (await seedActor(db, 'hr-manager@example.test'))!;
  const hr2 = (await seedActor(db, 'hr@elevateeducation.in')) ?? hr;
  // HR reaches its own departments; the operations manager decides for everyone else.
  const ops = (await seedActor(db, 'operations-manager@example.test'))!;
  const reach = new Set((await hrAttendanceStaff(db, hr.actor)).map((s) => s.id as string));
  const deciderFor = (staffId: string, email: string | null) =>
    reach.has(staffId) && email !== 'hr-manager@example.test' ? hr : ops;
  const anchor = sampleAnchorDate() as IsoDate;
  const now = new Date(); // the real clock on purpose: a punch is never in the future
  const person = (key: string) =>
    roster.find((r) =>
      key === 'demo'
        ? r.email === DEMO_TEACHER_EMAIL
        : key.includes('@')
          ? r.email === key
          : r.code === key || r.name === key,
    );
  const ids = roster.map((r) => r.staffId);

  // Leave, once: every application state, and leave HR recorded with no application.
  if (!(await db.$count(opsLeaveApplications, eq(opsLeaveApplications.isSample, true)))) {
    for (const [who, from, to, kind, reason, then, note] of LEAVE) {
      const p = person(who);
      if (!p?.email) continue;
      const self = (await seedActor(db, p.email))!.actor;
      if (!can(self, 'ops:attendance:request')) continue; // some roles have no self-service
      const decider = deciderFor(p.staffId, p.email).actor;
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
        await decideLeave(db, decider, a.id, { decision: 'rejected', note, version } as never);
      if (then === 'approve' || then === 'revoke') {
        const done = await decideLeave(db, decider, a.id, {
          decision: 'approved',
          note,
          version,
        } as never);
        if (then === 'revoke')
          await cancelLeaveApplication(db, decider, a.id, {
            reason: note!,
            version: done.version,
          } as never);
      }
    }
    for (const [name, from, to, kind, reason] of RECORDED) {
      const p = person(name);
      if (p)
        await recordLeave(db, hr.actor, {
          staffId: p.staffId,
          fromDate: addDays(anchor, from),
          toDate: addDays(anchor, to),
          kind,
          reason,
          isSample: true,
        } as never);
    }
    for (const t of [opsLeaveApplications, opsLeaveRecords])
      await db.update(t).set({ isSample: true }).where(inArray(t.staffId, ids));
    // Applied a few days before the leave, decided the next day; the audit trail follows.
    await db.execute(sql`UPDATE ops.leave_applications SET
        created_at = LEAST(created_at, (from_date::timestamp AT TIME ZONE 'Asia/Kolkata') - interval '3 days' + interval '11 hours'),
        decided_at = CASE WHEN decided_at IS NULL THEN NULL
          ELSE LEAST(decided_at, (from_date::timestamp AT TIME ZONE 'Asia/Kolkata') - interval '2 days' + interval '10 hours') END
      WHERE is_sample`);
    await db.execute(sql`UPDATE core.audit_events e SET at = CASE
          WHEN e.action = 'leave.applied' THEN a.created_at
          ELSE coalesce(a.decided_at, a.created_at + interval '1 day') END
      FROM ops.leave_applications a
      WHERE e.entity_type = 'leave_application' AND e.entity_id = a.id::text AND a.is_sample`);
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
  const decisions: (typeof opsDailyAttendance.$inferInsert)[] = [];
  const dates = datesBetween(addDays(anchor, IMPORT_FROM), anchor);
  const importedLast = addDays(anchor, IMPORT_TO);
  const decidedLast = addDays(anchor, DECIDED_UNTIL);
  const yesterday = addDays(anchor, -1);
  roster.forEach((r, place) => {
    const pattern = schedules.find((s) => s.id === r.scheduleId)?.weeklyPattern;
    if (!pattern) return;
    for (const date of dates) {
      const day = pattern[DAY_KEYS[weekdayOf(date)]!];
      if (
        !day ||
        (r.leftOn && date > r.leftOn) ||
        holidays.some((h) => h.on === date) ||
        leave.some((l) => l.staffId === r.staffId && l.fromDate <= date && l.toDate >= date)
      )
        continue;
      // Every twelfth person has not punched yesterday, so the review list has work.
      const shape = date === yesterday && place % 12 === 3 ? null : dayShape(r.staffId, date);
      const decide = (status: keyof typeof DECISION_NOTES) =>
        decisions.push({
          staffId: r.staffId,
          workDate: date,
          status,
          basis: 'hr_decision',
          decidedByUserId: (place % 3 ? hr : hr2).actor.id,
          note: DECISION_NOTES[status][roll(`${r.staffId}:${date}:n`) % 3]!,
          isSample: true,
        });
      if (date <= decidedLast) {
        if (!shape) decide(roll(`${r.staffId}:${date}:d`) % 4 ? 'absent' : 'present');
        else if (shape.out === null) decide('present');
        else if ('short' in shape && shape.short === 150) decide('half_day');
      }
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
  });
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
  const t1 = person('EMP-T01')!;
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

  // Corrections once, through the real service, then the generated decisions on the days left open.
  if (!(await db.$count(opsAttendanceCorrections, eq(opsAttendanceCorrections.isSample, true)))) {
    for (const [who, day, ask, reason, answer] of CORRECTIONS) {
      const p = person(who);
      if (!p?.userId) continue;
      const date = addDays(anchor, day);
      const row = await requestCorrection(db, { id: p.userId, roles: ['teacher'] }, {
        workDate: date,
        reason,
        requestedStatus: ask.requestedStatus ?? null,
        requestedIn: ask.requestedIn ? istInstant(date, ask.requestedIn) : null,
        requestedOut: ask.requestedOut ? istInstant(date, ask.requestedOut) : null,
      } as never);
      if (answer) {
        const named = answer.by ? await seedActor(db, answer.by) : null;
        const decider = named && reach.has(p.staffId) ? named : deciderFor(p.staffId, p.email);
        await decideCorrection(db, decider.actor, row.id, answer as never);
      }
    }
  }
  for (let i = 0; i < decisions.length; i += 300)
    await db
      .insert(opsDailyAttendance)
      .values(decisions.slice(i, i + 300))
      .onConflictDoNothing();
  // No route may set the sample flag; what the services wrote belongs to sample staff only.
  for (const t of [opsAttendanceCorrections, opsAttendancePunches, opsDailyAttendance])
    await db.update(t).set({ isSample: true }).where(inArray(t.staffId, ids));
  log(
    `ops.fill-attendance: ${punches.length} punches for ${roster.length} sample staff around ${anchor}`,
  );
}
