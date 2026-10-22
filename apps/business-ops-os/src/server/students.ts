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
 * and is audited (masked value).
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  ne,
  not,
  notExists,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { can, scopeFor } from '@elevate/authorization';
import {
  eventDeliveries,
  opsAdmissions,
  opsAdmissionTransitions,
  opsAppointments,
  opsFollowUps,
  opsGuardians,
  opsLeads,
  programmes,
  staffMembers,
  students,
  users,
  type Database,
} from '@elevate/database';
import { ForbiddenError, ValidationError } from '@elevate/shared-contracts';
import type { IntegrationEventId, StudentIdentityId } from '@elevate/shared-types';
import {
  addDays,
  EXIT_STATUSES,
  istToday,
  normaliseEmail,
  normalisePhone,
  PHONE_ERROR_MESSAGES,
} from '../domain';
import { BLOCKING_STATUSES } from '../domain/appointments';
import { maskEmail } from '../domain/kyc';
import { COHORT_PROGRAMMES, combinationLabel } from '../domain/catalog';
import type { StudentFeeStatus } from '../domain/fee-plans';
import { academicStudentPath, deriveHandoffView } from '../domain/students';
import {
  ACTIVE_CASE_STATUSES,
  caseState,
  maskPhone,
  PAST_OUTCOME_STATUSES,
  type PastOutcome,
} from '../domain/student-lifecycle';
import { ACADEMIC_INTAKE_CONSUMER, handoffInputOf } from './admissions';
import { accessScope, type AccessScope, type Actor } from './context';
import { feeStatusForStudents } from './fees';
import { groupBy, opsAudit } from './ops-common';
import type { StudentSearchQuery } from './students-schemas';

export {
  getStudent,
  fetchAcademicStudentSummary,
  academicStudentSummarySchema,
} from './student-profile';
export { changeStudentLifecycle } from './student-lifecycle';
export { addGuardian, updateGuardian, recordContactPreferences } from './guardians';

const EXITS = [...EXIT_STATUSES];
// Loose column type so the same conditions run on `ops.admissions` and its alias.
type CaseColumns = Record<
  | 'status'
  | 'heldFromStatus'
  | 'admittedAt'
  | 'handoffStatus'
  | 'programmeId'
  | 'counsellorStaffId'
  | 'leadId',
  AnyPgColumn
>;
const lostAfterAdmission = (t: CaseColumns = opsAdmissions) =>
  and(eq(t.status, 'lost'), isNotNull(t.admittedAt)) as SQL;
const heldAfterAdmission = (t: CaseColumns = opsAdmissions) =>
  and(eq(t.status, 'on_hold'), inArray(t.heldFromStatus, [...ACTIVE_CASE_STATUSES])) as SQL;
/** A case that keeps its student active (on hold included: a held student is not past). */
export const activeCase = (t: CaseColumns = opsAdmissions) =>
  or(inArray(t.status, [...ACTIVE_CASE_STATUSES]), heldAfterAdmission(t)) as SQL;
export const pastCase = (t: CaseColumns = opsAdmissions) =>
  or(inArray(t.status, EXITS), lostAfterAdmission(t)) as SQL;

const otherCase = alias(opsAdmissions, 'other_cases');
/** No other case of the same student matches `where` (a case without an identity stands alone). */
export const noOtherCase = (db: Database, where: (t: typeof otherCase) => SQL) =>
  or(
    isNull(opsAdmissions.studentId),
    notExists(
      db
        .select({ one: sql`1` })
        .from(otherCase)
        .where(
          and(
            eq(otherCase.studentId, opsAdmissions.studentId),
            ne(otherCase.id, opsAdmissions.id),
            where(otherCase),
          ),
        ),
    ),
  ) as SQL;
/** One row per student: the most recently changed case among those matching `match`. */
const latestOf = (db: Database, match: (t: CaseColumns) => SQL) =>
  and(
    match(opsAdmissions),
    noOtherCase(
      db,
      (o) =>
        and(
          match(o),
          or(
            gt(o.updatedAt, opsAdmissions.updatedAt),
            and(eq(o.updatedAt, opsAdmissions.updatedAt), gt(o.id, opsAdmissions.id)),
          ),
        ) as SQL,
    ),
  ) as SQL;

/** Own scope on a case (or its alias): the case counsellor or the lead owner. */
export function ownCase(db: Database, access: AccessScope, t: CaseColumns = opsAdmissions) {
  if (access.scope === 'all') return undefined;
  if (!access.staffId) return sql`false`;
  return or(
    eq(t.counsellorStaffId, access.staffId),
    inArray(
      t.leadId,
      db
        .select({ id: opsLeads.id })
        .from(opsLeads)
        .where(eq(opsLeads.ownerStaffId, access.staffId)),
    ),
  ) as SQL;
}

