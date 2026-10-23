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
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  opsEodReports,
  opsEodReportVersions,
  opsStaffProfiles,
  opsTaskImportBatches as batches,
  opsTaskImportRows as importRows,
  staffMembers,
  users,
  isUniqueViolation,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError } from '@elevate/shared-contracts';
import {
  exportDateFromName,
  mapBackup,
  MAX_BACKUP_CHARS,
  parseTrackerBackup,
  TRACKER_SOURCE_KIND,
  UTC_DAY_NOTE,
  type ImportedReportValues,
  type ImportedTaskValues,
  type StaffOption,
} from '../domain/task-import';
import { istInstant } from '../domain/dates';
import { accessScope, activeStaff, notFound, type Actor } from './context';
import { fieldError, opsAudit, rowById } from './ops-common';
import { countOf, legacyRefOf, outcomes, sha256 } from './task-import-outcomes';
import { insertTaskWithEvent } from './task-store';

export { legacyRefOf, type ImportRow } from './task-import-outcomes';

const audit = opsAudit('task_import');

export const importBody = z.object({
  filename: z.string().trim().min(1).max(200),
  staffId: z.uuid(),
  content: z
    .string()
    .min(1)
    .max(MAX_BACKUP_CHARS, 'The file is larger than 5 MB; a tracker backup is much smaller.'),
});

async function requireImporter(db: Database, actor: Actor) {
  // Imports cross every staff member's data: all scope only.
  if ((await accessScope(db, actor, 'ops:tasks:import')).scope !== 'all')
    throw new ForbiddenError('Tracker imports need the operations manager’s import access.');
}

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
            // R4: the tracker's Blocked / On-hold is the flag (blocked since the import).
            ...(v.blockedKind
              ? {
                  blockedAt: new Date(),
                  blockedKind: v.blockedKind,
                  blockedReason: v.blockedReason,
                }
              : {}),
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
            periodKind: 'day',
            periodStart: v.reportDate,
            periodEnd: v.reportDate,
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
