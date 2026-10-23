/**
 * Feedback file imports (brief 23 Oct 2026 §15; ops:teacher_feedback:import, all scope).
 * Upload = preview: the file's rows are stored with their outcome (valid / invalid / unresolved /
 * duplicate) and messages; nothing reaches the feedback table yet. The same file (sha256) is
 * refused while an earlier upload of it is live or committed. Commit re-checks every row (Academic
 * OS is read before the transaction), then writes only the valid ones in one transaction;
 * committing again changes nothing. The original file is kept as an attachment (feedback_import).
 */
import { createHash } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm';
import {
  opsStudentTeacherFeedback as feedback,
  opsTeacherFeedbackImportRows as importRows,
  opsTeacherFeedbackImports as imports,
  isUniqueViolation,
  users,
  type Database,
  type OpsTeacherFeedbackImportId,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
} from '@elevate/shared-contracts';
import type { IsoDate, StaffMemberId, StudentIdentityId } from '@elevate/shared-types';
import {
  ABOUT_KEY,
  aboutOf,
  checkRow,
  countOutcomes,
  feedbackKey,
  mappingProblems,
  markDuplicates,
  readFeedbackCsv,
  suggestMapping,
  type CheckedRow,
  type Mapping,
} from '../domain/feedback-import';
import { uploadAttachment } from './attachments';
import { staffIdForUser, type Actor } from './context';
import { feedbackScope, isAbout, redactFor, rowsAbout } from './feedback-access';
import {
  feedbackPolicy,
  matchBatch,
  studentsByAdmissionNumber,
  teacherBatches,
  teacherResolver,
} from './feedback-refs';
import { fieldError, inOrder, opsAudit, rowById } from './ops-common';

const audit = opsAudit('teacher_feedback_import');

async function requireImporter(db: Database, actor: Actor) {
  if ((await feedbackScope(db, actor, 'ops:teacher_feedback:import')).scope !== 'all')
    throw new ForbiddenError('Feedback imports need HR import access.');
}

/** M2: nobody a row may be about previews, remaps, commits or discards the import. */
async function refuseSubject(db: Database, actor: Actor, about: readonly string[][]) {
  if (isAbout(await staffIdForUser(db, actor.id), about))
    throw new ForbiddenError('Another HR person must handle this import.');
}
const aboutRows = (rows: readonly CheckedRow[]) => rows.map((r) => aboutOf(r.raw));

/** Every row's outcome against the database and Academic OS now (no transaction: network). */
async function checkRows(
  db: Database,
  records: readonly Record<string, string>[],
  mapping: Mapping,
) {
  const policy = await feedbackPolicy(db);
  const problems = mappingProblems(
    mapping,
    policy.categories.map((c) => c.code),
  );
  if (problems.length) throw fieldError('mapping', problems.join(' '));
  const columnOf = (field: string) => Object.keys(mapping).find((c) => mapping[c] === field);
  const cells = (field: string) => {
    const col = columnOf(field);
    return col ? records.map((r) => r[col] ?? '') : [];
  };
  const { resolve: teacher, candidates, mentions } = await teacherResolver(db);
  const teacherIds = cells('teacher')
    .map(teacher)
    .filter((t): t is string => !!t && t !== 'ambiguous');
  const [studentIds, batches] = await Promise.all([
    studentsByAdmissionNumber(db, cells('admission_number')),
    teacherBatches(teacherIds),
  ]);
  const teacherColumn = columnOf('teacher');
  const checked = records.map((cells, i) => {
    // Who the row may be about, stored so redaction never re-matches names later (M2): the Teacher
    // cell's candidates and anyone named in any cell (L1/L2), merged with what was stored before,
    // never replaced, so a remap, rename or moved staff code cannot shrink it.
    const ref = teacherColumn ? (cells[teacherColumn] ?? '').trim() : '';
    const about = new Set([
      ...aboutOf(cells),
      ...(ref ? candidates(ref) : []),
      ...Object.values(cells).flatMap((v) => (typeof v === 'string' ? mentions(v) : [])),
    ]);
    const raw = { ...cells, [ABOUT_KEY]: [...about] };
    return checkRow(i + 1, raw, mapping, {
      scaleMax: policy.scaleMax,
      categoryCodes: policy.categories.map((c) => c.code),
      teacher,
      student: (n) => studentIds.get(n) ?? null,
      batch: (t, code, subject) => matchBatch(batches.get(t), code, subject),
    });
  });
  const existing = teacherIds.length
    ? await db
        .select()
        .from(feedback)
        .where(inArray(feedback.teacherStaffId, [...new Set(teacherIds)] as StaffMemberId[]))
    : [];
  return markDuplicates(checked, new Set(existing.map(feedbackKey)));
}

