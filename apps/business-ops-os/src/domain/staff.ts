/**
 * Staff directory rules: reporting-line validation, responsibility gap report
 * (OPS-015) and workload per staff member. Pure.
 * Algorithm documentation: docs/ALGORITHMS.md → A-10 and A-14.
 *
 * Scope (D-015, OD-026): no payroll, biometrics, leave, appraisal or HRIS data.
 * Workload is a count of assigned open items — NOT a quality or performance
 * score, and it is never ranked (PRD 4.3 excludes rankings and scorecards).
 */
import { ancestorChain } from './graph';

/**
 * May `staffId` report to `newManagerId`? Rejects self-management and any
 * change that would create a loop in the reporting line.
 */
export function checkReportingLine(
  staffId: string,
  newManagerId: string | null,
  managerOf: (id: string) => string | null | undefined,
): { ok: true } | { ok: false; message: string; path?: string[] } {
  if (!newManagerId) return { ok: true };
  if (newManagerId === staffId)
    return { ok: false, message: 'A staff member cannot manage themselves.' };
  const { chain, loop } = ancestorChain(newManagerId, managerOf);
  if (chain.includes(staffId)) {
    const upTo = chain.slice(0, chain.indexOf(staffId) + 1);
    return {
      ok: false,
      message: 'That would create a loop in the reporting line.',
      path: [staffId, ...upTo],
    };
  }
  if (loop)
    return { ok: false, message: 'The proposed manager’s own reporting line loops; fix it first.' };
  return { ok: true };
}

export interface ResponsibilityLike {
  code: string;
  title: string;
  holderStaffId: string | null;
  backupStaffId: string | null;
  critical: boolean;
  status: 'active' | 'retired';
}

export type ResponsibilityGap =
  'no_holder' | 'no_backup' | 'holder_is_backup' | 'holder_inactive' | 'backup_inactive';

export const RESPONSIBILITY_GAP_LABELS: Record<ResponsibilityGap, string> = {
  no_holder: 'No named holder (accountable owner)',
  no_backup: 'No backup',
  holder_is_backup: 'Holder and backup are the same person',
  holder_inactive: 'Holder is not active',
  backup_inactive: 'Backup is not active',
};

/** Gap report (OPS-015): every active responsibility with at least one gap, critical first. */
export function responsibilityGaps(
  items: readonly ResponsibilityLike[],
  isActiveStaff: (staffId: string) => boolean,
): { code: string; title: string; critical: boolean; gaps: ResponsibilityGap[] }[] {
  const out: { code: string; title: string; critical: boolean; gaps: ResponsibilityGap[] }[] = [];
  for (const r of items) {
    if (r.status !== 'active') continue;
    const gaps: ResponsibilityGap[] = [];
    if (!r.holderStaffId) gaps.push('no_holder');
    if (!r.backupStaffId) gaps.push('no_backup');
    if (r.holderStaffId && r.holderStaffId === r.backupStaffId) gaps.push('holder_is_backup');
    if (r.holderStaffId && !isActiveStaff(r.holderStaffId)) gaps.push('holder_inactive');
    if (r.backupStaffId && r.backupStaffId !== r.holderStaffId && !isActiveStaff(r.backupStaffId))
      gaps.push('backup_inactive');
    if (gaps.length > 0) out.push({ code: r.code, title: r.title, critical: r.critical, gaps });
  }
  return out.sort(
    (a, b) => Number(b.critical) - Number(a.critical) || a.code.localeCompare(b.code),
  );
}

export interface WorkloadInput {
  staff: readonly { id: string; fullName: string; status: string }[];
  /** Owner staff id of each open task. */
  openTaskOwners: readonly (string | null)[];
  openFollowUpOwners: readonly (string | null)[];
  openAdmissionCounsellors: readonly (string | null)[];
}

export interface WorkloadRow {
  staffId: string;
  fullName: string;
  openTasks: number;
  openFollowUps: number;
  openAdmissions: number;
  totalOpenItems: number;
}

/**
 * Assigned open items per active staff member, sorted by NAME (never by load:
 * this is a capacity view, not a ranking). Unassigned items are counted separately.
 */
export function workloadPerStaff(input: WorkloadInput): {
  rows: WorkloadRow[];
  unassigned: number;
} {
  const count = (list: readonly (string | null)[]) => {
    const m = new Map<string, number>();
    let none = 0;
    for (const id of list) {
      if (!id) none += 1;
      else m.set(id, (m.get(id) ?? 0) + 1);
    }
    return { m, none };
  };
  const tasks = count(input.openTaskOwners);
  const followUps = count(input.openFollowUpOwners);
  const admissions = count(input.openAdmissionCounsellors);
  const rows = input.staff
    .filter((s) => s.status === 'active')
    .map((s) => {
      const openTasks = tasks.m.get(s.id) ?? 0;
      const openFollowUps = followUps.m.get(s.id) ?? 0;
      const openAdmissions = admissions.m.get(s.id) ?? 0;
      return {
        staffId: s.id,
        fullName: s.fullName,
        openTasks,
        openFollowUps,
        openAdmissions,
        totalOpenItems: openTasks + openFollowUps + openAdmissions,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName) || a.staffId.localeCompare(b.staffId));
  return { rows, unassigned: tasks.none + followUps.none + admissions.none };
}

/** Default operational onboarding checklist for a staff member (proposed; document references only). */
export const DEFAULT_ONBOARDING_ITEMS: readonly string[] = [
  'Role, responsibilities and reporting line explained',
  'Backup and hand-over role named',
  'Relevant SOPs read and acknowledged',
  'Elevate OS sign-in issued with the right role',
  'Department contacts and escalation path shared',
];
