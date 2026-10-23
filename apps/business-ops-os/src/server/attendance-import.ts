/**
 * Punch file import (owner brief 23 Oct 2026 §12, R12): HR uploads a CSV (Staff code, Date-time,
 * Direction), sees a row-by-row preview, then commits. The same file (sha256) is processed once;
 * a punch already stored is skipped (unique staff + time + direction), so nothing is counted
 * twice. The source is recorded as "Imported from <file name>" — never as a device connection.
 */
import { createHash } from 'node:crypto';
import { and, desc, eq, getTableColumns, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import type { z } from 'zod';
import {
  isUniqueViolation,
  opsAttendanceImports,
  opsAttendancePunches,
  opsStaffProfiles,
  staffMembers,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { parsePunchCsv, type PunchCsvRow } from '../domain/attendance';
import { fmtDateTime } from '../ui/format';
import type { importPreviewBody } from './attendance-schemas';
import { hrAttendanceStaff } from './attendance';
import { accessScope, staffIdForUser, type Actor } from './context';
import { OWN_RECORD } from './attendance-actions';
import { fieldError, opsAudit, rowById } from './ops-common';

const audit = opsAudit('attendance_import');

export type ImportRow = PunchCsvRow & {
  staffId: string | null;
  staffName: string | null;
  outcome: 'valid' | 'invalid' | 'duplicate';
};

const key = (staffId: string, at: string, direction: string) => `${staffId}|${at}|${direction}`;

export async function previewPunchImport(
  db: Database,
  actor: Actor,
  body: z.output<typeof importPreviewBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:attendance:manage');
  const self = await staffIdForUser(db, actor.id);
  const sha256 = createHash('sha256').update(body.content, 'utf8').digest('hex');
  const [seen] = await db
    .select()
    .from(opsAttendanceImports)
    .where(eq(opsAttendanceImports.sha256, sha256));
  if (seen?.status === 'committed')
    throw new ConflictError(
      `This file was already imported on ${fmtDateTime(seen.committedAt)} (${seen.sourceLabel}).`,
    );
  if (seen) return seen; // the same file again before commit: the same preview
  const parsed = parsePunchCsv(body.content);
  if (!parsed.ok) throw fieldError('content', parsed.error);
  const codes = [...new Set(parsed.rows.map((r) => r.staffCode).filter(Boolean))];
  const staff = codes.length
    ? await db
        .select({
          code: opsStaffProfiles.staffCode,
          id: staffMembers.id,
          name: staffMembers.fullName,
          status: staffMembers.status,
        })
        .from(opsStaffProfiles)
        .innerJoin(staffMembers, eq(staffMembers.id, opsStaffProfiles.staffId))
        .where(
          and(isNotNull(opsStaffProfiles.staffCode), inArray(opsStaffProfiles.staffCode, codes)),
        )
    : [];
  // Codes outside the uploader's HR scope read as unknown (same rule as a manual punch: 404).
  const reach = new Set(
    (await hrAttendanceStaff(db, actor, { ids: staff.map((s) => s.id) })).map(
      (s) => s.id as string,
    ),
  );
  const byCode = new Map(staff.filter((s) => reach.has(s.id)).map((s) => [s.code!, s]));
  const times = parsed.rows
    .map((r) => r.at)
    .filter((t): t is string => Boolean(t))
    .sort();
  const existing =
    staff.length && times.length
      ? await db
          .select()
          .from(opsAttendancePunches)
          .where(
            and(
              inArray(
                opsAttendancePunches.staffId,
                staff.map((s) => s.id),
              ),
              gte(opsAttendancePunches.punchedAt, new Date(times[0]!)),
              lte(opsAttendancePunches.punchedAt, new Date(times.at(-1)!)),
            ),
          )
      : [];
  const known = new Set(
    existing.map((p) => key(p.staffId, p.punchedAt.toISOString(), p.direction)),
  );
  const now = new Date().toISOString();
  const rows: ImportRow[] = parsed.rows.map((r) => {
    const s = byCode.get(r.staffCode);
    const errors = [
      ...r.errors,
      ...(r.staffCode && !s ? [`No staff member has the code ${r.staffCode}`] : []),
      ...(s?.status === 'inactive' ? [`${s.name} (${r.staffCode}) no longer works here`] : []),
      ...(s && s.id === self ? [OWN_RECORD] : []),
      ...(r.at && r.at > now ? ['The time is in the future'] : []),
    ];
    const k = s && r.at && r.direction ? key(s.id, r.at, r.direction) : null;
    const outcome = errors.length ? 'invalid' : known.has(k!) ? 'duplicate' : 'valid';
    if (k) known.add(k); // a repeat later in the same file is a duplicate too
    return { ...r, errors, staffId: s?.id ?? null, staffName: s?.name ?? null, outcome };
  });
  const n = (o: ImportRow['outcome']) => rows.filter((r) => r.outcome === o).length;
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(opsAttendanceImports)
      .values({
        sha256,
        sourceLabel: `Imported from ${body.filename}`,
        rows,
        rowsTotal: rows.length,
        rowsValid: n('valid'),
        rowsInvalid: n('invalid'),
        rowsDuplicate: n('duplicate'),
        createdBy: actor.id,
      })
      .returning()
      .catch((e: unknown) => {
        // The same file sent twice at once: the second upload loses the race.
        if (isUniqueViolation(e)) throw new ConflictError('This file is already being imported.');
        throw e;
      });
    await audit(
      tx,
      actor,
      row!.id,
      'attendance.import_previewed',
      {
        metadata: { sha256, sourceLabel: row!.sourceLabel, rowsTotal: rows.length },
      },
      requestId,
    );
    return row!;
  });
}

