/**
 * Attendance CSV import (OPS-051): parse (own RFC 4180 parser), validate every
 * row, preview with per-row errors, then commit only the valid rows in one
 * transaction. Idempotent per file: the sha256 of the content is unique, so
 * re-importing the same file creates nothing and returns the earlier batch.
 *
 * Permission: `ops:attendance:manage`; employee codes outside the actor's HR
 * scope are row errors.
 */
import { createHash } from 'node:crypto';
import { and, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import {
  opsAttendanceImports,
  opsAttendanceSessions,
  opsEmployeeRecords,
  staffMembers,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ValidationError } from '@elevate/shared-contracts';
import type { IsoDate, StaffMemberId } from '@elevate/shared-types';
import { addDays } from '../../domain/dates';
import {
  validateAttendanceImport,
  type ImportEmployee,
  type ImportRowResult,
} from '../../domain/hr/attendance';
import { DEFAULT_TIMEZONE } from '../../domain/hr/calendar';
import type { Actor } from '../context';
import { hrCovers, hrScope } from '../hr-scope';
import { opsAudit } from '../ops-common';
import { shiftFor, shiftMeasures } from './attendance';
import { loadEmployee, paginate, timeSettings } from './shifts';
import type { ImportInput } from './time-schemas';

const auditImport = opsAudit('attendance_import');

type Batch = typeof opsAttendanceImports.$inferSelect;
type Counts = Pick<Batch, 'totalRows' | 'validRows' | 'invalidRows'>;

function publicRow(r: ImportRowResult) {
  return {
    row: r.row,
    employeeCode: r.employeeCode,
    ok: r.ok,
    errors: r.errors,
    value: r.value
      ? {
          workDate: r.value.workDate,
          clockInAt: r.value.clockInAt.toISOString(),
          clockOutAt: r.value.clockOutAt.toISOString(),
          breakMinutes: r.value.breakMinutes,
          timezone: r.value.timezone,
          note: r.value.note,
        }
      : null,
  };
}

/** The API result; `rows` null = this file was imported before (nothing new is created). */
function outcome(
  mode: 'preview' | 'commit',
  batch: Batch | null,
  fileSha256: string,
  counts: Counts,
  rows: ImportRowResult[] | null,
) {
  return {
    mode,
    alreadyImported: rows === null,
    batch,
    fileSha256,
    totalRows: counts.totalRows,
    validRows: counts.validRows,
    invalidRows: counts.invalidRows,
    rows: rows ? rows.map(publicRow) : [],
  };
}

const previousBatch = async (db: Database, hash: string) =>
  (
    await db.select().from(opsAttendanceImports).where(eq(opsAttendanceImports.fileSha256, hash))
  )[0];

export async function importAttendanceCsv(
  db: Database,
  actor: Actor,
  input: ImportInput,
  requestId?: string,
  now = new Date(),
) {
  const scope = await hrScope(db, actor, 'ops:attendance:manage');
  const hash = createHash('sha256').update(input.csv, 'utf8').digest('hex');
  const mode = input.commit ? ('commit' as const) : ('preview' as const);
  const previous = await previousBatch(db, hash);
  if (previous) return outcome(mode, previous, hash, previous, null);

  const employeeRows = await db
    .select({
      staffId: staffMembers.id,
      code: opsEmployeeRecords.employeeCode,
      timezone: opsEmployeeRecords.timezone,
    })
    .from(opsEmployeeRecords)
    .innerJoin(staffMembers, eq(staffMembers.id, opsEmployeeRecords.staffId));
  const employees = new Map<string, ImportEmployee>(
    employeeRows.map((e) => [
      e.code.toUpperCase(),
      {
        staffId: e.staffId,
        timezone: e.timezone || DEFAULT_TIMEZONE,
        inScope: hrCovers(scope, e.staffId),
      },
    ]),
  );
  const { attendance: rules } = await timeSettings(db);

  const validate = async (tx: Database) => {
    // Existing live sessions of the employees in the file, around the dates in the file.
    const dates = [...new Set(input.csv.match(/\d{4}-\d{2}-\d{2}/g) ?? [])].sort();
    const staffIds = [...new Set([...employees.values()].map((e) => e.staffId))];
    const existing =
      dates.length && staffIds.length
        ? await tx
            .select({
              staffId: opsAttendanceSessions.staffId,
              workDate: opsAttendanceSessions.workDate,
              clockInAt: opsAttendanceSessions.clockInAt,
              clockOutAt: opsAttendanceSessions.clockOutAt,
            })
            .from(opsAttendanceSessions)
            .where(
              and(
                inArray(opsAttendanceSessions.staffId, staffIds as StaffMemberId[]),
                ne(opsAttendanceSessions.status, 'superseded'),
                gte(opsAttendanceSessions.workDate, addDays(dates[0] as IsoDate, -1)),
                lte(opsAttendanceSessions.workDate, addDays(dates.at(-1) as IsoDate, 1)),
              ),
            )
        : [];
    const result = validateAttendanceImport(input.csv, { employees, existing, rules, now });
    if (!result.ok)
      throw new ValidationError(result.fileError, {
        details: [{ location: 'body', path: ['csv'], message: result.fileError }],
      });
    return result;
  };

  if (!input.commit) {
    const result = await validate(db);
    return outcome('preview', null, hash, result, result.rows);
  }

  return withTransaction(db, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ops.attendance_imports'))`);
    const again = await previousBatch(tx, hash);
    if (again) return outcome('commit', again, hash, again, null);
    const result = await validate(tx);
    const valid = result.rows.filter((r) => r.ok && r.value);
    const [batch] = await tx
      .insert(opsAttendanceImports)
      .values({
        fileSha256: hash,
        fileName: input.fileName ?? null,
        totalRows: result.totalRows,
        validRows: result.validRows,
        invalidRows: result.invalidRows,
        createdSessions: valid.length,
        rowErrors: result.rows.filter((r) => !r.ok).map((r) => ({ row: r.row, errors: r.errors })),
        importedBy: actor.id,
      })
      .returning();
    for (const r of valid) {
      const v = r.value!;
      const e = await loadEmployee(tx, v.staffId);
      const shift = await shiftFor(tx, { ...e, timezone: v.timezone }, v.workDate);
      await tx.insert(opsAttendanceSessions).values({
        staffId: v.staffId as StaffMemberId,
        workDate: v.workDate,
        clockInAt: v.clockInAt,
        clockOutAt: v.clockOutAt,
        timezone: v.timezone,
        breakMinutes: v.breakMinutes,
        source: 'csv_import',
        status: 'closed',
        ...shiftMeasures(shift, v, rules),
        reason: v.note,
        importId: batch!.id,
        createdBy: actor.id,
      });
    }
    const { fileName, totalRows, validRows, invalidRows, createdSessions } = batch!;
    const change = {
      after: { fileName, fileSha256: hash, totalRows, validRows, invalidRows, createdSessions },
    };
    await auditImport(tx, actor, batch!.id, 'attendance.csv_imported', change, requestId);
    return outcome('commit', batch!, hash, result, result.rows);
  });
}

export async function listAttendanceImports(db: Database, actor: Actor, page = 1) {
  await hrScope(db, actor, 'ops:attendance:manage');
  return paginate(db, opsAttendanceImports, undefined, page, async (limit, offset) => {
    const rows = await db
      .select({
        b: opsAttendanceImports,
        importedByName: sql<
          string | null
        >`(SELECT display_name FROM core.users u WHERE u.id = ${opsAttendanceImports.importedBy})`,
      })
      .from(opsAttendanceImports)
      .orderBy(desc(opsAttendanceImports.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => ({ ...r.b, importedByName: r.importedByName }));
  });
}