const stateFilter = (t: CaseColumns, state: NonNullable<StudentSearchQuery['state']>) =>
  ({
    admitted: eq(t.status, 'admitted'),
    awaiting_enrolment: eq(t.status, 'enrolment_requested'),
    enrolled: eq(t.status, 'enrolled'),
    withdrawn: lostAfterAdmission(t),
  })[state];

/**
 * Case-level filters (state, handoff, programme, counsellor, own scope) as a predicate on a case
 * or its alias, so they apply to a student's cases BEFORE one row per student is chosen.
 */
export const caseFilter =
  (db: Database, q: Partial<StudentSearchQuery>, access?: AccessScope) => (t: CaseColumns) =>
    and(
      q.state ? stateFilter(t, q.state) : undefined,
      q.handoff ? eq(t.handoffStatus, q.handoff) : undefined,
      q.programme
        ? inArray(
            t.programmeId,
            db
              .select({ id: programmes.id })
              .from(programmes)
              .where(eq(programmes.code, q.programme)),
          )
        : undefined,
      q.counsellor ? eq(t.counsellorStaffId, q.counsellor) : undefined,
      access ? ownCase(db, access, t) : undefined,
    );

/**
 * SQL per list view (A-STU-2; brief §11: directory status is per student, never per case).
 * - directory: every admitted case, as before;
 * - active: students with an active case not on hold, one row each;
 * - on_hold: students with a case on hold after admission, one row each (reached from Active);
 * - former (Past): students with an exit and NO active case at all, one row each (the latest
 *   exit, within the outcome filter when one is given). A student active anywhere is not past,
 *   whatever the caller's scope.
 * `cases` (caseFilter) narrows the cases first; the row per student is chosen among them.
 */
export function studentViewFilter(
  db: Database,
  view: StudentSearchQuery['view'],
  outcome?: PastOutcome,
  cases: (t: CaseColumns) => SQL | undefined = () => undefined,
): SQL {
  const pick = (match: (t: CaseColumns) => SQL) =>
    latestOf(db, (t) => and(match(t), cases(t)) as SQL);
  if (view === 'directory')
    return and(
      or(
        inArray(opsAdmissions.status, ['admitted', 'enrolment_requested', 'enrolled', ...EXITS]),
        lostAfterAdmission(),
        heldAfterAdmission(),
      ),
      cases(opsAdmissions),
    ) as SQL;
  if (view === 'active') return pick((t) => inArray(t.status, [...ACTIVE_CASE_STATUSES]));
  if (view === 'on_hold') return pick(heldAfterAdmission);
  return and(
    pick(
      (t) =>
        (outcome
          ? and(pastCase(t), inArray(t.status, [...PAST_OUTCOME_STATUSES[outcome]]))
          : pastCase(t)) as SQL,
    ),
    noOtherCase(db, activeCase),
  ) as SQL;
}

async function deliveriesFor(db: Database, eventIds: readonly (string | null)[]) {
  const ids = [...new Set(eventIds.filter((e): e is string => Boolean(e)))] as IntegrationEventId[];
  if (!ids.length)
    return new Map<string, { status: string; attempts: number; lastError: string | null }>();
  const rows = await db
    .select({
      eventId: eventDeliveries.eventId,
      status: eventDeliveries.status,
      attempts: eventDeliveries.attempts,
      lastError: eventDeliveries.lastError,
    })
    .from(eventDeliveries)
    .where(
      and(
        inArray(eventDeliveries.eventId, ids),
        eq(eventDeliveries.consumer, ACADEMIC_INTAKE_CONSUMER),
      ),
    );
  return new Map(rows.map((r) => [r.eventId as string, r]));
}

/**
 * Contact search (phone or email of the student or a guardian), normalised.
 * Only with `ops:student_private:read`; the audit row keeps a masked value.
 */
export function contactCondition(
  db: Database,
  raw: string,
): { sql: SQL; kind: 'email' | 'phone'; masked: string } {
  if (raw.includes('@')) {
    const e = normaliseEmail(raw);
    if (!e.ok)
      throw new ValidationError('Not a valid email address.', {
        details: [{ location: 'query', path: ['contact'], message: 'Invalid email' }],
      });
    return {
      kind: 'email',
      masked: maskEmail(e.email)!,
      sql: or(
        eq(opsLeads.studentEmail, e.email),
        eq(opsLeads.guardianEmail, e.email),
        inArray(opsAdmissions.studentId, guardianIdentities(db, eq(opsGuardians.email, e.email))),
      ) as SQL,
    };
  }
  const p = normalisePhone(raw);
  const digits = raw.replace(/\D/g, '');
  if (!p.ok && digits.length < 4)
    throw new ValidationError(PHONE_ERROR_MESSAGES[p.reason], {
      details: [{ location: 'query', path: ['contact'], message: PHONE_ERROR_MESSAGES[p.reason] }],
    });
  // A full number matches exactly; a partial one (≥ 4 digits) matches the end of the number.
  const match = (col: AnyPgColumn) => (p.ok ? eq(col, p.e164) : like(col, `%${digits}`));
  return {
    kind: 'phone',
    masked: p.ok ? (maskPhone(p.e164) as string) : `…${digits.slice(-2)}`,
    sql: or(
      match(opsLeads.studentPhone),
      match(opsLeads.guardianPhone),
      inArray(opsAdmissions.studentId, guardianIdentities(db, match(opsGuardians.phone))),
    ) as SQL,
  };
}

