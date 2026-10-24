/**
 * Tests and Mock Tests in Business Ops (owner answer 1, 23 Oct 2026; brief §17–§21). ONE record
 * in Academic OS: Ops reads and writes it only through Academic's internal assessment routes
 * (caller `ops`, the acting person in a header) and keeps no copy. Ops' own data here is the
 * score-import staging (score-import.ts) and the files (assessments-files.ts). Academic is never
 * called inside a database transaction; a timed-out write is re-read before it is reported.
 */
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { z } from 'zod';
import { can, type Permission } from '@elevate/authorization';
import { opsAdmissions, opsLeads, opsScoreImports, type Database } from '@elevate/database';
import { fetchInternal, sendInternal, type InternalWriteResult } from '@elevate/server-kit';
import {
  academicAssessmentDetailV1Schema,
  academicAssessmentListV1Schema,
  AppError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  type updateAssessmentInternalBody,
  type withdrawPublicationBody,
  teachingAssignmentsV1Schema,
  type AcademicAssessmentDetailV1,
  type ErrorCode,
} from '@elevate/shared-contracts';
import { academicUrl } from './academic-summary';
import type {
  correctionBody,
  createTestBody,
  publishBody,
  TestListQuery,
} from './assessments-schemas';
import type { Actor } from './context';
import { fieldError } from './ops-common';

export type TestDetail = AcademicAssessmentDetailV1;
export type TestSummary = TestDetail['assessment'];
const BASE = '/academic/api/internal/v1/assessments';
export const PENDING_IMPORT = ['staged', 'in_review'] as const;

export function assertCan(actor: Actor, permission: Permission) {
  if (!can(actor, permission)) throw new ForbiddenError();
}

const read = <S extends z.ZodType>(path: string, schema: S) =>
  fetchInternal(academicUrl(`${BASE}${path}`), schema, { caller: 'ops', timeoutMs: 8000 });

const UNREACHABLE =
  'Academic OS could not be reached, so nothing was changed. Try again in a minute.';
/** Academic's refusal as the same kind of error here (its message is written for people). */
function refusal(r: Extract<InternalWriteResult<unknown>, { ok: false }>): AppError {
  if (r.status === 0 || r.status >= 500 || r.error.code === 'CONTRACT_MISMATCH')
    return new InternalError(UNREACHABLE);
  const code = (
    { 400: 'VALIDATION_FAILED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' } as const
  )[r.status as 400];
  // An incomplete final publication lists its issues (UNMARKED, UNVERIFIED, PRESENT_NO_MARKS).
  const issues = (r.error.details as { issues?: { count: number; message: string }[] } | undefined)
    ?.issues;
  const message = issues?.length
    ? `${r.error.message} ${issues.map((i) => `${i.message}: ${i.count}.`).join(' ')}`
    : r.error.message;
  return new AppError((code ?? 'CONFLICT') as ErrorCode, message, { details: r.error.details });
}

/**
 * One write to Academic. On a timeout (status 0) the detail is read again and `landed` decides
 * whether the write was saved after all; otherwise the refusal is thrown as is.
 */
export async function academicWrite(
  actor: Actor,
  path: string,
  body: unknown,
  options: { method?: 'POST' | 'PATCH'; id?: string; landed?: (d: TestDetail) => boolean } = {},
): Promise<TestDetail> {
  const r = await sendInternal(academicUrl(`${BASE}${path}`), academicAssessmentDetailV1Schema, {
    caller: 'ops',
    actingUserId: actor.id,
    body,
    method: options.method,
  });
  if (r.ok) return r.data;
  if (r.status === 0 && options.id && options.landed) {
    const again = await read(`/${options.id}`, academicAssessmentDetailV1Schema);
    if (again.status === 'available' && options.landed(again.data)) return again.data;
  }
  throw refusal(r);
}

/** The Academic record; throws when it cannot be read (writes and imports need it). */
export async function requireTest(actor: Actor, id: string): Promise<TestDetail> {
  assertCan(actor, 'ops:assessments:read');
  const r = await read(`/${id}`, academicAssessmentDetailV1Schema);
  if (r.status === 'available') return r.data;
  if (r.reason === 'HTTP 404') throw new NotFoundError('Test not found.');
  throw new InternalError(`Academic OS could not be read (${r.reason}). Try again in a minute.`);
}

/** The Academic record for a page: `unavailable` is shown as "Source unavailable", never zeros. */
export function testDetail(actor: Actor, id: string) {
  assertCan(actor, 'ops:assessments:read');
  return read(`/${id}`, academicAssessmentDetailV1Schema);
}

const matches = (a: TestSummary, q: TestListQuery) =>
  (!q.courseId || a.courseId === q.courseId) &&
  (!q.batchId || a.batches.some((b) => b.batchId === q.batchId)) &&
  (!q.teacherStaffId ||
    [a.responsibleTeacher?.staffId, a.evaluator?.staffId].includes(q.teacherStaffId)) &&
  (!q.from || (a.scheduledDate !== null && a.scheduledDate >= q.from)) &&
  (!q.to || (a.scheduledDate !== null && a.scheduledDate <= q.to));

