/**
 * Employee records rules (OPS-030, OPS-031, OPS-033, OPS-037). Pure.
 * Algorithm documentation: docs/parts/hr-records.md → A-HR-01 … A-HR-03.
 *
 * Field tiers (who sees what on an employee):
 * - directory: name, code, department, designation, manager, work contacts,
 *   location, timezone — anyone holding `ops:employees:read` for the employee;
 * - record: employment type, status, dates, history, roles, lifecycle and
 *   document/asset summaries — the employee themself, holders of
 *   `ops:employees:manage`, and holders of `ops:lifecycle:read` whose HR scope
 *   covers the employee (department managers: their reporting chain);
 * - private: legal name (and the private HR panel) — holders of
 *   `ops:employee_private:read` whose scope covers the employee (own = self only).
 */
import { normalisePhone } from '../contacts';

export const EMPLOYMENT_STATUSES = ['onboarding', 'active', 'on_notice', 'separated'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];
export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  onboarding: 'Onboarding',
  active: 'Active',
  on_notice: 'On notice',
  separated: 'Separated',
};

export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'visiting',
  'not_recorded',
] as const;

export const HISTORY_FIELDS = [
  'department',
  'title',
  'manager',
  'employment_type',
  'employment_status',
] as const;
export type HistoryField = (typeof HISTORY_FIELDS)[number];
export const HISTORY_FIELD_LABELS: Record<HistoryField, string> = {
  department: 'Department',
  title: 'Designation',
  manager: 'Manager',
  employment_type: 'Employment type',
  employment_status: 'Employment status',
};

/** Legal employment-status changes. Re-hiring a separated person is a new record (not here). */
const STATUS_TRANSITIONS: Record<EmploymentStatus, readonly EmploymentStatus[]> = {
  onboarding: ['active', 'separated'],
  active: ['on_notice', 'separated'],
  on_notice: ['active', 'separated'],
  separated: [],
};

export function checkEmploymentStatusChange(
  from: EmploymentStatus,
  to: EmploymentStatus,
  context: { reason?: string | null; endDate?: string | null },
):
  | { ok: true }
  | {
      ok: false;
      code: 'NO_CHANGE' | 'ILLEGAL' | 'REASON_REQUIRED' | 'END_DATE_REQUIRED';
      message: string;
    } {
  if (from === to) return { ok: false, code: 'NO_CHANGE', message: 'The status is unchanged.' };
  if (!STATUS_TRANSITIONS[from].includes(to))
    return {
      ok: false,
      code: 'ILLEGAL',
      message: `An employee cannot move from ${EMPLOYMENT_STATUS_LABELS[from]} to ${EMPLOYMENT_STATUS_LABELS[to]}.`,
    };
  if (!context.reason?.trim())
    return { ok: false, code: 'REASON_REQUIRED', message: 'Give a reason for the status change.' };
  if (to === 'separated' && !context.endDate)
    return {
      ok: false,
      code: 'END_DATE_REQUIRED',
      message: 'A separation needs the last working day (employment end date).',
    };
  return { ok: true };
}

export interface TrackedFields {
  departmentId: string | null;
  title: string | null;
  managerId: string | null;
  employmentType: string | null;
  employmentStatus: string | null;
}

const FIELD_OF: Record<keyof TrackedFields, HistoryField> = {
  departmentId: 'department',
  title: 'title',
  managerId: 'manager',
  employmentType: 'employment_type',
  employmentStatus: 'employment_status',
};

/**
 * History rows for the tracked fields that changed between `before` and
 * `after` (`before = null` = a new employee: every non-empty value is a row).
 * Fields absent from `after` are unchanged. Deterministic order (HISTORY_FIELDS).
 */
export function historyChanges(
  before: TrackedFields | null,
  after: Partial<TrackedFields>,
): { field: HistoryField; fromValue: string | null; toValue: string | null }[] {
  const out: { field: HistoryField; fromValue: string | null; toValue: string | null }[] = [];
  for (const key of Object.keys(FIELD_OF) as (keyof TrackedFields)[]) {
    if (!(key in after)) continue;
    const next = after[key] ?? null;
    const prev = before ? (before[key] ?? null) : null;
    if (before === null && next === null) continue;
    if (prev === next) continue;
    out.push({ field: FIELD_OF[key], fromValue: prev, toValue: next });
  }
  return out.sort((a, b) => HISTORY_FIELDS.indexOf(a.field) - HISTORY_FIELDS.indexOf(b.field));
}

