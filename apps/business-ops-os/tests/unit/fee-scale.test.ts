/**
 * Reading every agreement of a list (RVD-001): the figures of each stay its own, and the work grows
 * with the list, not with its square. Work is counted as row fields read, never as wall-clock time,
 * so a busy machine cannot fail it: twice the rows reads about twice the fields (a filter per
 * agreement over the whole list reads about four times). Fictional data only.
 */
import { describe, expect, it } from 'vitest';
import {
  opsAdmissions,
  opsFeeInstalments,
  opsFeePlans,
  opsFeeRecords,
  students,
  type Database,
} from '@elevate/database';
import type { IsoDate } from '../../src/domain/dates';
import { agreementPositions, splitTuition } from '../../src/domain/fee-plans';
import { feeStatusForStudents, plansWithLedger } from '../../src/server/fee-agreements';
import { feeYear } from '../../src/server/fee-year';
import { listOutstanding } from '../../src/server/fee-collections';

const TODAY = '2026-10-20' as IsoDate;
const NOW = new Date('2026-10-20T12:00:00+05:30');

const schedule = (planId: string, total: number) =>
  splitTuition(total, [50, 25, 25]).map((amountPaise, i) => ({
    id: `${planId}-i${i + 1}`,
    planId,
    sequence: i + 1,
    dueDate: `2026-1${i}-25`,
    amountPaise,
  }));
const received = (
  id: string,
  planId: string,
  instalmentId: string | null,
  amountPaise: number,
) => ({
  id,
  planId,
  instalmentId,
  kind: 'received' as const,
  direction: null,
  amountPaise,
  status: 'recorded' as const,
  chargeCategory: 'tuition' as const,
});

describe('agreementPositions: one list, each agreement its own figures', () => {
  const plan = (id: string, totalPaise: number, supersedesPlanId: string | null = null) => ({
    id,
    totalPaise,
    supersedesPlanId,
  });
  const family = [plan('a1', 100_000_00), plan('a2', 110_000_00, 'a1'), plan('b1', 60_000_00)];
  const instalments = [
    ...schedule('a1', 100_000_00),
    ...schedule('a2', 110_000_00),
    ...schedule('b1', 60_000_00),
  ];
  // Newest first, as the ledger is read; student B's row sits between student A's.
  const ledger = [
    received('r4', 'a2', 'a2-i2', 10_000_00),
    received('r3', 'b1', 'b1-i1', 30_000_00),
    received('r2', 'a1', 'a1-i1', 50_000_00),
    { ...received('r1', 'a1', null, 5_000_00), kind: 'discount' as const },
  ];
  const [a1, a2, b1] = agreementPositions(family, family, instalments, ledger, TODAY);

  it('a chain keeps the ledger order across its versions and leaves other students out', () => {
    for (const d of [a1!, a2!]) {
      expect(d.ledger.map((r) => r.id)).toEqual(['r4', 'r2', 'r1']);
      expect(d.versions.map((v) => v.id)).toEqual(['a1', 'a2']);
    }
    expect(b1!.ledger.map((r) => r.id)).toEqual(['r3']);
    expect(b1!.versions.map((v) => v.id)).toEqual(['b1']);
  });

  // By hand. a2: ₹1,10,000 less ₹60,000 paid less ₹5,000 discount owes ₹45,000: 55,000 takes 50,000
  // paid and the discount, 27,500 takes 10,000. a1 is the same ledger on ₹1,00,000: owes ₹35,000.
  it.each([
    ['a2', () => a2!, 45_000_00, [0, 17_500_00, 27_500_00]],
    ['a1', () => a1!, 35_000_00, [0, 10_000_00, 25_000_00]],
    ['b1', () => b1!, 30_000_00, [0, 15_000_00, 15_000_00]],
  ])('%s owes the hand-computed figure', (_id, d, outstanding, remaining) => {
    expect(d().totals.outstandingPaise).toBe(outstanding);
    expect(d().instalments.map((i) => i.remainingPaise)).toEqual(remaining);
  });

  it('a row naming an instalment of a later version lands on the same number here', () => {
    expect(a1!.instalments.map((i) => [i.instalment.id, i.paidPaise])).toEqual([
      ['a1-i1', 50_000_00],
      ['a1-i2', 10_000_00],
      ['a1-i3', 0],
    ]);
  });
});

describe('the work grows with the list, not its square', () => {
  let reads = 0;
  const counted = <T extends object>(row: T) =>
    new Proxy(row, {
      get(t, k, r) {
        reads++;
        return Reflect.get(t, k, r) as unknown;
      },
    });

  /** n students, one active agreement each, three instalments, one payment; every two share a form. */
  const world = (n: number) => {
    const at = new Date('2026-04-01T00:00:00Z');
    const ids = Array.from({ length: n }, (_, i) => String(i));
    const tables = new Map<unknown, object[]>([
      [
        opsFeePlans,
        ids.map((i) => {
          const plan = {
            id: `p${i}`,
            studentId: `s${i}`,
            admissionId: `c${i}`,
            academicYear: '2026-27',
            label: 'Sample agreement',
            totalPaise: 100_000_00,
            status: 'active',
            approvedAt: at,
            supersedesPlanId: null,
          };
          // The outstanding list selects these joined shapes; the same row serves it.
          return { ...plan, plan, linkCase: { id: plan.admissionId, studentId: null } };
        }),
      ],
      [opsFeeInstalments, ids.flatMap((i) => schedule(`p${i}`, 100_000_00))],
      [opsFeeRecords, ids.map((i) => received(`r${i}`, `p${i}`, `p${i}-i1`, 50_000_00))],
      [students, ids.map((i) => ({ id: `s${i}`, fullName: `Sample ${i}`, isSample: true }))],
      [
        opsAdmissions,
        ids.map((i) => ({
          id: `c${i}`,
          studentId: `s${i}`,
          applicationId: `f${Math.floor(Number(i) / 2)}`,
          code: 'CLAT',
          name: 'CLAT',
        })),
      ],
    ]);
    const db = {
      select: () => ({
        from: (table: unknown) => {
          const rows = (tables.get(table) ?? []).map(counted);
          const q = {
            where: () => q,
            orderBy: () => q,
            innerJoin: () => q,
            leftJoin: () => q,
            then: (ok: (r: unknown[]) => unknown) => Promise.resolve(rows).then(ok),
          };
          return q;
        },
      }),
    } as unknown as Database;
    const rows = tables.get(opsFeePlans) as never[];
    return { db, rows, studentIds: ids.map((i) => `s${i}`) };
  };

  const director = { id: 'u', roles: ['director'] } as never;
  it.each<[string, (w: ReturnType<typeof world>) => Promise<unknown>]>([
    ['plansWithLedger', (w) => plansWithLedger(w.db, w.rows, NOW)],
    ['feeStatusForStudents', (w) => feeStatusForStudents(w.db, w.studentIds, NOW)],
    ['feeYear', (w) => feeYear(w.db, director, {}, NOW)],
    ['listOutstanding', (w) => listOutstanding(w.db, director, { page: 1 }, NOW)],
  ])('%s', async (_name, read) => {
    const work = async (n: number) => {
      const w = world(n);
      reads = 0;
      await read(w);
      return reads;
    };
    const [small, large] = [await work(200), await work(400)];
    expect(small).toBeGreaterThan(200);
    expect(large / small).toBeLessThan(2.5);
  });
});
