/**
 * Per-student evidence from Academic OS (IR-OPS-STU-1, contract `academic.student_summary` v1).
 * fetchInternal returns `unavailable` instead of throwing: screens and reports then say
 * "Source unavailable (checked <time>)", never zeros.
 */
import { inArray } from 'drizzle-orm';
import { staffMembers, type Database } from '@elevate/database';
import { fetchInternal } from '@elevate/server-kit';
import { academicStudentSummaryV1Schema } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { attendanceFacts, resultFacts, scoreTrends } from '../domain/student-report';

export { academicStudentSummaryV1Schema as academicStudentSummarySchema };

export function fetchAcademicStudentSummary(
  academicStudentId: string,
  window?: { from: string; to: string },
) {
  const origin = (
    process.env.ACADEMIC_OS_URL ??
    process.env.PLATFORM_URL ??
    'http://localhost:3000'
  ).replace(/\/+$/, '');
  const query = window ? `?${new URLSearchParams(window)}` : '';
  return fetchInternal(
    `${origin}/academic/api/internal/v1/students/${encodeURIComponent(academicStudentId)}/summary${query}`,
    academicStudentSummaryV1Schema,
    { caller: 'ops', timeoutMs: 3000 },
  );
}

/** Names of the staff ids Academic reports (core.staff_members; unknown ids stay unnamed). */
export async function staffNames(db: Database, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  const rows = unique.length
    ? await db
        .select({ id: staffMembers.id, name: staffMembers.fullName })
        .from(staffMembers)
        .where(inArray(staffMembers.id, unique as StaffMemberId[]))
    : [];
  return new Map(rows.map((r) => [r.id as string, r.name]));
}

/**
 * The Academic evidence shown on the profile and frozen into report snapshots (plain JSON):
 * not enrolled, source unavailable (with the time checked), or attendance facts, results with
 * percent + same-assessment cohort comparison, trends, and teachers named per subject.
 */
export async function academicEvidence(
  db: Database,
  academicStudentId: string | null,
  window?: { from: string; to: string },
) {
  if (!academicStudentId) return { status: 'not_enrolled' as const };
  const r = await fetchAcademicStudentSummary(academicStudentId, window);
  if (r.status === 'unavailable')
    return { status: 'unavailable' as const, reason: r.reason, checkedAt: r.fetchedAt };
  const d = r.data;
  const names = await staffNames(
    db,
    d.enrolments.flatMap((e) => e.teachers.map((t) => t.staffId)),
  );
  return {
    status: 'available' as const,
    checkedAt: r.fetchedAt,
    window: d.window,
    attendance: attendanceFacts(d.attendance),
    results: d.results.map(resultFacts),
    trends: scoreTrends(d.results),
    enrolments: d.enrolments.map((e) => ({
      enrolmentId: e.enrolmentId,
      programmeCode: e.programmeCode,
      batchName: e.batchName,
      status: e.status,
      teachers: e.teachers.map((t) => ({
        name: names.get(t.staffId) ?? 'Name not on record',
        subject: t.subject,
      })),
    })),
  };
}
export type AcademicEvidence = Awaited<ReturnType<typeof academicEvidence>>;