export interface FieldTierInput {
  isSelf: boolean;
  canManage: boolean;
  /** `ops:lifecycle:read` HR scope covers the employee. */
  lifecycleCovers: boolean;
  /** `ops:employee_private:read` (self-only when own) covers the employee. */
  privateCovers: boolean;
}

export function employeeFieldTiers(input: FieldTierInput): { record: boolean; private: boolean } {
  return {
    record: input.isSelf || input.canManage || input.lifecycleCovers,
    private: input.privateCovers,
  };
}

export interface EmployeeDirectoryEntry {
  staffId: string;
  employeeCode: string;
  fullName: string;
  departmentId: string | null;
  departmentName: string | null;
  title: string | null;
  managerId: string | null;
  managerName: string | null;
  workEmail: string | null;
  workPhone: string | null;
  workLocation: string | null;
  timezone: string;
}

export interface EmployeeRecordFields {
  employmentType: string;
  employmentStatus: EmploymentStatus;
  employmentStartDate: string | null;
  employmentEndDate: string | null;
  staffStatus: string;
  hasLogin: boolean;
}

/** A full employee row (all tiers), as loaded by the server. */
export type EmployeeRow = EmployeeDirectoryEntry &
  EmployeeRecordFields & { legalName: string | null };

export type EmployeeView = EmployeeDirectoryEntry & {
  /** Null when the caller may not see record-tier fields. */
  record: EmployeeRecordFields | null;
  /** `undefined` = not visible to the caller (never sent); null = not recorded. */
  legalName?: string | null;
};

/** Project a full row onto what the caller may see. Never copies a field the tier hides. */
export function projectEmployee(
  row: EmployeeRow,
  tiers: { record: boolean; private: boolean },
): EmployeeView {
  const view: EmployeeView = {
    staffId: row.staffId,
    employeeCode: row.employeeCode,
    fullName: row.fullName,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    title: row.title,
    managerId: row.managerId,
    managerName: row.managerName,
    workEmail: row.workEmail,
    workPhone: row.workPhone,
    workLocation: row.workLocation,
    timezone: row.timezone,
    record: tiers.record
      ? {
          employmentType: row.employmentType,
          employmentStatus: row.employmentStatus,
          employmentStartDate: row.employmentStartDate,
          employmentEndDate: row.employmentEndDate,
          staffStatus: row.staffStatus,
          hasLogin: row.hasLogin,
        }
      : null,
  };
  if (tiers.private) view.legalName = row.legalName;
  return view;
}

/** Valid IANA time zone? (Intl is part of the language runtime, not I/O.) */
export function isValidTimeZone(zone: string): boolean {
  if (!zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-IN', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Work phone → E.164, or an error message. Empty → null. */
export function normaliseWorkPhone(
  raw: string | null | undefined,
): { ok: true; phone: string | null } | { ok: false; message: string } {
  if (raw === null || raw === undefined || raw.trim() === '') return { ok: true, phone: null };
  const r = normalisePhone(raw);
  if (!r.ok) return { ok: false, message: 'Work phone is not a valid phone number.' };
  return { ok: true, phone: r.e164 };
}

export const EMPLOYEE_SORTS = ['name', 'code', 'department', 'start_date', 'status'] as const;
export type EmployeeSort = (typeof EMPLOYEE_SORTS)[number];
/** Sorts and filters that reveal record-tier fields (only for callers with record access to all rows). */
export const RECORD_TIER_SORTS: readonly EmployeeSort[] = ['start_date', 'status'];

/** Clamp a page request. Pages start at 1; size 1…100 (default 25). */
export function pageWindow(
  page: number | undefined,
  pageSize: number | undefined,
): { page: number; pageSize: number; offset: number } {
  const size = Math.min(100, Math.max(1, Math.trunc(pageSize ?? 25) || 25));
  const p = Math.max(1, Math.trunc(page ?? 1) || 1);
  return { page: p, pageSize: size, offset: (p - 1) * size };
}
