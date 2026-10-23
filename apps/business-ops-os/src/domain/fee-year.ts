/**
 * Annual tuition for one academic year (owner brief 23 Oct 2026 §22–23) — pure rules.
 * Algorithm: docs/ALGORITHMS.md → A-FEE-9. Money is integer paise; figures are manually recorded.
 *
 * Input is one agreement as plansWithLedger computes it (A-FEE-1 totals, A-FEE-2 allocation), so
 * these rows always agree with the student's Fees tab. An agreement's ledger holds tuition only
 * (fee-ledger.ts refuses registration and demo rows on a plan), voided and reversed rows never
 * count, and money above what is owed is a credit, never "paid".
 */
import type { IsoDate } from './dates';
import { nextDue, type AllocatedInstalment, type PlanTotals } from './fee-plans';

export interface FeeYearMoney {
  /** Agreed tuition − discounts − waivers − credit adjustments + debit adjustments, at least 0. */
  billedPaise: number;
  /** Net payments (payments − refunds) applied to the billed amount; a credit is not counted. */
  paidPaise: number;
  outstandingPaise: number;
  /** Owed on instalments due today (overdue from tomorrow: A-FEE-3). */
  dueNowPaise: number;
  /** Owed on instalments whose due date has passed. */
  overduePaise: number;
  /** The rest: not yet due, no due date, or owed above the instalments (a debit adjustment). */
  futurePaise: number;
  /** Recorded above what is owed (shown apart, never counted as paid). */
  creditPaise: number;
}

/** A-FEE-9: one agreement's year figures. due now + overdue + future = outstanding, always. */
export function feeYearRow(
  d: { totals: PlanTotals; instalments: readonly AllocatedInstalment[] },
  today: IsoDate,
): FeeYearMoney & { nextDueDate: string | null } {
  const { totals } = d;
  // Reductions above the tuition bill nothing; their excess is already planTotals' credit.
  const billed = Math.max(0, totals.totalPaise - totals.reductionsPaise);
  const outstanding = totals.outstandingPaise;
  const owed = (test: (a: AllocatedInstalment) => boolean) =>
    d.instalments.filter(test).reduce((n, a) => n + a.remainingPaise, 0);
  const overdue = Math.min(
    outstanding,
    owed((a) => a.status === 'overdue'),
  );
  const dueNow = Math.min(
    outstanding - overdue,
    owed(
      (a) =>
        a.status !== 'overdue' && a.instalment.dueDate !== null && a.instalment.dueDate <= today,
    ),
  );
  return {
    billedPaise: billed,
    paidPaise: Math.max(0, Math.min(totals.netPaidPaise, billed)),
    outstandingPaise: outstanding,
    dueNowPaise: dueNow,
    overduePaise: overdue,
    futurePaise: outstanding - overdue - dueNow,
    creditPaise: totals.creditPaise,
    nextDueDate: outstanding > 0 ? (nextDue(d.instalments)?.instalment.dueDate ?? null) : null,
  };
}

const MONEY_KEYS = [
  'billedPaise',
  'paidPaise',
  'outstandingPaise',
  'dueNowPaise',
  'overduePaise',
  'futurePaise',
  'creditPaise',
] as const;

/**
 * Sum of the rows (the chart and the drill-down both use it, so they always agree) and
 * outstanding % = outstanding / billed; null when nothing is billed (never NaN or 0%).
 */
export function feeYearTotals(rows: readonly (FeeYearMoney & { studentId: string })[]) {
  const sums = Object.fromEntries(
    MONEY_KEYS.map((k) => [k, rows.reduce((n, r) => n + r[k], 0)]),
  ) as Record<(typeof MONEY_KEYS)[number], number>;
  return {
    ...sums,
    students: new Set(rows.map((r) => r.studentId)).size,
    outstandingPct: sums.billedPaise > 0 ? (sums.outstandingPaise * 100) / sums.billedPaise : null,
  };
}
export type FeeYearTotals = ReturnType<typeof feeYearTotals>;

/**
 * The current accepted version of each agreement chain: the newest version that was ever activated
 * (`approvedAt` set; adjusting closes it the moment the new draft exists). A version stops counting
 * only when a NEWER activated version exists, so during a pending or rejected change the last
 * approved figures count (`changing`). A closed accepted version keeps what its ledger shows as
 * owed. A chain never activated (`drafts`) bills nothing yet. Pass every version of the students
 * concerned: a chain may continue on another admission of the same student.
 */
export function acceptedVersions<
  P extends { id: string; status: string; approvedAt: unknown; supersedesPlanId: string | null },
>(plans: readonly P[]) {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const replaced = new Set(plans.map((p) => p.supersedesPlanId));
  const chains = plans
    .filter((p) => !replaced.has(p.id))
    .map((head) => {
      let accepted: P | undefined = head;
      while (accepted && !accepted.approvedAt) accepted = byId.get(accepted.supersedesPlanId ?? '');
      return { head, accepted };
    });
  return {
    counted: chains.flatMap((c) => c.accepted ?? []),
    changing: chains.flatMap((c) => (c.accepted && c.head.status === 'draft' ? c.accepted : [])),
    drafts: chains.flatMap((c) => (!c.accepted && c.head.status === 'draft' ? c.head : [])),
  };
}