/**
 * Imports staged and waiting for review, with their test, under the list filters.
 * shortcut: newest 200 pending imports, one Academic read per test; page this if a centre ever
 * has that many imports waiting.
 */
async function pendingImports(db: Database, q: TestListQuery) {
  const rows = await db
    .select()
    .from(opsScoreImports)
    .where(inArray(opsScoreImports.status, [...PENDING_IMPORT]))
    .orderBy(desc(opsScoreImports.createdAt))
    .limit(200);
  const ids = [...new Set(rows.map((r) => r.assessmentId))];
  const tests = new Map(
    (await Promise.all(ids.map((id) => read(`/${id}`, academicAssessmentDetailV1Schema)))).flatMap(
      (r) => (r.status === 'available' ? [[r.data.assessment.id, r.data.assessment] as const] : []),
    ),
  );
  return rows.flatMap((r) => {
    const test = tests.get(r.assessmentId);
    // A test Academic cannot show is listed unfiltered: hiding it would lose the import.
    return !test || matches(test, q) ? [{ ...r, test: test ?? null }] : [];
  });
}
export type PendingImport = Awaited<ReturnType<typeof pendingImports>>[number];

/** One view of the list with every view's count under the same filters (stored records only). */
export async function listTests(db: Database, actor: Actor, q: TestListQuery) {
  assertCan(actor, 'ops:assessments:read');
  const params = new URLSearchParams(
    Object.entries({ ...q, view: q.view === 'imports' ? 'upcoming' : q.view }).flatMap(([k, v]) =>
      v === undefined ? [] : [[k, String(v)]],
    ),
  );
  if (q.view === 'imports') params.set('pageSize', '1');
  const [list, imports] = await Promise.all([
    read(`?${params}`, academicAssessmentListV1Schema),
    pendingImports(db, q),
  ]);
  return { list, imports, counts: { imports: imports.length } };
}

/** Batches and teachers for the form and filters, from Academic's active teaching assignments. */
export async function testOptions() {
  // shortcut: first 100 active assignments; enough for one centre, page it when that grows.
  const r = await fetchInternal(
    academicUrl('/academic/api/internal/v1/teaching-assignments?status=active&pageSize=100'),
    teachingAssignmentsV1Schema,
    { caller: 'ops', timeoutMs: 5000 },
  );
  if (r.status !== 'available') return null;
  const batches = new Map<string, string>();
  const teachers = new Map<string, string>();
  for (const a of r.data.items) {
    if (a.batchId && a.batchCode)
      batches.set(a.batchId, `${a.batchCode}${a.courseName ? ` · ${a.courseName}` : ''}`);
    teachers.set(a.staffId, a.teacherName);
  }
  const sorted = (m: Map<string, string>) =>
    [...m]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  return { batches: sorted(batches), teachers: sorted(teachers) };
}

/**
 * Admission numbers by core student id of the students Ops placed in these batches (Academic
 * holds none). A student whose Academic batch differs from Ops' enrolled batch gets no number on
 * the roster; matching then uses the student code or name.
 */
async function admissionNumbers(db: Database, batchIds: readonly string[]) {
  const rows = await db
    .select({
      coreStudentId: opsAdmissions.studentId,
      admissionNumber: opsAdmissions.admissionNumber,
    })
    .from(opsAdmissions)
    .where(
      and(
        inArray(opsAdmissions.enrolledBatchId, batchIds as never),
        isNotNull(opsAdmissions.studentId),
        isNotNull(opsAdmissions.admissionNumber),
      ),
    );
  return [...new Map(rows.map((r) => [r.coreStudentId!, r.admissionNumber!])).entries()].map(
    ([coreStudentId, admissionNumber]) => ({ coreStudentId, admissionNumber }),
  );
}

/** Fix the test population from its eligible batches (once; Academic refuses a second time). */
export async function snapshotRoster(db: Database, actor: Actor, id: string, batchIds?: string[]) {
  assertCan(actor, 'ops:assessments:manage');
  const batches =
    batchIds ?? (await requireTest(actor, id)).assessment.batches.map((b) => b.batchId);
  const body = { admissionNumbers: await admissionNumbers(db, batches) };
  return academicWrite(actor, `/${id}/roster`, body, {
    id,
    landed: (d) => d.assessment.rosterSnapshotAt !== null,
  });
}