const rowValues = (importId: OpsTeacherFeedbackImportId, rows: readonly CheckedRow[]) =>
  rows.map((r) => ({
    importId,
    rowNumber: r.rowNumber,
    raw: r.raw,
    outcome: r.outcome,
    messages: r.messages,
  }));

export async function previewImport(
  db: Database,
  actor: Actor,
  body: { name: string; content: string; mapping?: Mapping },
  requestId?: string,
) {
  await requireImporter(db, actor);
  const file = readFeedbackCsv(body.content);
  if (!file.ok) throw fieldError('content', file.error);
  const sha256 = createHash('sha256').update(body.content, 'utf8').digest('hex');
  const alreadyUploaded = () =>
    new ConflictError(
      'This file was already uploaded. Discard that preview first to upload it again.',
    );
  const [earlier] = await db
    .select({ id: imports.id })
    .from(imports)
    .where(and(eq(imports.sha256, sha256), ne(imports.status, 'discarded')));
  if (earlier) throw alreadyUploaded();
  const policy = await feedbackPolicy(db);
  const mapping = body.mapping ?? suggestMapping(file.header, policy.categories);
  const rows = await checkRows(db, file.rows, mapping);
  await refuseSubject(db, actor, aboutRows(rows));
  const created = await withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(imports)
      .values({
        sha256,
        originalName: body.name,
        mapping,
        createdBy: actor.id,
        ...countOutcomes(rows),
      })
      .returning();
    await tx.insert(importRows).values(rowValues(row!.id, rows));
    await audit(tx, actor, row!.id, 'feedback_import.previewed', { after: row }, requestId);
    return row!;
  }).catch((e: unknown) => {
    // The same file sent twice at once: the unique sha256 index decides (M6).
    throw isUniqueViolation(e) ? alreadyUploaded() : e;
  });
  // The source copy is kept apart from the rows; storage not set up does not lose the preview.
  const sourceFile = await uploadAttachment(db, actor, {
    ownerKind: 'feedback_import',
    ownerId: created.id,
    purpose: 'import_source',
    name: body.name,
    mime: 'text/csv',
    dataBase64: Buffer.from(body.content, 'utf8').toString('base64'),
  }).then(
    (a) => ({ stored: true as const, id: a.id }),
    (e: Error) => ({ stored: false as const, reason: e.message }),
  );
  return { ...created, sourceFile };
}

/** The stored file rows, in file order (their raw cells). */
const storedRows = (db: Database, id: string) =>
  db
    .select()
    .from(importRows)
    .where(eq(importRows.importId, id as OpsTeacherFeedbackImportId))
    .orderBy(asc(importRows.rowNumber));

/** Re-run the preview with another column mapping (preview only). */
export async function remapImport(
  db: Database,
  actor: Actor,
  id: string,
  mapping: Mapping,
  requestId?: string,
) {
  await requireImporter(db, actor);
  const before = await rowById(db, imports, id, 'Import');
  if (before.status !== 'preview')
    throw new InvalidStateTransitionError('Only a preview can be mapped again.');
  const rows = await checkRows(
    db,
    (await storedRows(db, id)).map((r) => r.raw as Record<string, string>),
    mapping,
  );
  await refuseSubject(db, actor, aboutRows(rows));
  return withTransaction(db, async (tx) => {
    const locked = await rowById(tx, imports, id, 'Import', true);
    if (locked.status !== 'preview')
      throw new InvalidStateTransitionError('Only a preview can be mapped again.');
    await tx.delete(importRows).where(eq(importRows.importId, locked.id));
    await tx.insert(importRows).values(rowValues(locked.id, rows));
    const [after] = await tx
      .update(imports)
      .set({ mapping, ...countOutcomes(rows) })
      .where(eq(imports.id, locked.id))
      .returning();
    await audit(tx, actor, id, 'feedback_import.remapped', { before, after }, requestId);
    return after!;
  });
}

/**
 * Write the valid rows (outcomes re-checked now) as pending feedback, or approved when `approve`.
 * A committed import is returned unchanged (idempotent).
 * shortcut: duplicates against rows committed by another import between the re-check and this
 * transaction are not caught; the import lock serialises commits of the same file only.
 */
