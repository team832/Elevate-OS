/**
 * Teacher directory and profiles (owner brief 20 Oct 2026 §12; brief 2 §7–8). A teacher is a
 * core.staff_members row (no second teacher table) + ops.staff_profiles + subject capabilities.
 * Workload is a count of booked appointments: a capacity view, not a score. Academic activity,
 * reviews authored, tasks and EOD come from their own sources (server/teacher-ops.ts); there is
 * no HR source and no manager appraisal of teachers.
 */
import { and, asc, count, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { can } from '@elevate/authorization';
import {
  auditEvents,
  departments,
  opsAppointments as appointments,
  opsDemoSessions,
  opsStaffProfiles,
  opsStaffSubjectCapabilities as capabilities,
  programmes,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import type { z } from 'zod';
import { addDays, istToday } from '../domain';
import { BLOCKING_STATUSES } from '../domain/appointments';
import { listAppointments } from './appointments';
import type { teacherListQuery, teacherUpdateBody } from './appointments-schemas';
import { accessScope, assertScope, programmeByCode, type Actor } from './context';
import { reviewsAuthored } from './academic-reviews';
import { listFeedbackAboutTeacher, listFeedbackByTeacher } from './feedback';
import { academicActivity, eodHistory, taskFacts, tasksReach } from './teacher-ops';
import { opsAudit, rowById } from './ops-common';

const DAY_MS = 86_400_000;
const managers = alias(staffMembers, 'managers');

/** Staff rows with profile, department and manager names. */
const people = (db: Database, ids: StaffMemberId[]) =>
  db
    .select({
      s: staffMembers,
      p: opsStaffProfiles,
      department: departments.name,
      manager: managers.fullName,
    })
    .from(staffMembers)
    .leftJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
    .leftJoin(departments, eq(departments.id, staffMembers.departmentId))
    .leftJoin(managers, eq(managers.id, staffMembers.managerId))
    .where(inArray(staffMembers.id, ids))
    .orderBy(asc(staffMembers.fullName));
const auditTeacher = opsAudit('teacher');

async function capabilityRows(db: Database, staffIds?: StaffMemberId[]) {
  return db
    .select({
      staffId: capabilities.staffId,
      subject: capabilities.subject,
      programmeId: capabilities.programmeId,
      programmeCode: programmes.code,
      verificationStatus: capabilities.verificationStatus,
    })
    .from(capabilities)
    .leftJoin(programmes, eq(programmes.id, capabilities.programmeId))
    .where(staffIds ? inArray(capabilities.staffId, staffIds) : undefined)
    .orderBy(asc(capabilities.subject));
}

/** Booked appointments + scheduled demo classes per staff member in the next `days` days. */
async function upcomingCounts(db: Database, staffIds: StaffMemberId[], days: number, now: Date) {
  const counts = new Map<string, number>();
  if (staffIds.length === 0) return counts;
  const end = new Date(now.getTime() + days * DAY_MS);
  const [appts, demos] = await Promise.all([
    db
      .select({ staffId: appointments.staffId, n: count() })
      .from(appointments)
      .where(
        and(
          inArray(appointments.staffId, staffIds),
          inArray(appointments.status, [...BLOCKING_STATUSES]),
          gte(appointments.startsAt, now),
          lt(appointments.startsAt, end),
        ),
      )
      .groupBy(appointments.staffId),
    db
      .select({ staffId: opsDemoSessions.teacherStaffId, n: count() })
      .from(opsDemoSessions)
      .where(
        and(
          inArray(opsDemoSessions.teacherStaffId, staffIds),
          eq(opsDemoSessions.attendance, 'scheduled'),
          gte(opsDemoSessions.startsAt, now),
          lt(opsDemoSessions.startsAt, end),
        ),
      )
      .groupBy(opsDemoSessions.teacherStaffId),
  ]);
  for (const r of [...appts, ...demos])
    if (r.staffId) counts.set(r.staffId, (counts.get(r.staffId) ?? 0) + r.n);
  return counts;
}

/** Directory: staff with at least one subject capability (optionally a matching one). */
export async function listTeachers(
  db: Database,
  actor: Actor,
  /** `withActivity` asks Academic OS for today's classes per teacher (the directory screen). */
  filters: z.output<typeof teacherListQuery> & { withActivity?: boolean } = {},
  now = new Date(),
) {
  const access = await accessScope(db, actor, 'ops:teachers:read');
  const programme = filters.programmeCode ? await programmeByCode(db, filters.programmeCode) : null;
  const subject = filters.subject?.trim().toLowerCase();
  const caps = await capabilityRows(db);
  const matching = caps.filter(
    (c) =>
      c.staffId &&
      (!subject || c.subject.toLowerCase().includes(subject)) &&
      (!programme || c.programmeId === programme.id),
  );
  let ids = [...new Set(matching.map((c) => c.staffId as StaffMemberId))];
  if (access.scope === 'own') ids = ids.filter((id) => id === access.staffId);
  const today = istToday(now);
  const [rows, upcoming, reach, academic] = await Promise.all([
    ids.length ? people(db, ids) : [],
    upcomingCounts(db, ids, 30, now),
    tasksReach(db, actor),
    filters.withActivity ? academicActivity(ids, { from: today, to: today }) : null,
  ]);
  const tasks = await taskFacts(db, reach, ids, now);
  return {
    teachers: rows.map(({ s, p, department, manager }) => ({
      id: s.id,
      fullName: s.fullName,
      displayName: p?.displayName ?? s.fullName,
      staffCode: p?.staffCode ?? null,
      department,
      manager,
      status: s.status,
      verificationStatus: p?.verificationStatus ?? 'unverified',
      roleNote: p?.roleNote ?? null,
      subjects: caps.filter((c) => c.staffId === s.id),
      upcoming30Days: upcoming.get(s.id) ?? 0,
      /** Today in Academic OS (null when not asked for). */
      academicToday: academic?.get(s.id) ?? null,
      /** Open/overdue tasks and today's EOD; null = not shared with this reader. */
      tasks: tasks.get(s.id) ?? null,
    })),
    unassignedSubjects: caps.filter((c) => !c.staffId).map((c) => c.subject),
  };
}

/** Picker options for the schedule form: active teachers for a subject, or all active staff. */
export async function staffPickerOptions(db: Database, actor: Actor, subject?: string) {
  if (subject?.trim()) {
    const { teachers } = await listTeachers(db, actor, { subject });
    return teachers
      .filter((t) => t.status === 'active')
      .map((t) => ({
        value: t.id,
        label: `${t.displayName} — ${t.subjects.map((s) => s.subject).join(', ')}`,
      }));
  }
  await accessScope(db, actor, 'ops:teachers:read');
  const [staff, caps] = await Promise.all([
    db
      .select({
        id: staffMembers.id,
        fullName: staffMembers.fullName,
        displayName: opsStaffProfiles.displayName,
      })
      .from(staffMembers)
      .leftJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
      .where(eq(staffMembers.status, 'active'))
      .orderBy(asc(staffMembers.fullName)),
    capabilityRows(db),
  ]);
  return staff.map((s) => {
    const subjects = caps.filter((c) => c.staffId === s.id).map((c) => c.subject);
    const name = s.displayName ?? s.fullName;
    return { value: s.id, label: subjects.length ? `${name} — ${subjects.join(', ')}` : name };
  });
}

export async function getTeacherProfile(db: Database, actor: Actor, id: string, now = new Date()) {
  const access = await accessScope(db, actor, 'ops:teachers:read');
  const staff = await rowById(db, staffMembers, id, 'Teacher');
  assertScope(access, [staff.id], 'teacher profiles');
  const readsFeedback = can(actor, 'ops:feedback:read');
  const today = istToday(now);
  const window = { from: addDays(today, -29), to: today };
  const reach = await tasksReach(db, actor);
  const [
    [person],
    subjects,
    week,
    month,
    history,
    upcoming,
    feedbackAbout,
    feedbackWritten,
    authored,
    activity,
    tasks,
    eods,
  ] = await Promise.all([
    people(db, [staff.id]),
    capabilityRows(db, [staff.id]),
    upcomingCounts(db, [staff.id], 7, now),
    upcomingCounts(db, [staff.id], 30, now),
    db
      .select({ e: auditEvents, actorName: users.displayName })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(
        and(
          eq(auditEvents.entityId, staff.id),
          inArray(auditEvents.entityType, ['teacher', 'staff_member']),
        ),
      )
      .orderBy(desc(auditEvents.at))
      .limit(20),
    can(actor, 'ops:appointments:read')
      ? listAppointments(db, actor, { staffId: staff.id, from: today }, 10)
      : null,
    listFeedbackAboutTeacher(db, actor, staff.id),
    readsFeedback ? listFeedbackByTeacher(db, actor, staff.id) : null,
    readsFeedback ? reviewsAuthored(db, actor, staff.id) : null,
    academicActivity([staff.id], window).then((m) => m.get(staff.id)!),
    taskFacts(db, reach, [staff.id], now).then((m) => m.get(staff.id) ?? null),
    eodHistory(db, reach, staff.id),
  ]);
  // Private notes never leave the server (brief 2 §7).
  const { notes: _notes, ...profile } = person?.p ?? { notes: null };

  return {
    staff,
    profile: person?.p ? (profile as Omit<NonNullable<typeof person.p>, 'notes'>) : null,
    displayName: person?.p?.displayName ?? staff.fullName,
    department: person?.department ?? null,
    manager: person?.manager ?? null,
    subjects,
    workload: { next7Days: week.get(staff.id) ?? 0, next30Days: month.get(staff.id) ?? 0 },
    upcoming: upcoming?.rows ?? null,
    feedbackAbout,
    feedbackWritten,
    /** Submitted reviews this teacher wrote in Academic OS, each within the reader's scope. */
    reviewsAuthored: authored,
    /** Academic OS, last 30 days (IST): assignments, sessions, pending logs and marking. */
    activity,
    activityWindow: window,
    tasks,
    eods,
    history: history.map(({ e, actorName }) => ({
      id: e.id,
      at: e.at,
      action: e.action,
      actorName,
    })),
  };
}

export async function updateTeacher(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof teacherUpdateBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:teachers:manage');
  return withTransaction(db, async (tx) => {
    const staff = await rowById(tx, staffMembers, id, 'Teacher');
    const [before] = await tx
      .select()
      .from(opsStaffProfiles)
      .where(eq(opsStaffProfiles.staffId, staff.id));
    if (input.staffCode) {
      const [taken] = await tx
        .select({ id: opsStaffProfiles.staffId })
        .from(opsStaffProfiles)
        .where(
          and(
            eq(opsStaffProfiles.staffCode, input.staffCode),
            sql`${opsStaffProfiles.staffId} <> ${staff.id}`,
          ),
        );
      if (taken) throw new ConflictError(`Staff code ${input.staffCode} is already in use.`);
    }
    const values = {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.staffCode !== undefined ? { staffCode: input.staffCode } : {}),
      ...(input.verificationStatus ? { verificationStatus: input.verificationStatus } : {}),
      ...(input.roleNote !== undefined ? { roleNote: input.roleNote } : {}),
      updatedBy: actor.id,
    };
    const [after] = await tx
      .insert(opsStaffProfiles)
      .values({ staffId: staff.id, ...values })
      .onConflictDoUpdate({ target: opsStaffProfiles.staffId, set: values })
      .returning();
    const subjectsBefore = (await capabilityRows(tx, [staff.id])).map((c) => c.subject);
    if (input.subjects) {
      const keep = new Set(input.subjects);
      const drop = subjectsBefore.filter((s) => !keep.has(s));
      if (drop.length)
        await tx
          .delete(capabilities)
          .where(and(eq(capabilities.staffId, staff.id), inArray(capabilities.subject, drop)));
      const add = input.subjects.filter((s) => !subjectsBefore.includes(s));
      if (add.length)
        await tx.insert(capabilities).values(
          add.map((subject) => ({
            staffId: staff.id,
            subject,
            sourceNote: 'Added by staff in Elevate OS',
          })),
        );
    }
    await auditTeacher(
      tx,
      actor,
      staff.id,
      'teacher.updated',
      {
        before: { ...before, subjects: subjectsBefore },
        after: { ...after, subjects: input.subjects ?? subjectsBefore },
      },
      requestId,
    );
    return after;
  });
}

/** Distinct subjects in the capability catalogue (assigned or not), for filters. */
export async function subjectCatalogue(db: Database) {
  const rows = await db
    .selectDistinct({ subject: capabilities.subject })
    .from(capabilities)
    .orderBy(asc(capabilities.subject));
  return rows.map((r) => r.subject);
}