/** Create (draft, or scheduled with a date) and, when scheduled, snapshot its roster. */
export async function createTest(
  db: Database,
  actor: Actor,
  body: z.output<typeof createTestBody>,
) {
  assertCan(actor, 'ops:assessments:manage');
  const created = await academicWrite(actor, '', body);
  const id = created.assessment.id;
  if (created.assessment.status !== 'scheduled') return { id, rosterTaken: false };
  // The test exists either way; a failed snapshot is offered again on the test page.
  const batches = created.assessment.batches.map((b) => b.batchId);
  const taken = await snapshotRoster(db, actor, id, batches).then(
    () => true,
    () => false,
  );
  return { id, rosterTaken: taken };
}

/** Add (Ops fills the batch and admission number from its admission), remove or restore. */
export async function correctRoster(
  db: Database,
  actor: Actor,
  id: string,
  body: z.output<typeof correctionBody>,
) {
  assertCan(actor, 'ops:assessments:manage');
  if (body.action !== 'add') return academicWrite(actor, `/${id}/roster/corrections`, body);
  const batches = (await requireTest(actor, id)).assessment.batches.map((b) => b.batchId);
  const [a] = await db
    .select({ batchId: opsAdmissions.enrolledBatchId, number: opsAdmissions.admissionNumber })
    .from(opsAdmissions)
    .where(
      and(
        eq(opsAdmissions.academicStudentId, body.studentId as never),
        inArray(opsAdmissions.enrolledBatchId, batches as never),
      ),
    )
    .limit(1);
  if (!a?.batchId)
    throw fieldError('studentId', 'This student is not placed in this test’s batches.');
  return academicWrite(actor, `/${id}/roster/corrections`, {
    ...body,
    batchId: a.batchId,
    ...(a.number ? { admissionNumber: a.number } : {}),
  });
}

/** Change, schedule or cancel (with a reason) a test in Academic. */
export function updateTest(
  actor: Actor,
  id: string,
  body: z.output<typeof updateAssessmentInternalBody>,
) {
  assertCan(actor, 'ops:assessments:manage');
  return academicWrite(actor, `/${id}`, body, { method: 'PATCH' });
}

/** Students Ops placed in the test's batches who are not on its roster yet (for "add"). */
export async function addableStudents(db: Database, d: TestDetail) {
  const on = new Set<string>(d.roster.map((r) => r.studentId));
  const rows = await db
    .select({
      studentId: opsAdmissions.academicStudentId,
      number: opsAdmissions.admissionNumber,
      batchId: opsAdmissions.enrolledBatchId,
      name: opsLeads.studentName,
    })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .where(
      and(
        inArray(opsAdmissions.enrolledBatchId, d.assessment.batches.map((b) => b.batchId) as never),
        isNotNull(opsAdmissions.academicStudentId),
      ),
    );
  const code = new Map<string, string>(d.assessment.batches.map((b) => [b.batchId, b.code]));
  return rows
    .filter((r) => !on.has(r.studentId!))
    .map((r) => ({
      value: r.studentId!,
      label: `${r.name} (${r.number ?? 'no admission no.'}, ${code.get(r.batchId!) ?? ''})`,
    }));
}

/** Roster counts that stop a final publication, shown before publishing (Academic decides). */
export function completenessIssues(d: TestDetail): string[] {
  const c = d.assessment.rosterCounts;
  if (!c) return ['The roster has not been taken yet.'];
  const presentNotEntered = d.roster.filter(
    (r) => !r.removedAt && r.attendance === 'present' && r.marksState === 'not_entered',
  ).length;
  return [
    c.unmarked && `${c.unmarked} student${c.unmarked === 1 ? ' has' : 's have'} no attendance.`,
    c.imported && `${c.imported} imported mark${c.imported === 1 ? ' is' : 's are'} not verified.`,
    presentNotEntered &&
      `${presentNotEntered} present student${presentNotEntered === 1 ? ' has' : 's have'} no marks.`,
  ].filter((x): x is string => typeof x === 'string');
}

/** Finalise when needed, then publish the next version (final, or provisional when allowed). */
export async function publishTest(actor: Actor, id: string, body: z.output<typeof publishBody>) {
  assertCan(actor, 'ops:assessments:publish');
  let d = await requireTest(actor, id);
  if (!d.results)
    d = await academicWrite(actor, `/${id}/finalise`, {}, { id, landed: (x) => !!x.results });
  const version = Math.max(0, ...d.publication.history.map((p) => p.version)) + 1;
  const cohort = body.cohort?.length ? body.cohort : undefined;
  return academicWrite(
    actor,
    `/${id}/publications`,
    {
      version,
      rankingScope: cohort ? 'cohort' : 'roster',
      ...(cohort ? { cohortBatchIds: cohort } : {}),
      provisional: body.provisional,
      ...(body.note ? { note: body.note } : {}),
    },
    { id, landed: (x) => x.publication.history.some((p) => p.version === version) },
  );
}

export function withdrawPublication(
  actor: Actor,
  id: string,
  version: number,
  body: z.output<typeof withdrawPublicationBody>,
) {
  assertCan(actor, 'ops:assessments:publish');
  return academicWrite(actor, `/${id}/publications/${version}/withdraw`, body);
}
