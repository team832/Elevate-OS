/**
 * Students (OPS-073…077; owner brief 20 Oct 2026 §7–§9). A student is a
 * canonical identity (`core.students`) with one or more admission cases; Academic
 * OS keeps its own `academic.students` record (linked by the enrolment reply).
 * This file: the lists, one row per student (status derived from all their cases) —
 * Active (admitted, awaiting or in enrolment), On hold, Past (an exit and no active
 * case) — and search. The profile is ./student-profile, hold/exit ./student-lifecycle,
 * guardians and contact preferences ./guardians (re-exported here for existing callers).
 *
 * Permissions: `ops:students:read` (counsellor: own scope = admission counsellor
 * or lead owner). Contact search additionally needs `ops:student_private:read`
 * and is audited (masked value). List SQL is in ./students-filters (re-exported here),
 * per-student lookups in ./students-lookups.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  not,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { can, scopeFor } from '@elevate/authorization';
import {
  opsAdmissions,
  opsAppointments,
  opsFollowUps,
  opsLeads,
  programmes,
  staffMembers,
  students,
  type Database,
} from '@elevate/database';
import { ForbiddenError } from '@elevate/shared-contracts';
import { addDays, istToday } from '../domain';
import { COHORT_PROGRAMMES } from '../domain/catalog';
import type { StudentFeeStatus } from '../domain/fee-plans';
import { academicStudentPath, deriveHandoffView } from '../domain/students';
import { caseState, maskPhone } from '../domain/student-lifecycle';
import { handoffInputOf } from './admissions';
import { accessScope, type Actor } from './context';
import { feeStatusForStudents } from './fees';
import { opsAudit } from './ops-common';
import { caseFilter, contactCondition, studentViewFilter } from './students-filters';
import {
  cohortOf,
  combinationOf,
  deliveriesFor,
  latestChanges,
  meetingsByIdentity,
  numbersByIdentity,
  programmesByIdentity,
  uniqueIds,
  upcoming,
} from './students-lookups';
import type { StudentSearchQuery } from './students-schemas';

export {
  activeCase,
  caseFilter,
  contactCondition,
  noOtherCase,
  ownCase,
  pastCase,
  studentViewFilter,
} from './students-filters';
export {
  getStudent,
  fetchAcademicStudentSummary,
  academicStudentSummarySchema,
} from './student-profile';
export { changeStudentLifecycle } from './student-lifecycle';
export { addGuardian, updateGuardian, recordContactPreferences } from './guardians';

const cohortCases = alias(opsAdmissions, 'cohort_cases');
const cohortProgrammes = alias(programmes, 'cohort_programmes');

/** Students with a case in one of these programmes. */
const identitiesIn = (db: Database, codes: readonly string[]) =>
  db
    .select({ id: cohortCases.studentId })
    .from(cohortCases)
    .innerJoin(cohortProgrammes, eq(cohortProgrammes.id, cohortCases.programmeId))
    .where(and(inArray(cohortProgrammes.code, [...codes]), isNotNull(cohortCases.studentId)));

/** Cohort, counsellor and upcoming-meeting filters (SQL). */
function dashboardConditions(db: Database, query: StudentSearchQuery, now: Date): SQL[] {
  const out: SQL[] = [];
  if (query.cohort)
    out.push(
      query.cohort === 'none'
        ? not(inArray(opsAdmissions.studentId, identitiesIn(db, COHORT_PROGRAMMES)))
        : inArray(opsAdmissions.studentId, identitiesIn(db, [query.cohort])),
    );
  if (query.meeting)
    out.push(
      or(
        inArray(
          opsAdmissions.studentId,
          db
            .select({ id: opsAppointments.studentId })
            .from(opsAppointments)
            .where(and(upcoming(now), isNotNull(opsAppointments.studentId))),
        ),
        inArray(
          opsAdmissions.id,
          db
            .select({ id: opsAppointments.admissionId })
            .from(opsAppointments)
            .where(and(upcoming(now), isNotNull(opsAppointments.admissionId))),
        ),
      ) as SQL,
    );
  return out;
}

const feeStatusOf = (fees: Map<string, StudentFeeStatus>, studentId: string | null) =>
  (studentId && fees.get(studentId)) || 'not_configured';

const tally = (keys: readonly string[]) => {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  return out;
};

