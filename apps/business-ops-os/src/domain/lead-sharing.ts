/**
 * Automatic lead sharing (F4-16): which counsellor of a rule gets the next lead. Pure.
 * Turn order starts after the counsellor who got the last lead (from the top when that one is no
 * longer listed). A counsellor who is not active, or who already has `dailyCap` leads today, is
 * skipped. Round robin takes the first in turn; fewest open takes the one with the fewest open
 * leads, a tie going to the first in turn. Nobody free → null (the lead stays unassigned).
 */
export type LeadSharingMode = 'round_robin' | 'fewest_open';

export interface SharingCounsellor {
  active: boolean;
  /** Leads given to this counsellor today (IST), by rule or by hand. */
  today: number;
  /** Open leads this counsellor owns now. */
  open: number;
}

export function pickCounsellor(
  rule: {
    mode: LeadSharingMode;
    counsellorStaffIds: readonly string[];
    lastAssignedStaffId: string | null;
    dailyCap: number | null;
  },
  counsellors: ReadonlyMap<string, SharingCounsellor>,
): string | null {
  const ids = rule.counsellorStaffIds;
  const start = ids.indexOf(rule.lastAssignedStaffId ?? '') + 1;
  const free = [...ids.slice(start), ...ids.slice(0, start)].filter((id) => {
    const c = counsellors.get(id);
    return c?.active && (rule.dailyCap === null || c.today < rule.dailyCap);
  });
  if (rule.mode === 'round_robin') return free[0] ?? null;
  const open = (id: string) => counsellors.get(id)!.open;
  return free.reduce<string | null>(
    (best, id) => (best === null || open(id) < open(best) ? id : best),
    null,
  );
}
