/**
 * Property tests for the annual fee agreement (D-039, brief §9, acceptance 12): seeded and
 * exhaustive loops (no PBT dependency). A failing case prints its seed/inputs in the message.
 */
import { describe, expect, it } from 'vitest';
import type { IsoDate } from '../../src/domain';
import {
  allocateInstalments,
  planTotals,
  splitTuition,
  type PlanLedgerRow,
} from '../../src/domain/fee-plans';
import { chargeSummary, effectiveRecords, validateFeeRecord } from '../../src/domain/fees';

/** mulberry32: small deterministic PRNG so every run checks the same cases. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const SPLIT = [50, 25, 25];
const today = '2026-10-20' as IsoDate;

describe('A-FEE-5 splitTuition (50/25/25, integer paise)', () => {
  it.each([
    [100_000_00, [50_000_00, 25_000_00, 25_000_00]],
    [120_000_00, [60_000_00, 30_000_00, 30_000_00]],
    [1, [0, 0, 1]],
    [2, [1, 0, 1]],
    [3, [1, 0, 2]],
    [99_999, [49_999, 24_999, 25_001]],
  ])('%i paise → %j', (total, shares) => expect(splitTuition(total, SPLIT)).toEqual(shares));

  const r = rng(20261021);
  const totals = [
    1,
    2,
    3,
    99_999,
    ...Array.from({ length: 1_996 }, () => int(r, 1, 1_000_000_000) | 1), // odd paise
  ];
  it('2,000 seeded totals: shares sum exactly; floors within one paisa; remainder only on the last', () => {
    for (const total of totals) {
      const shares = splitTuition(total, SPLIT);
      const msg = `total=${total} shares=${shares.join('/')}`;
      expect(
        shares.reduce((a, b) => a + b, 0),
        msg,
      ).toBe(total);
      shares.slice(0, -1).forEach((s, i) => {
        const exact = (total * SPLIT[i]!) / 100;
        expect(Number.isInteger(s) && s <= exact && exact - s < 1, msg).toBe(true);
      });
      const last = shares.at(-1)!;
      const lastFloor = Math.floor((total * SPLIT.at(-1)!) / 100);
      expect(last >= lastFloor && last - lastFloor < SPLIT.length, msg).toBe(true);
    }
  });

  it('exhaustive 0…20,000 paise and random share vectors summing to 100', () => {
    for (let total = 0; total <= 20_000; total++)
      expect(splitTuition(total, SPLIT).reduce((a, b) => a + b, 0)).toBe(total);
    const r2 = rng(7);
    for (let n = 0; n < 500; n++) {
      const a = int(r2, 1, 98);
      const b = int(r2, 1, 99 - a);
      const shares = [a, b, 100 - a - b];
      const total = int(r2, 0, 1_000_000_000);
      expect(
        splitTuition(total, shares).reduce((x, y) => x + y, 0),
        `${shares}/${total}`,
      ).toBe(total);
    }
  });
});

const PLAN = [
  { id: 'i1', sequence: 1, dueDate: '2026-09-01', amountPaise: 50_000_00 },
  { id: 'i2', sequence: 2, dueDate: '2026-11-01', amountPaise: 25_000_00 },
  { id: 'i3', sequence: 3, dueDate: null, amountPaise: 25_000_00 },
];
const TOTAL = 100_000_00;
const KINDS = ['received', 'refund', 'discount', 'waiver', 'credit', 'debit'] as const;

function randomLedger(r: () => number): PlanLedgerRow[] {
  return Array.from({ length: int(r, 0, 8) }, (_, n) => {
    const k = KINDS[int(r, 0, KINDS.length - 1)]!;
    const adj = k === 'credit' || k === 'debit';
    return {
      id: `r${n}`,
      kind: adj ? 'adjustment' : k,
      direction: adj ? k : null,
      amountPaise: int(r, 1, 60_000_00),
      status: r() < 0.1 ? 'voided' : 'recorded',
      instalmentId: r() < 0.4 ? `i${int(r, 1, 3)}` : null,
    } as PlanLedgerRow;
  });
}

describe('A-FEE-1/2 ledger invariants over 2,000 seeded ledgers', () => {
  const r = rng(39);
  const cases = Array.from({ length: 2_000 }, () => randomLedger(r));

  it('applied = min(recorded, scheduled); within each instalment; outstanding and credit exclusive', () => {
    for (const ledger of cases) {
      const msg = JSON.stringify(ledger);
      const t = planTotals(TOTAL, PLAN, ledger);
      expect(t.outstandingPaise - t.creditPaise, msg).toBe(
        TOTAL - t.reductionsPaise - t.netPaidPaise,
      );
      expect(Math.min(t.outstandingPaise, t.creditPaise), msg).toBe(0);
      const a = allocateInstalments(PLAN, ledger, today);
      const applied = a.reduce((s, x) => s + x.allocatedPaise, 0);
      expect(applied, msg).toBe(Math.min(Math.max(0, t.netPaidPaise + t.reductionsPaise), TOTAL));
      for (const x of a) {
        expect(x.paidPaise >= 0 && x.adjustedPaise >= 0, msg).toBe(true);
        expect(x.allocatedPaise + x.remainingPaise, msg).toBe(x.instalment.amountPaise);
        expect(x.remainingPaise >= 0, msg).toBe(true);
        // Overdue only with a real due date in the past and money still owed.
        if (x.status === 'overdue')
          expect(x.instalment.dueDate !== null && x.instalment.dueDate < today, msg).toBe(true);
        if (x.instalment.dueDate === null) expect(x.status, msg).not.toBe('overdue');
      }
    }
  });

  it('without instalment links money fills instalments oldest due first (no gaps)', () => {
    for (const ledger of cases) {
      const a = allocateInstalments(
        PLAN,
        ledger.map((l) => ({ ...l, instalmentId: null })),
        today,
      );
      const firstOpen = a.findIndex((x) => x.remainingPaise > 0);
      if (firstOpen >= 0)
        expect(
          a.slice(firstOpen + 1).every((x) => x.allocatedPaise === 0),
          JSON.stringify(ledger),
        ).toBe(true);
    }
  });

  it('reversing any live entry is the same as never recording it', () => {
    for (const ledger of cases) {
      const live = effectiveRecords(ledger);
      if (!live.length) continue;
      const target = live[0]!;
      const reversed = [
        ...ledger,
        { ...target, id: 'rev', reversesRecordId: target.id, status: 'recorded' } as PlanLedgerRow,
      ];
      const without = ledger.filter((l) => l !== target);
      expect(planTotals(TOTAL, PLAN, reversed), JSON.stringify(ledger)).toEqual(
        planTotals(TOTAL, PLAN, without),
      );
      expect(allocateInstalments(PLAN, reversed, today)).toEqual(
        allocateInstalments(PLAN, without, today),
      );
    }
  });
});

/**
 * Ledgers built only from entries the validator accepts: payments, discounts, linked refunds of a
 * random payment and reversals of a random live entry (incl. refunded payments and refunds).
 */
