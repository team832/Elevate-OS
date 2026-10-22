/**
 * Tracker backup imports (owner brief 2 §13, ops:tasks:import). Upload = dry run: the file is
 * stored as a `previewed` batch (raw copy protected by the permission) for the staff member it
 * was mapped to, and every record gets an outcome computed against the database. Commit
 * re-computes the outcomes and writes accepted tasks (with one `imported` event, no synthesised
 * history) and historical EOD reports (one legacy version, never sent) in ONE transaction.
 * Idempotency: task legacy ref `deskday_backup_json:<staffId>:<legacyId>` and the batch's unique
 * (sha256, staff). A record whose content changed since the last import is reported as
 * `changed` and Elevate keeps its own value. Nothing here notifies anyone.
 */
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  opsEodReports,
  opsEodReportVersions,
  opsStaffProfiles,
  opsStaffTasks as tasks,
  opsTaskImportBatches as batches,
  opsTaskImportRows as importRows,
  staffMembers,
  users,
  isUniqueViolation,
  type Database,
  type OpsEodReportId,
  type OpsStaffTaskId,
  type OpsTaskImportOutcome,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import {
  exportDateFromName,
  mapBackup,
  MAX_BACKUP_CHARS,
  parseTrackerBackup,
  taskDifferences,
  TRACKER_SOURCE_KIND,
  UTC_DAY_NOTE,
  type ImportedReportValues,
  type ImportedTaskValues,
  type MappedRecord,
  type StaffOption,
  type TrackerBackup,
} from '../domain/task-import';
import { istInstant } from '../domain/dates';
import { accessScope, activeStaff, notFound, type Actor } from './context';
import { fieldError, opsAudit, rowById } from './ops-common';
import { insertTaskWithEvent } from './task-store';

const audit = opsAudit('task_import');

export const importBody = z.object({
  filename: z.string().trim().min(1).max(200),
  staffId: z.uuid(),
  content: z
    .string()
    .min(1)
    .max(MAX_BACKUP_CHARS, 'The file is larger than 5 MB; a tracker backup is much smaller.'),
});

