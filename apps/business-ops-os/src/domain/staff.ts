/**
 * Staff directory rules: reporting-line validation and workload per staff
 * member. Pure.
 * Algorithm documentation: docs/ALGORITHMS.md → A-10 and A-14.
 *
 * Scope (D-015, OD-026): no payroll, biometrics, leave, appraisal or HRIS data.
 * Workload is a count of assigned open items — NOT a quality or performance
 * score, and it is never ranked (PRD 4.3 excludes rankings and scorecards).
 */
import { ancestorChain } from './graph';

export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'visiting',
  'not_recorded',
] as const;

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

export interface WorkloadInput {
  staff: readonly { id: string; fullName: string; status: string }[];
  openFollowUpOwners: readonly (string | null)[];
  openAdmissionCounsellors: readonly (string | null)[];
}

export interface WorkloadRow {
  staffId: string;
  fullName: string;
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
  const followUps = count(input.openFollowUpOwners);
  const admissions = count(input.openAdmissionCounsellors);
  const rows = input.staff
    .filter((s) => s.status === 'active')
    .map((s) => {
      const openFollowUps = followUps.m.get(s.id) ?? 0;
      const openAdmissions = admissions.m.get(s.id) ?? 0;
      return {
        staffId: s.id,
        fullName: s.fullName,
        openFollowUps,
        openAdmissions,
        totalOpenItems: openFollowUps + openAdmissions,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName) || a.staffId.localeCompare(b.staffId));
  return { rows, unassigned: followUps.none + admissions.none };
}
