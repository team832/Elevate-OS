/**
 * Annual tuition for one academic year (owner brief 23 Oct 2026 §22–23): per-student rows and
 * their totals for the /ops/fees chart and its drill-down, under the same filters (academic year
 * = fee_plans.academic_year, course = a programme of the agreement's bundle). Rules: A-FEE-9
 * (domain/fee-year.ts). `ops:fees:read`; own scope = cases the reader counsels or whose lead they
 * own, as on every fee list. Read only.
 * shortcut: computes every agreement in scope per request, like outstandingInstalments; fine for
 * hundreds of students, move the sums to SQL beyond that.
 */
import { eq, inArray } from 'drizzle-orm';
import {
  opsAdmissions,
  opsFeePlans,
  opsLeads,
  programmes,
  students,
  type Database,
} from '@elevate/database';
import { istToday } from '../domain';
import { acceptedVersions, feeYearRow, feeYearTotals } from '../domain/fee-year';
import { ownAdmissionFilter } from './admissions';
import { accessScope, type Actor } from './context';
import { plansWithLedger, type FeePlanRow } from './fee-agreements';
import { inOrder } from './ops-common';

export async function feeYear(
  db: Database,
  actor: Actor,
  q: { year?: string; course?: string },
  now = new Date(),
) {
  const access = await accessScope(db, actor, 'ops:fees:read');
  const visible = await db
    .select({ id: opsFeePlans.id, studentId: opsFeePlans.studentId })
    .from(opsFeePlans)
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeePlans.admissionId))
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .where(ownAdmissionFilter(access));
  // Every version of these students, as studentFeePlans reads them: a chain may continue on
  // another admission, so the scope applies to the version that counts, not to the history.
  const family = visible.length
    ? await db
        .select()
        .from(opsFeePlans)
        .where(inArray(opsFeePlans.studentId, [...new Set(visible.map((v) => v.studentId))]))
    : [];
  const seen = new Set(visible.map((v) => v.id as string));
  const v = acceptedVersions(family);
  const [counted, changing, drafts] = [v.counted, v.changing, v.drafts].map((list) =>
    list.filter((p) => seen.has(p.id)),
  ) as [FeePlanRow[], FeePlanRow[], FeePlanRow[]];
  const latest = (list: FeePlanRow[]) =>
    [...new Set(list.flatMap((p) => p.academicYear ?? []))].sort().reverse();
  const years = latest(counted);
  const year = q.year || years[0] || latest(drafts)[0] || null;
  const inYear = (list: FeePlanRow[]) => list.filter((p) => p.academicYear === year);
  const sids = [...new Set([...inYear(counted), ...inYear(drafts)].map((p) => p.studentId))];
  const [people, cases] = sids.length
    ? await inOrder([
        db
          .select({ id: students.id, fullName: students.fullName, isSample: students.isSample })
          .from(students)
          .where(inArray(students.id, sids)),
        db
          .select({
            id: opsAdmissions.id,
            applicationId: opsAdmissions.applicationId,
            admissionNumber: opsAdmissions.admissionNumber,
            enrolledBatchId: opsAdmissions.enrolledBatchId,
            intendedBatchId: opsAdmissions.intendedBatchId,
            code: programmes.code,
            name: programmes.name,
          })
          .from(opsAdmissions)
          .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
          .where(inArray(opsAdmissions.studentId, sids)),
      ])
    : [[], []];
  /** The agreement's own case first, then the other cases of its application (the bundle). */
  const bundle = (p: FeePlanRow) => {
    const own = cases.filter((c) => c.id === p.admissionId);
    const appId = own[0]?.applicationId;
    return [
      ...own,
      ...cases.filter((c) => appId && c.applicationId === appId && c.id !== p.admissionId),
    ];
  };
  const courses = new Map(
    inYear(counted)
      .flatMap(bundle)
      .flatMap((c) => (c.code ? [[c.code, c.name!]] : [])),
  );
  // An agreement covering two courses counts in full under each course.
  const filtered = (list: FeePlanRow[]) =>
    inYear(list).filter((p) => !q.course || bundle(p).some((c) => c.code === q.course));
  const shown = filtered(counted);
  const person = new Map(people.map((s) => [s.id as string, s]));
  const today = istToday(now);
  const rows = (await plansWithLedger(db, shown, now)).map((d) => {
    const b = bundle(d.plan);
    const s = person.get(d.plan.studentId);
    return {
      planId: d.plan.id as string,
      studentId: d.plan.studentId as string,
      studentName: s?.fullName ?? null,
      isSample: s?.isSample ?? false,
      admissionNumber: b.find((c) => c.admissionNumber)?.admissionNumber ?? null,
      courses: b.map((c) => ({
        name: c.name,
        enrolledBatchId: c.enrolledBatchId as string | null,
        intendedBatchId: c.intendedBatchId as string | null,
      })),
      closed: d.plan.status === 'closed',
      reconciled: d.reconciliation.reconciled,
      ...feeYearRow(d, today),
    };
  });
  return {
    year,
    years,
    course: q.course || null,
    courses: [...courses].map(([value, label]) => ({ value, label })),
    rows,
    totals: feeYearTotals(rows),
    /** Agreements never approved yet (not billed), so nothing leaves the view silently. */
    draftsNotCounted: filtered(drafts).length,
    /** Counted at their last approved version while a change waits for approval. */
    changesPending: filtered(changing).length,
    /** Accepted agreements without an academic year (made before D-039): in no year's figures. */
    withoutYear: counted.filter((p) => !p.academicYear).length,
    /** Own scope: students whose counted version lives on a case the reader cannot see (count only, any course). */
    continuedElsewhere: new Set(
      inYear(v.counted.filter((p) => !seen.has(p.id))).map((p) => p.studentId),
    ).size,
  };
}
export type FeeYear = Awaited<ReturnType<typeof feeYear>>;
export type FeeYearStudent = FeeYear['rows'][number];

type Owing = FeeYearStudent;
/** Drill-down orders (`?sort=`); ties by name. */
export const OWING_SORTS = {
  overdue: (a: Owing, b: Owing) =>
    b.overduePaise - a.overduePaise ||
    b.dueNowPaise - a.dueNowPaise ||
    b.outstandingPaise - a.outstandingPaise,
  outstanding: (a: Owing, b: Owing) => b.outstandingPaise - a.outstandingPaise,
  name: () => 0,
};
export type OwingSort = keyof typeof OWING_SORTS;

/** The drill-down: students with tuition still owed (default order: overdue first). */
export const owingStudents = (rows: readonly Owing[], sort: OwingSort = 'overdue') =>
  rows
    .filter((r) => r.outstandingPaise > 0)
    .sort(
      (a, b) => OWING_SORTS[sort](a, b) || (a.studentName ?? '').localeCompare(b.studentName ?? ''),
    );