function validLedger(r: () => number): PlanLedgerRow[] {
  const rows: PlanLedgerRow[] = [];
  for (let n = 0; n < int(r, 1, 14); n++) {
    const live = effectiveRecords(rows);
    const pick = <T>(xs: T[]) => xs[int(r, 0, xs.length - 1)];
    const op = int(r, 0, 3);
    const target = op === 1 ? pick(live.filter((x) => x.kind === 'received')) : pick(live);
    const base = { id: `v${n}`, direction: null, status: 'recorded', notes: 'test' } as const;
    const candidate =
      op === 0 || !target
        ? { ...base, kind: 'received', amountPaise: int(r, 1, 50_000_00) }
        : op === 1
          ? {
              ...base,
              kind: 'refund',
              amountPaise: int(r, 1, target.amountPaise),
              reversesRecordId: target.id,
            }
          : op === 2
            ? { ...base, kind: 'discount', amountPaise: int(r, 1, 5_000_00) }
            : {
                ...base,
                kind: target.kind,
                amountPaise: target.amountPaise,
                reversesRecordId: target.id,
              };
    const input = { ...candidate, paymentDate: today, receiptReference: 'R' } as const;
    if (validateFeeRecord(input as never, rows, today).length === 0)
      rows.push(candidate as PlanLedgerRow);
  }
  return rows;
}

