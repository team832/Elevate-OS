/**
 * Lists behind the HR attendance screens: schedules, holidays, recent leave, filter options.
 * Readers of everyone's attendance only (ops:attendance:read, all scope).
 */
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import {
  branches,
  departments,
  opsHolidays,
  opsLeaveRecords,
  opsStaffProfiles,
  opsWorkSchedules,
  staffMembers,
  type Database,
} from '@elevate/database';
import { ForbiddenError } from '@elevate/shared-contracts';
import { addDays, istToday } from '../domain/dates';
import { hrAttendanceStaff } from './attendance';
import { accessScope, type Actor } from './context';
import { hrReachWhere, hrScopeFor } from './organisation';
import { inOrder } from './ops-common';

const staffName = sql<string>`coalesce(${opsStaffProfiles.displayName}, ${staffMembers.fullName})`;

export async function attendanceSetup(db: Database, actor: Actor) {
  const access = await accessScope(db, actor, 'ops:attendance:read');
  if (access.scope !== 'all') throw new ForbiddenError('HR attendance covers every staff member.');
  const since = addDays(istToday(new Date()), -60);
  const reach = hrReachWhere(actor, await hrScopeFor(db, actor));
  const [schedules, holidays, leave, staff, depts, branchRows] = await inOrder([
    db
      .select()
      .from(opsWorkSchedules)
      .orderBy(desc(opsWorkSchedules.isDefault), asc(opsWorkSchedules.name)),
    db
      .select({
        id: opsHolidays.id,
        holidayOn: opsHolidays.holidayOn,
        name: opsHolidays.name,
        decisionState: opsHolidays.decisionState,
        branchName: branches.name,
      })
      .from(opsHolidays)
      .leftJoin(branches, eq(branches.id, opsHolidays.branchId))
      .where(gte(opsHolidays.holidayOn, since))
      .orderBy(asc(opsHolidays.holidayOn))
      .limit(100),
    db
      .select({
        id: opsLeaveRecords.id,
        staffName,
        fromDate: opsLeaveRecords.fromDate,
        toDate: opsLeaveRecords.toDate,
        kind: opsLeaveRecords.kind,
        status: opsLeaveRecords.status,
        reason: opsLeaveRecords.reason,
        isSample: opsLeaveRecords.isSample,
      })
      .from(opsLeaveRecords)
      .innerJoin(staffMembers, eq(staffMembers.id, opsLeaveRecords.staffId))
      .leftJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
      .where(and(gte(opsLeaveRecords.toDate, since), reach))
      .orderBy(desc(opsLeaveRecords.fromDate))
      .limit(50),
    () => hrAttendanceStaff(db, actor),
    db
      .select({ value: departments.id, label: departments.name })
      .from(departments)
      .orderBy(asc(departments.name)),
    db
      .select({ value: branches.id, label: branches.name })
      .from(branches)
      .orderBy(asc(branches.name)),
  ] as const);
  return {
    schedules,
    holidays,
    leave,
    staff,
    staffOptions: staff.map((s) => ({
      value: s.id as string,
      label: s.staffCode ? `${s.name} (${s.staffCode})` : s.name,
    })),
    departments: depts as { value: string; label: string }[],
    branches: branchRows as { value: string; label: string }[],
  };
}
export type AttendanceSetup = Awaited<ReturnType<typeof attendanceSetup>>;