/**
 * Dashboard counts of a list view: every student the caller may see in it (the
 * search filters are not applied, so the cards and charts can act as filters).
 * Fee counts are null without `ops:fees:read`.
 */
export async function studentListSummary(
  db: Database,
  actor: Actor,
  view: StudentSearchQuery['view'],
  now: Date = new Date(),
) {
  const access = await accessScope(db, actor, 'ops:students:read');
  const rows = await db
    .select({
      studentId: opsAdmissions.studentId,
      status: opsAdmissions.status,
      holdReviewDate: opsAdmissions.holdReviewDate,
    })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .where(studentViewFilter(db, view, undefined, caseFilter(db, {}, access)));
  const ids = rows.map((r) => r.studentId);
  const [progs, meetings, fees] = await Promise.all([
    programmesByIdentity(db, ids),
    meetingsByIdentity(db, ids, now),
    can(actor, 'ops:fees:read') ? feeStatusForStudents(db, uniqueIds(ids), now) : null,
  ]);
  const progsOf = (id: string | null) => (id ? progs.get(id) : undefined) ?? [];
  const reviewBy = addDays(istToday(now), 7);
  const meetingCounts = uniqueIds(ids).map((id) => meetings.get(id)?.length ?? 0);
  return {
    total: rows.length,
    cohorts: tally(rows.map((r) => cohortOf(progsOf(r.studentId).map((p) => p.code)))),
    combinations: tally(rows.map((r) => combinationOf(progsOf(r.studentId)))),
    statuses: tally(rows.map((r) => r.status)),
    fees: fees ? tally(rows.map((r) => feeStatusOf(fees, r.studentId))) : null,
    meetings: meetingCounts.reduce((a, b) => a + b, 0),
    studentsWithMeetings: meetingCounts.filter(Boolean).length,
    /** On hold with a review date passed or within 7 days. */
    reviewsDue: rows.filter((r) => r.holdReviewDate && r.holdReviewDate <= reviewBy).length,
  };
}