describe('ledgers the validator accepts (2,000 seeded, with linked refunds and reversals)', () => {
  it('collected is never negative and no payment is refunded beyond itself', () => {
    const r = rng(2026);
    for (let n = 0; n < 2_000; n++) {
      const ledger = validLedger(r);
      const msg = JSON.stringify(ledger);
      expect(planTotals(TOTAL, PLAN, ledger).netPaidPaise >= 0, msg).toBe(true);
      const live = effectiveRecords(ledger);
      for (const pay of live.filter((x) => x.kind === 'received')) {
        const refunded = live
          .filter((x) => x.kind === 'refund' && x.reversesRecordId === pay.id)
          .reduce((a, x) => a + x.amountPaise, 0);
        expect(refunded <= pay.amountPaise, msg).toBe(true);
      }
      expect(
        live.every((x) => x.kind !== 'refund' || live.some((p) => p.id === x.reversesRecordId)),
        msg,
      ).toBe(true);
    }
  });
});

describe('refunds and reversals are linked and bounded', () => {
  const pay = {
    id: 'p1',
    kind: 'received',
    amountPaise: 10_000,
    direction: null,
    status: 'recorded',
  } as const;
  const refund = (amountPaise: number, id = 'x') => ({
    id,
    kind: 'refund' as const,
    amountPaise,
    direction: null,
    status: 'recorded' as const,
    reversesRecordId: 'p1',
  });
  const input = { kind: 'refund' as const, paymentDate: today, receiptReference: 'RF' };

  it('seeded partial refunds never exceed the payment they name', () => {
    const r = rng(12);
    for (let n = 0; n < 500; n++) {
      const existing = [pay, refund(int(r, 1, 10_000), 'e1')];
      const left = 10_000 - existing[1]!.amountPaise;
      const amount = int(r, 1, 10_000);
      const issues = validateFeeRecord(
        { ...input, amountPaise: amount, reversesRecordId: 'p1' },
        existing,
        today,
      );
      expect(issues.length === 0, `left=${left} amount=${amount}`).toBe(amount <= left);
    }
  });

  it.each([
    ['refund without a payment', { ...input, amountPaise: 1 }, [pay], 'reversesRecordId'],
    [
      'refund of a refund is a reversal and needs its exact amount',
      { ...input, amountPaise: 1, reversesRecordId: 'x', notes: 'typo' },
      [pay, refund(500)],
      'amountPaise',
    ],
    [
      'reversal needs a reason',
      { kind: 'received' as const, amountPaise: 10_000, reversesRecordId: 'p1' },
      [pay],
      'notes',
    ],
    [
      'an entry is reversed once',
      { kind: 'received' as const, amountPaise: 10_000, reversesRecordId: 'p1', notes: 'again' },
      [pay, { ...pay, id: 'p1r', reversesRecordId: 'p1' }],
      'reversesRecordId',
    ],
    [
      'a refunded payment is not reversed before its refunds',
      { kind: 'received' as const, amountPaise: 10_000, reversesRecordId: 'p1', notes: 'wrong' },
      [pay, refund(500)],
      'reversesRecordId',
    ],
    [
      'unknown entry',
      { kind: 'received' as const, amountPaise: 1, reversesRecordId: 'nope', notes: 'x' },
      [pay],
      'reversesRecordId',
    ],
  ])('%s', (_, body, existing, path) => {
    expect(validateFeeRecord(body, existing, today).map((i) => i.path)).toContain(path);
  });

  it('a reversal with the same amount and a reason is valid without a receipt', () => {
    expect(
      validateFeeRecord(
        { kind: 'received', amountPaise: 10_000, reversesRecordId: 'p1', notes: 'Bounced' },
        [pay],
        today,
      ),
    ).toEqual([]);
  });
});

describe('registration and demo fees are separate balances', () => {
  const row = (chargeCategory: string, kind: 'due' | 'received', amountPaise: number) =>
    ({ kind, amountPaise, direction: null, status: 'recorded', chargeCategory }) as const;
  it('a registration payment never touches the tuition balance (and vice versa)', () => {
    const rows = [
      row('tuition', 'due', 100_000_00),
      row('tuition', 'received', 50_000_00),
      row('registration', 'due', 5_000_00),
      row('registration', 'received', 5_000_00),
      row('demo', 'received', 1_000_00),
    ];
    expect(chargeSummary(rows, 'tuition').balancePaise).toBe(50_000_00);
    expect(chargeSummary(rows, 'registration')).toMatchObject({
      balancePaise: 0,
      balanceState: 'settled',
    });
    expect(chargeSummary(rows, 'demo')).toMatchObject({
      netReceivedPaise: 1_000_00,
      balancePaise: null,
    });
  });
});