function guardianIdentities(db: Database, where: SQL) {
  return db
    .select({ id: opsGuardians.studentId })
    .from(opsGuardians)
    .where(and(where, isNull(opsGuardians.archivedAt)));
}

/** The admission number of each identity (on its numbered case). */
async function numbersByIdentity(db: Database, ids: readonly (string | null)[]) {
  const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))] as StudentIdentityId[];
  if (!unique.length) return new Map<string, string>();
  const rows = await db
    .select({ id: opsAdmissions.studentId, n: opsAdmissions.admissionNumber })
    .from(opsAdmissions)
    .where(and(inArray(opsAdmissions.studentId, unique), isNotNull(opsAdmissions.admissionNumber)))
    .orderBy(asc(opsAdmissions.createdAt));
  const out = new Map<string, string>();
  for (const r of rows) if (r.id && r.n && !out.has(r.id)) out.set(r.id, r.n);
  return out;
}

const uniqueIds = (ids: readonly (string | null)[]) =>
  [...new Set(ids.filter((i): i is string => Boolean(i)))] as StudentIdentityId[];

/** Programmes of each identity across all its cases (a cohort and an exam are two cases). */
async function programmesByIdentity(db: Database, ids: readonly (string | null)[]) {
  const unique = uniqueIds(ids);
  if (!unique.length) return new Map<string, { code: string; name: string }[]>();
  const rows = await db
    .selectDistinct({ id: opsAdmissions.studentId, code: programmes.code, name: programmes.name })
    .from(opsAdmissions)
    .innerJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
    .where(inArray(opsAdmissions.studentId, unique));
  return groupBy(rows, (r) => r.id);
}

/** The cohort programme of a combination, or `none` (an entrance programme only). */
const cohortOf = (codes: readonly string[]) =>
  codes.find((c) => (COHORT_PROGRAMMES as readonly string[]).includes(c)) ?? 'none';

const combinationOf = (progs: readonly { code: string; name: string }[] = []) =>
  progs.length
    ? combinationLabel(
        progs.map((p) => p.code),
        Object.fromEntries(progs.map((p) => [p.code, p.name])),
      )
    : 'Programme not set';

/** Meetings still to happen (proposed, scheduled, confirmed, rescheduled; from now). */
const upcoming = (now: Date) =>
  and(inArray(opsAppointments.status, [...BLOCKING_STATUSES]), gte(opsAppointments.startsAt, now));

/** Upcoming meetings of each identity: linked to the student or to one of their cases. */
async function meetingsByIdentity(db: Database, ids: readonly (string | null)[], now: Date) {
  const unique = uniqueIds(ids);
  if (!unique.length)
    return new Map<string, { startsAt: Date; type: string; staffName: string }[]>();
  const rows = await db
    .select({
      studentId: sql<
        string | null
      >`coalesce(${opsAppointments.studentId}, ${opsAdmissions.studentId})`,
      startsAt: opsAppointments.startsAt,
      type: opsAppointments.type,
      staffName: staffMembers.fullName,
    })
    .from(opsAppointments)
    .leftJoin(opsAdmissions, eq(opsAdmissions.id, opsAppointments.admissionId))
    .innerJoin(staffMembers, eq(staffMembers.id, opsAppointments.staffId))
    .where(
      and(
        upcoming(now),
        or(inArray(opsAppointments.studentId, unique), inArray(opsAdmissions.studentId, unique)),
      ),
    )
    .orderBy(asc(opsAppointments.startsAt));
  return groupBy(rows, (r) => r.studentId);
}

/** The latest status change of each case: when, and who recorded it (hold, exit). */
async function latestChanges(db: Database, admissionIds: readonly string[]) {
  if (!admissionIds.length) return new Map<string, { at: Date; byName: string | null }>();
  const rows = await db
    .select({
      admissionId: opsAdmissionTransitions.admissionId,
      at: opsAdmissionTransitions.at,
      byName: users.displayName,
    })
    .from(opsAdmissionTransitions)
    .leftJoin(users, eq(users.id, opsAdmissionTransitions.actorUserId))
    .where(inArray(opsAdmissionTransitions.admissionId, admissionIds as never[]))
    .orderBy(desc(opsAdmissionTransitions.at));
  const out = new Map<string, { at: Date; byName: string | null }>();
  for (const r of rows) if (!out.has(r.admissionId)) out.set(r.admissionId, r);
  return out;
}

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
