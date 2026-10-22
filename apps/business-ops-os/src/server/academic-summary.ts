/**
 * Reads from Academic OS internal routes (caller `ops`): per-student evidence (IR-OPS-STU-1),
 * submitted teacher reviews (R4), teachers' marks of linked demo classes (R5) and teacher
 * activity. Business Ops never writes Academic data. fetchInternal returns `unavailable` instead of throwing: screens and reports then say
 * "Source unavailable (checked <time>)", never zeros.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  opsDemoSessions,
  staffMembers,
  type Database,
  type OpsDemoSessionId,
} from '@elevate/database';
import { fetchInternal } from '@elevate/server-kit';
import {
  academicDemoAttendanceV1Schema,
  academicStudentReviewsV1Schema,
  academicStudentSummaryV1Schema,
  academicTeacherActivityV1Schema,
  InvalidStateTransitionError,
} from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { markedAttendance, type AcademicMark } from '../domain/feedback';
import { attendanceFacts, resultFacts, scoreTrends } from '../domain/student-report';

export { academicStudentSummaryV1Schema as academicStudentSummarySchema };

/** Absolute URL of an Academic OS path (`/academic/...`) for server-to-server calls. */
export const academicUrl = (path: string) =>
  `${(process.env.ACADEMIC_OS_URL ?? process.env.PLATFORM_URL ?? 'http://localhost:3000').replace(/\/+$/, '')}${path}`;

const fetchAcademic = <S extends Parameters<typeof fetchInternal>[1]>(path: string, schema: S) =>
  fetchInternal(academicUrl(path), schema, { caller: 'ops', timeoutMs: 3000 });

export const fetchAcademicStudentSummary = (
  academicStudentId: string,
  window?: { from: string; to: string },
) =>
  fetchAcademic(
    `/academic/api/internal/v1/students/${encodeURIComponent(academicStudentId)}/summary${window ? `?${new URLSearchParams(window)}` : ''}`,
    academicStudentSummaryV1Schema,
  );

/** Submitted teacher reviews (A3, R4): never drafts; withdrawn/superseded carry markers. */
export const fetchAcademicReviews = (
  query: { coreStudentId: string } | { authorStaffId: string },
) =>
  fetchAcademic(
    `/academic/api/internal/v1/reviews?${new URLSearchParams(query)}`,
    academicStudentReviewsV1Schema,
  );

/** Teachers' marks for demo classes linked to Academic sessions (A2, R5). */
export const fetchAcademicDemoAttendance = (opsDemoSessionIds: readonly string[]) =>
  fetchAcademic(
    `/academic/api/internal/v1/demo-attendance?${new URLSearchParams({ ids: opsDemoSessionIds.join(',') })}`,
    academicDemoAttendanceV1Schema,
  );

const CHUNK = 200; // ids per Academic call (URL length)

/**
 * Academic marks per Ops demo class id, asked in batches of 200. `unavailable` (no marks at all)
 * when any batch fails. R15 (amended): Ops records what it learns — a class Academic returns a
 * mark for gets `academic_session_ref`, and is treated as linked from then on (also while Academic
 * cannot be read). Gap: a class linked in Academic but not yet seen by Ops counts as unlinked.
 */
export async function academicDemoMarks(db: Database, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  const batches = await Promise.all(
    Array.from({ length: Math.ceil(unique.length / CHUNK) }, (_, i) =>
      fetchAcademicDemoAttendance(unique.slice(i * CHUNK, (i + 1) * CHUNK)),
    ),
  );
  const down = batches.find((r) => r.status === 'unavailable');
  if (down)
    return {
      status: 'unavailable' as const,
      reason: down.reason,
      checkedAt: down.fetchedAt,
      marks: new Map<string, AcademicMark>(),
    };
  for (const r of batches)
    for (const i of r.status === 'available' ? r.data.items : [])
      await db
        .update(opsDemoSessions)
        .set({ academicSessionRef: i.academicSessionId })
        .where(
          and(
            eq(opsDemoSessions.id, i.opsDemoSessionId as OpsDemoSessionId),
            sql`${opsDemoSessions.academicSessionRef} IS DISTINCT FROM ${i.academicSessionId}`,
          ),
        );
  return {
    status: 'available' as const,
    checkedAt: batches[0]?.fetchedAt ?? new Date().toISOString(),
    marks: new Map<string, AcademicMark>(
      batches.flatMap((r) =>
        r.status === 'available' ? r.data.items.map((i) => [i.opsDemoSessionId, i] as const) : [],
      ),
    ),
  };
}
export type AcademicDemoMarks = Awaited<ReturnType<typeof academicDemoMarks>>;

/**
 * Ops demo classes with Academic's mark and actual teachers where the class is linked (R15: for
 * a linked class Academic's mark is the attendance fact). Every demo read goes through this.
 */
export const withMarks = <S extends { id: string; attendance: string }>(
  sessions: readonly S[],
  marks: AcademicDemoMarks,
) =>
  sessions.map((s) => {
    const academic = marks.marks.get(s.id) ?? null;
    // Academic's statuses are a subset of the Ops attendance vocabulary.
    const attendance = markedAttendance(s.attendance, academic) as S['attendance'];
    return { ...s, attendance, academic };
  });

/**
 * Owner answer 3 and R15 (amended): a demo class linked to an Academic class is marked by its
 * teacher there. A class Ops knows is linked (`academic_session_ref`) waits while Academic cannot
 * be read; a class with no ref stays counsellor-marked.
 */
export function assertCounsellorMayMark(
  marks: AcademicDemoMarks,
  session: { id: string; academicSessionRef: string | null },
) {
  if (marks.status === 'unavailable' && session.academicSessionRef)
    throw new InvalidStateTransitionError(
      `Waiting for Academic OS: it could not be reached (${marks.reason}), so it is not known whether this class is recorded there. Try again later.`,
    );
  if (marks.marks.has(session.id))
    throw new InvalidStateTransitionError(
      'This class is linked to an Academic OS class, so its teacher records attendance there.',
    );
}

/** One teacher's assignments, sessions and pending work in an IST date window (A2). */
export const fetchTeacherActivity = (staffId: string, window: { from: string; to: string }) =>
  fetchAcademic(
    `/academic/api/internal/v1/teachers/${encodeURIComponent(staffId)}/activity?${new URLSearchParams(window)}`,
    academicTeacherActivityV1Schema,
  );

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
