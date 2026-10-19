/**
 * Organisation structure (OPS-032): org-chart tree and department-head
 * succession. Reporting-line validation reuses `checkReportingLine`
 * (domain/staff.ts, A-10). Pure.
 */
import { addDays, isIsoDate } from '../dates';

export interface OrgPerson {
  id: string;
  fullName: string;
  managerId: string | null;
  title: string | null;
  departmentName: string | null;
  status: string;
}

export interface OrgNode extends OrgPerson {
  reports: OrgNode[];
  /** True when this node was placed at the root because its manager chain loops or is unknown. */
  detached: boolean;
}

/**
 * Build the reporting tree. Roots = people with no manager, an unknown manager,
 * or a manager chain that loops (those are flagged `detached` so the data error
 * is visible instead of silently hidden). Children sorted by name. Every person
 * appears exactly once.
 */
export function buildOrgTree(people: readonly OrgPerson[]): OrgNode[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const inLoop = new Set<string>();
  for (const p of people) {
    const seen = new Set<string>([p.id]);
    let cur = p.managerId;
    while (cur && byId.has(cur)) {
      if (seen.has(cur)) {
        inLoop.add(p.id);
        break;
      }
      seen.add(cur);
      cur = byId.get(cur)!.managerId;
    }
  }
  const nodes = new Map<string, OrgNode>(
    people.map((p) => [p.id, { ...p, reports: [], detached: false }]),
  );
  const roots: OrgNode[] = [];
  for (const p of people) {
    const node = nodes.get(p.id)!;
    const parent = p.managerId ? nodes.get(p.managerId) : undefined;
    if (!parent || inLoop.has(p.id)) {
      node.detached = Boolean(p.managerId);
      roots.push(node);
    } else parent.reports.push(node);
  }
  const sort = (list: OrgNode[]) => {
    list.sort((a, b) => a.fullName.localeCompare(b.fullName) || a.id.localeCompare(b.id));
    for (const n of list) sort(n.reports);
  };
  sort(roots);
  return roots;
}

/** Flatten a tree to rows with depth (for a table view). */
export function flattenOrgTree(roots: readonly OrgNode[]): { node: OrgNode; depth: number }[] {
  const out: { node: OrgNode; depth: number }[] = [];
  const walk = (list: readonly OrgNode[], depth: number) => {
    for (const n of list) {
      out.push({ node: n, depth });
      walk(n.reports, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

export interface HeadTenure {
  staffId: string;
  startsOn: string;
  endsOn: string | null;
}

/**
 * Appointing a new head from `startsOn`: the current head's tenure ends the day
 * before. Refused when the date is invalid, when the new head is the current
 * head, or when the current head started on/after the new start date.
 */
export function planHeadSuccession(
  current: HeadTenure | null,
  next: { staffId: string; startsOn: string },
): { ok: true; endCurrentOn: string | null } | { ok: false; message: string } {
  if (!isIsoDate(next.startsOn)) return { ok: false, message: 'Start date must be YYYY-MM-DD.' };
  if (!current) return { ok: true, endCurrentOn: null };
  if (current.staffId === next.staffId)
    return { ok: false, message: 'That person is already the department head.' };
  if (current.startsOn >= next.startsOn)
    return {
      ok: false,
      message: `The current head started on ${current.startsOn}; the new head must start after that.`,
    };
  return { ok: true, endCurrentOn: addDays(next.startsOn, -1) };
}