/** GET /students — lists, search (name, admission number/code; contact with permission), pages. */
export async function listStudents(
  db: Database,
  actor: Actor,
  query: StudentSearchQuery,
  requestId?: string,
  now: Date = new Date(),
) {
  const access = await accessScope(db, actor, 'ops:students:read');
  if (query.fee && !can(actor, 'ops:fees:read'))
    throw new ForbiddenError('Filtering by fee status needs ops:fees:read.');
  const conditions = [
    studentViewFilter(db, query.view, query.outcome, caseFilter(db, query, access)),
    ...dashboardConditions(db, query, now),
  ];
  if (query.q) {
    const q = `%${query.q.replace(/[%_\\]/g, '')}%`;
    conditions.push(
      or(
        ilike(opsLeads.studentName, q),
        ilike(opsAdmissions.code, q),
        ilike(opsAdmissions.admissionNumber, q),
        ilike(opsLeads.code, q),
      ) as SQL,
    );
  }
  const contact = query.contact ? contactCondition(db, query.contact) : null;
  if (contact) {
    if (!scopeFor(actor, 'ops:student_private:read'))
      throw new ForbiddenError('Searching by phone or email needs ops:student_private:read.');
    conditions.push(contact.sql);
  }
  if (query.fee) {
    // Fee status is computed from the plan and its ledger, so it filters the matching ids.
    const candidates = await db
      .select({ id: opsAdmissions.id, studentId: opsAdmissions.studentId })
      .from(opsAdmissions)
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
      .where(and(...conditions));
    const fees = await feeStatusForStudents(db, uniqueIds(candidates.map((c) => c.studentId)), now);
    const keep = candidates.filter((c) => feeStatusOf(fees, c.studentId) === query.fee);
    conditions.push(
      keep.length
        ? inArray(
            opsAdmissions.id,
            keep.map((c) => c.id),
          )
        : sql`false`,
    );
  }
  const where = and(...conditions);
  const order =
    query.sort === 'name'
      ? [asc(opsLeads.studentName), asc(opsAdmissions.code)]
      : query.sort === 'oldest'
        ? [asc(opsAdmissions.admittedAt), asc(opsAdmissions.code)]
        : [desc(opsAdmissions.admittedAt), desc(opsAdmissions.code)];
  const offset = query.cursor ? Number(query.cursor) : 0;
  const base = () =>
    db
      .select({
        a: opsAdmissions,
        leadCode: opsLeads.code,
        studentName: opsLeads.studentName,
        studentPhone: opsLeads.studentPhone,
        programmeCode: programmes.code,
        counsellorName: staffMembers.fullName,
        isSample: students.isSample,
      })
      .from(opsAdmissions)
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
      .leftJoin(staffMembers, eq(staffMembers.id, opsAdmissions.counsellorStaffId))
      .leftJoin(students, eq(students.id, opsAdmissions.studentId));
  const [rows, [totalRow]] = await Promise.all([
    base()
      .where(where)
      .orderBy(...order)
      .limit(query.limit + 1)
      .offset(offset),
    db
      .select({ n: count() })
      .from(opsAdmissions)
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
      .where(where),
  ]);
  const total = totalRow?.n ?? 0;
  if (contact)
    await opsAudit('student_search')(
      db,
      actor,
      null,
      'student.contact_search',
      { metadata: { kind: contact.kind, value: contact.masked, view: query.view, results: total } },
      requestId,
    );
  const page = rows.slice(0, query.limit);
  const ids = page.map((r) => r.a.id);
  const identityIds = page.map((r) => r.a.studentId);
  const [deliveries, numbers, followUps, fees, progs, meetings, changes] = await Promise.all([
    deliveriesFor(
      db,
      page.map((r) => r.a.lastRequestEventId),
    ),
    numbersByIdentity(db, identityIds),
    ids.length
      ? db
          .select({
            admissionId: opsFollowUps.admissionId,
            dueDate: opsFollowUps.dueDate,
            title: opsFollowUps.title,
          })
          .from(opsFollowUps)
          .where(and(inArray(opsFollowUps.admissionId, ids), eq(opsFollowUps.status, 'open')))
          .orderBy(asc(opsFollowUps.dueDate))
      : [],
    can(actor, 'ops:fees:read') ? feeStatusForStudents(db, uniqueIds(identityIds), now) : null,
    programmesByIdentity(db, identityIds),
    meetingsByIdentity(db, identityIds, now),
    latestChanges(db, ids),
  ]);
  return {
    items: page.map(({ a, ...r }) => {
      const delivery = a.lastRequestEventId ? deliveries.get(a.lastRequestEventId) : null;
      const next = followUps.find((f) => f.admissionId === a.id);
      const studentProgs = (a.studentId && progs.get(a.studentId)) || [];
      return {
        id: a.id,
        code: a.code,
        studentId: a.studentId,
        profileId: a.studentId ?? a.id,
        admissionNumber:
          a.admissionNumber ?? (a.studentId ? (numbers.get(a.studentId) ?? null) : null),
        leadId: a.leadId,
        leadCode: r.leadCode,
        studentName: r.studentName,
        isSample: r.isSample ?? false,
        /** Masked student phone, only in a (permitted, audited) contact search. */
        phoneMasked: contact ? maskPhone(r.studentPhone) : null,
        programmeCode: r.programmeCode,
        /** Every programme of the student (all cases), e.g. "Class 12 Commerce + CLAT UG preparation". */
        combination: combinationOf(studentProgs),
        cohort: cohortOf(studentProgs.map((p) => p.code)),
        intendedBatchId: a.intendedBatchId,
        enrolledBatchId: a.enrolledBatchId,
        counsellorStaffId: a.counsellorStaffId,
        counsellorName: r.counsellorName,
        ...caseState(a),
        /** When the current status was set and who recorded it. */
        statusSince: changes.get(a.id) ?? null,
        statusReason: a.statusReason,
        holdReviewDate: a.holdReviewDate,
        admissionDate: a.admissionDate,
        admittedAt: a.admittedAt,
        enrolledAt: a.enrolledAt,
        lastActivityAt: a.updatedAt,
        nextFollowUp: next ? { dueDate: next.dueDate, title: next.title } : null,
        nextMeeting: (a.studentId && meetings.get(a.studentId)?.[0]) || null,
        /** null = the caller may not read fees; `not_configured` = no active fee plan. */
        feeStatus: fees ? feeStatusOf(fees, a.studentId) : null,
        handoff: deriveHandoffView(handoffInputOf(a, delivery ?? null)),
        academicStudentId: a.academicStudentId,
        academicPath: academicStudentPath(a.academicStudentId),
      };
    }),
    total,
    nextCursor: rows.length > query.limit ? String(offset + query.limit) : null,
  };
}
