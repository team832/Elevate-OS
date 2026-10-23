/**
 * Student list SQL (split from ./students): which cases count as active or past, own scope,
 * case-level filters, the one-row-per-student view filter and the audited contact search.
 */
import {
  and,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  like,
  ne,
  notExists,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  opsAdmissions,
  opsGuardians,
  opsLeads,
  programmes,
  type Database,
} from '@elevate/database';
import { ValidationError } from '@elevate/shared-contracts';
import { EXIT_STATUSES, normaliseEmail, normalisePhone, PHONE_ERROR_MESSAGES } from '../domain';
import { maskEmail } from '../domain/kyc';
import {
  ACTIVE_CASE_STATUSES,
  maskPhone,
  PAST_OUTCOME_STATUSES,
  type PastOutcome,
} from '../domain/student-lifecycle';
import type { AccessScope } from './context';
import type { StudentSearchQuery } from './students-schemas';

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