export async function commitImport(
  db: Database,
  actor: Actor,
  id: string,
  options: { approve?: boolean; anonymous?: boolean },
  requestId?: string,
) {
  await requireImporter(db, actor);
  const before = await rowById(db, imports, id, 'Import');
  if (before.status === 'committed') return before;
  if (before.status === 'discarded')
    throw new InvalidStateTransitionError('This preview was discarded; upload the file again.');
  const stored = await storedRows(db, id);
  const rows = await checkRows(
    db,
    stored.map((r) => r.raw as Record<string, string>),
    before.mapping,
  );
  await refuseSubject(db, actor, aboutRows(rows));
  const { scaleMax } = await feedbackPolicy(db);
  return withTransaction(db, async (tx) => {
    const locked = await rowById(tx, imports, id, 'Import', true);
    if (locked.status === 'committed') return locked;
    if (locked.status !== 'preview')
      throw new InvalidStateTransitionError('This preview was discarded; upload the file again.');
    const now = new Date();
    await inOrder(
      rows.map((r) => async () => {
        const created = r.values
          ? (
              await tx
                .insert(feedback)
                .values({
                  ...r.values,
                  teacherStaffId: r.values.teacherStaffId as StaffMemberId,
                  studentId: r.values.studentId as StudentIdentityId | null,
                  periodStart: r.values.periodStart as IsoDate | null,
                  periodEnd: r.values.periodEnd as IsoDate | null,
                  feedbackOn: r.values.feedbackOn as IsoDate,
                  // Anonymous only when the collection was declared anonymous (I5).
                  isAnonymous: Boolean(options.anonymous) && !r.values.studentId,
                  ratingScaleMax: scaleMax,
                  collectionMethod: 'import',
                  importId: locked.id,
                  importRow: r.rowNumber,
                  recordedBy: actor.id,
                  reviewedAt: now,
                  reviewedByUserId: actor.id,
                  // Never self-approval (I4): refuseSubject keeps the teacher from committing.
                  ...(options.approve
                    ? {
                        moderationStatus: 'approved' as const,
                        moderatedBy: actor.id,
                        moderatedAt: now,
                      }
                    : {}),
                })
                .returning({ id: feedback.id })
            )[0]
          : null;
        await tx
          .update(importRows)
          .set({
            raw: r.raw,
            outcome: r.outcome,
            messages: r.messages,
            feedbackId: created?.id ?? null,
          })
          .where(and(eq(importRows.importId, locked.id), eq(importRows.rowNumber, r.rowNumber)));
      }),
    );
    const [after] = await tx
      .update(imports)
      .set({ status: 'committed', committedAt: now, ...countOutcomes(rows) })
      .where(eq(imports.id, locked.id))
      .returning();
    await audit(
      tx,
      actor,
      id,
      'feedback_import.committed',
      {
        before: locked,
        after,
        metadata: { approved: Boolean(options.approve), anonymous: Boolean(options.anonymous) },
      },
      requestId,
    );
    return after!;
  });
}

export async function discardImport(db: Database, actor: Actor, id: string, requestId?: string) {
  await requireImporter(db, actor);
  await refuseSubject(db, actor, (await rowsAbout(db, id))?.map((r) => r.about) ?? []);
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, imports, id, 'Import', true);
    if (before.status !== 'preview')
      throw new InvalidStateTransitionError('Only a preview can be discarded.');
    const [after] = await tx
      .update(imports)
      .set({ status: 'discarded' })
      .where(eq(imports.id, before.id))
      .returning();
    await audit(tx, actor, id, 'feedback_import.discarded', { before, after }, requestId);
    return after!;
  });
}

export async function listImports(db: Database, actor: Actor, page = 1) {
  await feedbackScope(db, actor, 'ops:teacher_feedback:read');
  const [rows, [total]] = await Promise.all([
    db
      .select({ i: imports, byName: users.displayName })
      .from(imports)
      .leftJoin(users, eq(users.id, imports.createdBy))
      .orderBy(desc(imports.createdAt))
      .limit(25)
      .offset((page - 1) * 25),
    db.select({ n: count() }).from(imports),
  ]);
  return {
    rows: rows.map(({ i, byName }) => ({ ...i, byName })),
    total: total?.n ?? 0,
    page,
    pageSize: 25,
  };
}

/**
 * One import with its rows, problems first, and the file's column headings. Rows about the
 * reader are redacted (nobody reads raw feedback about themselves).
 * shortcut: the first 200 rows only (problems first); page them if files grow past that.
 */
export async function importDetail(db: Database, actor: Actor, id: string) {
  await feedbackScope(db, actor, 'ops:teacher_feedback:read');
  const row = await rowById(db, imports, id, 'Import');
  const [rows, me] = await Promise.all([rowsAbout(db, row.id), staffIdForUser(db, actor.id)]);
  const ordered = [...rows!].sort(
    (x, y) => Number(x.outcome === 'valid') - Number(y.outcome === 'valid'),
  );
  return { ...row, columns: Object.keys(row.mapping), rows: redactFor(ordered.slice(0, 200), me) };
}
