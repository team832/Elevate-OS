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
import { recordAudit, withTransaction } from '@elevate/server-kit';
import { ValidationError } from '@elevate/shared-contracts';
import type { IsoDate, StaffMemberId } from '@elevate/shared-types';
import { addDays } from '../../domain/dates';
import {
  lateEarly,
  validateAttendanceImport,
  type ImportEmployee,
  type ImportRowResult,
} from '../../domain/hr/attendance';
import { DEFAULT_TIMEZONE } from '../../domain/hr/calendar';
import { shiftWindow } from '../../domain/hr/shifts';
import type { Actor } from '../context';
import { hrCovers, hrScope } from '../hr-scope';
import { shiftFor } from './attendance';
import { loadEmployee, PAGE_SIZE, timeSettings } from './shifts';
import type { ImportInput } from './time-schemas';

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

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

export async function importAttendanceCsv(
  db: Database,
  actor: Actor,
  input: ImportInput,
  requestId?: string,
  now = new Date(),
) {
  const scope = await hrScope(db, actor, 'ops:attendance:manage');
  const hash = sha256(input.csv);
  const [previous] = await db
    .select()
    .from(opsAttendanceImports)
    .where(eq(opsAttendanceImports.fileSha256, hash));
  if (previous)
    return {
      mode: input.commit ? ('commit' as const) : ('preview' as const),
      alreadyImported: true,
      batch: previous,
      fileSha256: hash,
      totalRows: previous.totalRows,
      validRows: previous.validRows,
      invalidRows: previous.invalidRows,
      rows: [],
    };

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

  const run = async (tx: Database) => {
    // Existing live sessions of the employees in the file, around the dates in the file.
    const codesAndDates = input.csv.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    const sorted = [...new Set(codesAndDates)].sort();
    const staffIds = [...new Set([...employees.values()].map((e) => e.staffId))];
    const existing =
      sorted.length && staffIds.length
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
                gte(opsAttendanceSessions.workDate, addDays(sorted[0] as IsoDate, -1)),
                lte(
                  opsAttendanceSessions.workDate,
                  addDays(sorted[sorted.length - 1] as IsoDate, 1),
                ),
              ),
            )
        : [];
    return validateAttendanceImport(input.csv, { employees, existing, rules, now });
  };

  if (!input.commit) {
    const result = await run(db);
    if (!result.ok)
      throw new ValidationError(result.fileError, {
        details: [{ location: 'body', path: ['csv'], message: result.fileError }],
      });
    return {
      mode: 'preview' as const,
      alreadyImported: false,
      batch: null,
      fileSha256: hash,
      totalRows: result.totalRows,
      validRows: result.validRows,
      invalidRows: result.invalidRows,
      rows: result.rows.map(publicRow),
    };
  }

  return withTransaction(db, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ops.attendance_imports'))`);
    const [again] = await tx
      .select()
      .from(opsAttendanceImports)
      .where(eq(opsAttendanceImports.fileSha256, hash));
    if (again)
      return {
        mode: 'commit' as const,
        alreadyImported: true,
        batch: again,
        fileSha256: hash,
        totalRows: again.totalRows,
        validRows: again.validRows,
        invalidRows: again.invalidRows,
        rows: [],
      };
    const result = await run(tx);
    if (!result.ok)
      throw new ValidationError(result.fileError, {
        details: [{ location: 'body', path: ['csv'], message: result.fileError }],
      });
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
      const window = shift ? shiftWindow(shift.template, v.workDate, v.timezone) : null;
      const le = lateEarly({ clockInAt: v.clockInAt, clockOutAt: v.clockOutAt }, window, rules);
      await tx.insert(opsAttendanceSessions).values({
        staffId: v.staffId as StaffMemberId,
        workDate: v.workDate,
        clockInAt: v.clockInAt,
        clockOutAt: v.clockOutAt,
        timezone: v.timezone,
        breakMinutes: v.breakMinutes,
        source: 'csv_import',
        status: 'closed',
        shiftTemplateId: (shift?.template.id as never) ?? null,
        lateMinutes: le.lateMinutes,
        earlyDepartureMinutes: le.earlyDepartureMinutes,
        reason: v.note,
        importId: batch!.id,
        createdBy: actor.id,
      });
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'attendance.csv_imported',
      entityType: 'attendance_import',
      entityId: batch!.id,
      after: {
        fileName: batch!.fileName,
        fileSha256: hash,
        totalRows: batch!.totalRows,
        validRows: batch!.validRows,
        invalidRows: batch!.invalidRows,
        createdSessions: batch!.createdSessions,
      },
      requestId,
    });
    return {
      mode: 'commit' as const,
      alreadyImported: false,
      batch: batch!,
      fileSha256: hash,
      totalRows: result.totalRows,
      validRows: result.validRows,
      invalidRows: result.invalidRows,
      rows: result.rows.map(publicRow),
    };
  });
}

export async function listAttendanceImports(db: Database, actor: Actor, page = 1) {
  await hrScope(db, actor, 'ops:attendance:manage');
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(opsAttendanceImports);
  const rows = await db
    .select({
      b: opsAttendanceImports,
      importedByName: sql<
        string | null
      >`(SELECT display_name FROM core.users u WHERE u.id = ${opsAttendanceImports.importedBy})`,
    })
    .from(opsAttendanceImports)
    .orderBy(desc(opsAttendanceImports.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return {
    rows: rows.map((r) => ({ ...r.b, importedByName: r.importedByName })),
    page,
    pageSize: PAGE_SIZE,
    total,
  };
}
