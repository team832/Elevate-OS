/**
 * The student's fee statement: what is charged, received and owed across the annual agreement,
 * the registration fee, the demo fees and any tuition recorded outside an agreement. The one rule
 * behind the case page's fee summary, the report's fee statement, the exit record's balance and the
 * API's `feeSummary`. Pure. Each charge is summed on its own, never blended: an agreement's tuition
 * is not a ledger row, and a payment with no charge recorded says nothing about what is owed.
 */
import { versionChain } from './fee-plans';
import { acceptedVersions } from './fee-year';
import {
  balanceStateOf,
  chargeSummary,
  FEE_CHARGE_CATEGORIES,
  formatPaise,
  MANUAL_FEE_DISCLAIMER,
  summariseFees,
  type FeeRecordLike,
  type FeeSummary,
} from './fees';

export interface FeeStatement extends FeeSummary {
  /** Part of net received on a charge with no amount due recorded: it lowers no balance. */
  unchargedPaise: number;
}

/**
 * `plans`: every version of the student's agreements (the accepted version counts: A-FEE-9).
 * `records`: every ledger row of the student's cases. Balance > 0 owed, < 0 credit, null unknown.
 */
export function feeStatement(
  plans: readonly {
    id: string;
    totalPaise: number;
    status: string;
    approvedAt: unknown;
    supersedesPlanId: string | null;
  }[],
  records: readonly (FeeRecordLike & { planId?: string | null })[],
): FeeStatement {
  const agreements = acceptedVersions(plans).counted.map((plan) => {
    const ids = new Set(versionChain(plan, plans).map((p) => p.id));
    const s = summariseFees(records.filter((r) => r.planId && ids.has(r.planId)));
    const due = s.duePaise + plan.totalPaise;
    return {
      ...s,
      duePaise: due,
      balancePaise: due - s.creditAdjustmentsPaise - s.netReceivedPaise,
    };
  });
  const outside = records.filter((r) => !r.planId);
  const parts = [...agreements, ...FEE_CHARGE_CATEGORIES.map((c) => chargeSummary(outside, c))];
  const known = parts.filter((p) => p.balancePaise !== null);
  const sum = (key: keyof FeeSummary, list: readonly FeeSummary[] = parts) =>
    list.reduce((n, p) => n + (p[key] as number), 0);
  const balance = known.length ? sum('balancePaise', known) : null;
  const activeCount = sum('activeCount') + agreements.length;
  return {
    currency: 'INR',
    duePaise: sum('duePaise', known),
    creditAdjustmentsPaise: sum('creditAdjustmentsPaise', known),
    receivedPaise: sum('receivedPaise'),
    refundedPaise: sum('refundedPaise'),
    netReceivedPaise: sum('netReceivedPaise'),
    verifiedNetReceivedPaise: sum('verifiedNetReceivedPaise'),
    balancePaise: balance,
    balanceState: balanceStateOf(activeCount, balance),
    activeCount,
    unverifiedCount: sum('unverifiedCount'),
    voidedCount: sum('voidedCount'),
    disclaimer: MANUAL_FEE_DISCLAIMER,
    unchargedPaise: sum(
      'netReceivedPaise',
      parts.filter((p) => p.balancePaise === null),
    ),
  };
}

/** The statement a report stores. `basis` marks those worked out by this rule. */
export interface StoredFeeStatement {
  duePaise: number;
  creditAdjustmentsPaise?: number;
  netReceivedPaise: number;
  unchargedPaise?: number;
  balancePaise: number | null;
  balance: string;
  basis?: 'agreement';
}

/**
 * The statement's lines, on screen and on paper. A report stored before 30 Oct 2026 keeps its
 * figures (never rewritten) but says they can be wrong: they ignored the agreement's tuition.
 */
export function feeStatementLines(s: StoredFeeStatement): [string, string][] {
  const when = (show: unknown, label: string, value: string): [string, string][] =>
    show ? [[label, value]] : [];
  return [
    ['Amount due', formatPaise(s.duePaise)],
    ...when(
      s.creditAdjustmentsPaise,
      'Discounts and credits',
      formatPaise(s.creditAdjustmentsPaise),
    ),
    ['Received (net)', formatPaise(s.netReceivedPaise)],
    ...when(s.unchargedPaise, 'Of which no charge is recorded', formatPaise(s.unchargedPaise)),
    ['Balance', `${formatPaise(s.balancePaise)} (${s.balance})`],
    ...when(
      !s.basis,
      'Check before relying on this',
      'Worked out before 30 Oct 2026. Where a fee agreement exists, this statement can be wrong. The student’s Fees tab has the correct figures.',
    ),
  ];
}