export interface ImportRow {
  kind: 'task' | 'report';
  legacyId: string;
  title: string;
  outcome: OpsTaskImportOutcome;
  message: string | null;
  contentHash: string;
  taskId: OpsStaffTaskId | null;
  eodReportId: OpsEodReportId | null;
  /** False for a repeat of a legacy id inside the same file (one row per record). */
  store: boolean;
  values: ImportedTaskValues | ImportedReportValues | null;
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export const legacyRefOf = (staffId: string, legacyId: string) =>
  `${TRACKER_SOURCE_KIND}:${staffId}:${legacyId}`;

async function requireImporter(db: Database, actor: Actor) {
  // Imports cross every staff member's data: all scope only.
  if ((await accessScope(db, actor, 'ops:tasks:import')).scope !== 'all')
    throw new ForbiddenError('Tracker imports need the operations manager’s import access.');
}

/** Latest stored hash per legacy id for this staff member and kind. */
async function previousRows(db: Database, staffId: string, kind: 'task' | 'report', ids: string[]) {
  if (!ids.length) return new Map<string, typeof importRows.$inferSelect>();
  const rows = await db
    .select({ row: importRows })
    .from(importRows)
    .innerJoin(batches, eq(batches.id, importRows.batchId))
    .where(
      and(
        eq(batches.staffId, staffId as StaffMemberId),
        eq(batches.status, 'committed'),
        eq(importRows.kind, kind),
        inArray(importRows.legacyId, ids),
        // Only a row that produced a task or report means "already imported".
        or(isNotNull(importRows.taskId), isNotNull(importRows.eodReportId)),
      ),
    )
    .orderBy(desc(importRows.createdAt));
  const latest = new Map<string, typeof importRows.$inferSelect>();
  for (const { row } of rows) if (!latest.has(row.legacyId)) latest.set(row.legacyId, row);
  return latest;
}

/** Each record's outcome against the database now (preview and commit share it). */
async function outcomes(
  db: Database,
  staffId: string,
  backup: TrackerBackup,
): Promise<ImportRow[]> {
  const refs = backup.tasks.map((t) => legacyRefOf(staffId, t.legacyId));
  const existing = refs.length
    ? await db.select().from(tasks).where(inArray(tasks.legacyRef, refs))
    : [];
  const byRef = new Map(existing.map((t) => [t.legacyRef, t]));
  const prevTasks = await previousRows(
    db,
    staffId,
    'task',
    backup.tasks.map((t) => t.legacyId),
  );
  const prevReports = await previousRows(
    db,
    staffId,
    'report',
    backup.reports.map((r) => r.legacyId),
  );
  const dates = backup.reports.flatMap((r) => (r.values ? [r.values.reportDate] : []));
  const eodDays = new Set(
    dates.length
      ? (
          await db
            .select({ d: opsEodReports.reportDate })
            .from(opsEodReports)
            .where(
              and(
                eq(opsEodReports.staffId, staffId as StaffMemberId),
                inArray(opsEodReports.reportDate, dates),
              ),
            )
        ).map((r) => r.d)
      : [],
  );
  const seen = new Set<string>();
  const row = <V extends ImportRow['values']>(
    kind: ImportRow['kind'],
    r: MappedRecord<NonNullable<V>>,
    decide: () => Pick<ImportRow, 'outcome' | 'message' | 'taskId' | 'eodReportId'>,
  ): ImportRow => {
    const key = `${kind}:${r.legacyId}`;
    const repeat = seen.has(key);
    seen.add(key);
    const base = {
      kind,
      legacyId: r.legacyId,
      title: r.title,
      contentHash: sha256(r.canonical),
      values: r.values,
    };
    const none = { taskId: null, eodReportId: null };
    if (repeat)
      return {
        ...base,
        ...none,
        store: false,
        outcome: 'failed',
        message: 'Appears twice in the file; the first copy is used.',
      };
    if (r.problem)
      return {
        ...base,
        ...none,
        store: true,
        outcome: r.problem.outcome,
        message: r.problem.message,
      };
    const decided = decide();
    const notes = [decided.message, ...r.notes].filter(Boolean).join(' ');
    return { ...base, ...decided, message: notes || null, store: true };
  };
  return [
    ...backup.tasks.map((t) =>
      row('task', t, () => {
        const ref = legacyRefOf(staffId, t.legacyId);
        const current = byRef.get(ref);
        if (!current)
          return { outcome: 'accepted', message: null, taskId: null, eodReportId: null };
        const same = prevTasks.get(t.legacyId)?.contentHash === sha256(t.canonical);
        const diff = taskDifferences(t.values!, current);
        return same
          ? {
              outcome: 'duplicate',
              message: 'Already imported.',
              taskId: current.id,
              eodReportId: null,
            }
          : {
              outcome: 'changed',
              message: `Changed in the tracker since the last import (${diff.join(', ') || 'details only'}). Elevate keeps its own task; update it there if needed.`,
              taskId: current.id,
              eodReportId: null,
            };
      }),
    ),
    ...backup.reports.map((r) =>
      row('report', r, () => {
        const prev = prevReports.get(r.legacyId);
        if (prev)
          return prev.contentHash === sha256(r.canonical)
            ? {
                outcome: 'duplicate',
                message: 'Already imported.',
                taskId: null,
                eodReportId: prev.eodReportId,
              }
            : {
                outcome: 'changed',
                message:
                  'Changed in the tracker since the last import. Elevate keeps the report it imported.',
                taskId: null,
                eodReportId: prev.eodReportId,
              };
        if (eodDays.has(r.values!.reportDate))
          return {
            outcome: 'skipped',
            message: 'An Elevate end-of-day report already exists for this day; it is kept.',
            taskId: null,
            eodReportId: null,
          };
        eodDays.add(r.values!.reportDate);
        return { outcome: 'accepted', message: null, taskId: null, eodReportId: null };
      }),
    ),
  ];
}

const countOf = (rows: ImportRow[]) => {
  const counts: Partial<Record<OpsTaskImportOutcome | 'parsed', number>> = { parsed: rows.length };
  for (const r of rows) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  return counts;
};

const batchColumns = {
  id: batches.id,
  sourceFilename: batches.sourceFilename,
  sourceSha256: batches.sourceSha256,
  sourceVersion: batches.sourceVersion,
  staffId: batches.staffId,
  staffName: staffMembers.fullName,
  status: batches.status,
  counts: batches.counts,
  createdAt: batches.createdAt,
  committedAt: batches.committedAt,
};

/** Upload + dry run. The same file for the same person returns the batch already stored. */
export async function previewImport(
  db: Database,
  actor: Actor,
  input: z.output<typeof importBody>,
  requestId?: string,
) {
  await requireImporter(db, actor);
  const parsed = parseTrackerBackup(input.content);
  if (!parsed.ok) throw fieldError('content', parsed.error);
  const staff = await activeStaff(db, input.staffId);
  const sourceSha256 = sha256(input.content);
  const [existing] = await db
    .select({ id: batches.id })
    .from(batches)
    .where(and(eq(batches.sourceSha256, sourceSha256), eq(batches.staffId, staff.id)));
  // Same file again: a fresh dry run of the stored batch (all duplicates once committed).
  if (existing) return batchView(db, existing.id, true);
  const rows = await outcomes(db, staff.id, parsed.backup);
  const exported = exportDateFromName(input.filename);
  const id = await withTransaction(db, async (tx) => {
    const [batch] = await tx
      .insert(batches)
      .values({
        sourceFilename: input.filename,
        sourceSha256,
        sourceKind: TRACKER_SOURCE_KIND,
        sourceVersion: exported ? `Exported ${exported} (from the file name)` : null,
        staffId: staff.id,
        counts: countOf(rows),
        raw: parsed.json,
        createdByUserId: actor.id,
      })
      .returning({ id: batches.id });
    await audit(
      tx,
      actor,
      batch!.id,
      'task_import.previewed',
      {
        metadata: { staffId: staff.id, sourceSha256, counts: countOf(rows) },
      },
      requestId,
    );
    return batch!.id;
  }).catch((error: unknown) => {
    // Two uploads of the same file for the same person at once: the second loses the race.
    if (isUniqueViolation(error, 'task_import_batches_source_staff_key'))
      throw new ConflictError(
        'This file is already being previewed for this person. Reload the import page.',
      );
    throw error;
  });
  return getImport(db, actor, id);
}

/** A batch with its rows: the stored outcomes once committed (or `fresh`), else a new dry run. */
async function batchView(db: Database, id: string, fresh = false) {
  const [batch] = await db
    .select({ ...batchColumns, raw: batches.raw })
    .from(batches)
    .innerJoin(staffMembers, eq(staffMembers.id, batches.staffId))
    .where(eq(batches.id, id as never));
  if (!batch) notFound('Import');
  const { raw, ...summary } = batch;
  const mapped = mapBackup(raw);
  let rows = mapped.ok ? await outcomes(db, batch.staffId, mapped.backup) : [];
  const stored = batch.status === 'committed' && !fresh;
  if (stored) {
    const saved = await db.select().from(importRows).where(eq(importRows.batchId, batch.id));
    const byKey = new Map(saved.map((s) => [`${s.kind}:${s.legacyId}`, s]));
    rows = rows.flatMap((r) => {
      const s = r.store && byKey.get(`${r.kind}:${r.legacyId}`);
      return s
        ? [
            {
              ...r,
              outcome: s.outcome,
              message: s.message,
              taskId: s.taskId,
              eodReportId: s.eodReportId,
            },
          ]
        : [];
    });
  }
  return {
    id: summary.id,
    batch: summary,
    profile: mapped.ok ? mapped.backup.profile : null,
    rows: rows.map(({ values: _v, store: _s, ...r }) => r),
    counts: stored ? batch.counts : countOf(rows),
    notes: [UTC_DAY_NOTE],
  };
}

export async function getImport(db: Database, actor: Actor, id: string) {
  await requireImporter(db, actor);
  return batchView(db, id);
}

export async function listImports(db: Database, actor: Actor) {
  await requireImporter(db, actor);
  return db
    .select(batchColumns)
    .from(batches)
    .innerJoin(staffMembers, eq(staffMembers.id, batches.staffId))
    .orderBy(desc(batches.createdAt))
    .limit(50);
}

/** Commit a previewed batch in one transaction. A committed batch is never imported twice. */
export async function commitImport(db: Database, actor: Actor, id: string, requestId?: string) {
  await requireImporter(db, actor);
  await withTransaction(db, async (tx) => {
    const batch = await rowById(tx, batches, id, 'Import', true);
    if (batch.status === 'committed')
      throw new ConflictError(
        `This file was already imported on ${batch.committedAt!.toISOString().slice(0, 10)}.`,
      );
    const mapped = mapBackup(batch.raw);
    if (!mapped.ok) throw new ConflictError(mapped.error);
    const rows = await outcomes(tx, batch.staffId, mapped.backup);
    const note = { sourceFilename: batch.sourceFilename, batchId: batch.id, note: UTC_DAY_NOTE };
    for (const r of rows) {
      if (r.outcome !== 'accepted') continue;
      if (r.kind === 'task') {
        const v = r.values as ImportedTaskValues;
        const receivedAt = v.createdOn ? istInstant(v.createdOn) : new Date();
        // R17: the event is the commit time (no history is backdated); legacy dates go in `data`.
        const task = await insertTaskWithEvent(
          tx,
          actor,
          {
            staffId: batch.staffId,
            title: v.title,
            details: v.details,
            source: 'import',
            requesterNote: v.requesterNote,
            priority: v.priority,
            receivedAt,
            dueOn: v.dueOn,
            dueTime: v.dueTime,
            status: v.status,
            progressPercent: v.progressPercent,
            reason: v.reason,
            recurrence: v.recurrence,
            completedAt: v.completedOn ? istInstant(v.completedOn) : null,
            legacyRef: legacyRefOf(batch.staffId, r.legacyId),
            importBatchId: batch.id,
            isSample: batch.isSample,
            createdBy: actor.id,
          },
          {
            kind: 'imported',
            occurredAt: new Date(),
            data: {
              ...note,
              legacy: {
                id: r.legacyId,
                createdOn: v.createdOn,
                completedOn: v.completedOn,
                dueOn: v.dueOn,
                dueTime: v.dueTime,
              },
            },
            audit: 'staff_task.imported',
            requestId,
          },
        );
        if (!task) {
          // Imported meanwhile by another commit (legacy ref taken): never twice.
          r.outcome = 'duplicate';
          r.message = 'Already imported.';
          continue;
        }
        r.taskId = task!.id;
      } else {
        const v = r.values as ImportedReportValues;
        const at = new Date(v.generatedAt);
        const snapshot = {
          kind: 'legacy_tracker_report',
          reportDate: v.reportDate,
          generatedAt: v.generatedAt,
          legacy: v.legacy,
          imported: note,
        };
        const notes = 'Imported from the old task tracker; not sent through Elevate.';
        const [report] = await tx
          .insert(opsEodReports)
          .values({
            staffId: batch.staffId,
            reportDate: v.reportDate,
            status: 'submitted',
            snapshot,
            summary: v.text,
            notes,
            currentVersion: 1,
            submittedAt: at,
            isSample: batch.isSample,
            createdBy: actor.id,
          })
          .returning({ id: opsEodReports.id });
        await tx.insert(opsEodReportVersions).values({
          reportId: report!.id,
          version: 1,
          snapshot,
          narrative: { summary: v.text, nextDayPlan: null, notes },
          sourceCutoffAt: at,
          submittedAt: at,
          submittedByUserId: actor.id,
        });
        r.eodReportId = report!.id;
      }
    }
    const stored = rows.filter((r) => r.store);
    if (stored.length)
      await tx.insert(importRows).values(
        stored.map((r) => ({
          batchId: batch.id,
          kind: r.kind,
          legacyId: r.legacyId,
          contentHash: r.contentHash,
          outcome: r.outcome,
          taskId: r.taskId,
          eodReportId: r.eodReportId,
          message: r.message,
        })),
      );
    const counts = countOf(rows);
    await tx
      .update(batches)
      .set({ status: 'committed', counts, committedAt: new Date(), committedByUserId: actor.id })
      .where(eq(batches.id, batch.id));
    await audit(
      tx,
      actor,
      batch.id,
      'task_import.committed',
      { metadata: { staffId: batch.staffId, counts } },
      requestId,
    );
  });
  return getImport(db, actor, id);
}

/** Active staff for the "whose file is this" choice, with the exact keys a suggestion may use. */
export async function importStaffOptions(db: Database, actor: Actor): Promise<StaffOption[]> {
  await requireImporter(db, actor);
  return db
    .select({
      id: staffMembers.id,
      label: staffMembers.fullName,
      email: users.email,
      staffCode: opsStaffProfiles.staffCode,
    })
    .from(staffMembers)
    .leftJoin(users, eq(users.id, staffMembers.userId))
    .leftJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
    .where(eq(staffMembers.status, 'active'))
    .orderBy(staffMembers.fullName);
}
