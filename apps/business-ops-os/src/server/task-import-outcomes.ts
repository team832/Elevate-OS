/** Tracker backup imports: each record's outcome against the database (preview and commit share it). */
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import {
  opsEodReports,
  opsStaffTasks as tasks,
  opsTaskImportBatches as batches,
  opsTaskImportRows as importRows,
  type Database,
  type OpsEodReportId,
  type OpsStaffTaskId,
  type OpsTaskImportOutcome,
} from '@elevate/database';
import type { StaffMemberId } from '@elevate/shared-types';
import {
  taskDifferences,
  TRACKER_SOURCE_KIND,
  type ImportedReportValues,
  type ImportedTaskValues,
  type MappedRecord,
  type TrackerBackup,
} from '../domain/task-import';

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

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export const legacyRefOf = (staffId: string, legacyId: string) =>
  `${TRACKER_SOURCE_KIND}:${staffId}:${legacyId}`;

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
export async function outcomes(
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

export const countOf = (rows: ImportRow[]) => {
  const counts: Partial<Record<OpsTaskImportOutcome | 'parsed', number>> = { parsed: rows.length };
  for (const r of rows) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  return counts;
};