/** Store the preview's valid rows; a punch stored since the preview is skipped, not doubled. */
export async function commitPunchImport(
  db: Database,
  actor: Actor,
  id: string,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:attendance:manage');
  return withTransaction(db, async (tx) => {
    const imp = await rowById(tx, opsAttendanceImports, id, 'Import', true);
    const self = await staffIdForUser(tx, actor.id);
    const valid = (imp.rows as ImportRow[]).filter((x) => x.outcome === 'valid');
    const reach = new Set(
      (await hrAttendanceStaff(tx, actor, { ids: valid.map((r) => r.staffId!) })).map(
        (s) => s.id as string,
      ),
    );
    if (imp.status === 'committed') throw new ConflictError('This import is already committed.');
    let added = 0;
    // Rows about the committer, or outside their HR scope, are never stored (counted as skipped).
    const rows = valid.filter((r) => r.staffId !== self && reach.has(r.staffId!));
    for (const r of rows) {
      const stored = await tx
        .insert(opsAttendancePunches)
        .values({
          staffId: r.staffId as StaffMemberId,
          punchedAt: new Date(r.at!),
          direction: r.direction!,
          source: 'import',
          sourceRef: `Line ${r.line}`,
          importId: imp.id,
          enteredBy: actor.id,
        })
        .onConflictDoNothing()
        .returning({ id: opsAttendancePunches.id });
      added += stored.length;
    }
    const skipped = imp.rowsValid - added;
    const [row] = await tx
      .update(opsAttendanceImports)
      .set({
        status: 'committed',
        committedAt: new Date(),
        committedBy: actor.id,
        rowsValid: added,
        rowsDuplicate: imp.rowsDuplicate + skipped,
      })
      .where(eq(opsAttendanceImports.id, id))
      .returning();
    await audit(
      tx,
      actor,
      id,
      'attendance.import_committed',
      { metadata: { added, skipped } },
      requestId,
    );
    return { ...row!, added, skipped };
  });
}

/** Recent imports, newest first (rows left out). */
export async function listPunchImports(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:attendance:manage');
  const { rows: _rows, ...columns } = getTableColumns(opsAttendanceImports);
  return db
    .select(columns)
    .from(opsAttendanceImports)
    .orderBy(desc(opsAttendanceImports.createdAt))
    .limit(10);
}

export async function getPunchImport(db: Database, actor: Actor, id: string) {
  await accessScope(db, actor, 'ops:attendance:manage');
  return rowById(db, opsAttendanceImports, id, 'Import');
}
