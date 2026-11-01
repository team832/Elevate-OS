/**
 * Owner, 31 Oct 2026: fill the fees and their audit. Every figure is a ledger row written by the real
 * fee services, so the statement, the Fees tab, the tracker and the exit balance all read the same
 * rows (domain/fee-statement). One table row per case says how its money went: part paid, overdue,
 * fully paid, a reversal, a refund, a discount, a changed agreement, a void, a demo fee credited.
 * The person who records a payment is never the one who checks it. Manual entries, never a gateway.
 */
import { eq } from 'drizzle-orm';
import { opsDemos, opsFeePlans, type Database } from '@elevate/database';
import { addDays, type IsoDate } from '../src/domain/dates';
import { combinationLabel } from '../src/domain/catalog';
import {
  createFeePlan,
  decideFeePlan,
  feePlanAction,
  feeRecordAction,
  recordFee,
  recordPlanEntry,
  requestFeePlanApproval,
} from '../src/server/fees';
import { nameNo, type People, type Seeded } from './fill-application';
import { PROGRAMME_NAMES, sampleFee } from './sample-placeholders';

const METHODS = ['upi', 'bank_transfer', 'cash', 'cheque', 'card_terminal'] as const;
const CHECK_NOTE: Record<(typeof METHODS)[number], string> = {
  upi: 'UPI reference seen on the account statement.',
  bank_transfer: 'Credit matched on the bank statement.',
  cash: 'Cash counted and matched with the receipt book.',
  cheque: 'Cheque cleared; matched on the bank statement.',
  card_terminal: 'Matched with the card terminal settlement slip.',
};
const PAY_NOTE = [
  'Paid at the front desk.',
  'Parent paid after the counselling meeting.',
  'Paid by the father on his way to work.',
  'Sent the same day the reminder went out.',
];

export interface FeeCase {
  dueIn: number[];
  paid: number;
  /** Made by accounts, nobody has asked for its approval yet. */
  draft?: true;
  pendingApproval?: boolean;
  /** Approved by the director, waiting for someone to activate it. */
  approvedOnly?: true;
  /** Why the director refused it; the agreement stays a draft. */
  refused?: string;
  /** Paise paid towards the next instalment. */
  part?: number;
  /** Leave the payments recorded, not yet checked by a second person. */
  unchecked?: true;
  /** The first payment was keyed wrong: reversed with this reason, then entered again. */
  reverse?: string;
  discount?: [paise: number, reason: string];
  waiver?: [paise: number, reason: string];
  /** A changed agreement after the first payment: a new version for this total. */
  adjust?: [totalPaise: number, reason: string];
  /** Paid this much above what is owed. */
  overpay?: number;
  /** A charge added to the agreement. */
  debit?: [paise: number, reason: string];
}

export interface Charges {
  registration?: 'due' | 'paid' | 'refunded' | 'waived';
  demo?: 'due' | 'paid' | 'credited' | 'refunded' | 'waived';
  /** Tuition from before agreements existed: one payment, and one void with this reason. */
  legacyTuition?: string;
}

let receiptNo = 100;
const receipt = () => `RCPT/${new Date().getFullYear()}/${String((receiptNo += 1)).padStart(4, '0')}`;

/** Who records and who checks: accounts and the manager take turns, never the same person. */
const pair = ({ manager, finance }: People, first: string) =>
  nameNo(first) % 2 ? { recorder: manager, checker: finance } : { recorder: finance, checker: manager };

const payment = (first: string, n: number, day: IsoDate) => {
  const method = METHODS[(nameNo(first) + n) % METHODS.length]!;
  return {
    method,
    paymentDate: day,
    receiptReference: receipt(),
    notes: PAY_NOTE[(nameNo(first) + n) % PAY_NOTE.length],
  };
};

const clampToToday = (day: IsoDate, today: IsoDate) => (day < today ? day : today);

const check = (db: Database, checker: Seeded, id: string, method: string) =>
  feeRecordAction(db, checker.actor, id, {
    action: 'verify',
    note: CHECK_NOTE[method as (typeof METHODS)[number]],
  });

/**
 * Annual agreement (50/25/25 of the sample fee) through the real flow: accounts makes it, the
 * counsellor asks for approval, the director decides, the manager activates; then the money of the
 * case. Plan-changing steps run here, before the application is saved, so the signed version holds them.
 */
export async function seedFeeAgreement(
  db: Database,
  people: People,
  c: {
    first: string;
    admissionId: string;
    studentId: string;
    programmes: readonly string[];
    fees: FeeCase;
    today: IsoDate;
    academicYear: string;
  },
) {
  const { first, fees, today } = c;
  const { manager, counsellor, director, finance } = people;
  const totalPaise = sampleFee(c.programmes);
  const label = combinationLabel(c.programmes, PROGRAMME_NAMES);
  const plan = await createFeePlan(db, finance.actor, {
    admissionId: c.admissionId,
    studentId: c.studentId,
    label,
    pricingReference: `Fee structure ${c.academicYear}: ${label}`,
    academicYear: c.academicYear,
    totalPaise,
    dueDates: fees.dueIn.map((d) => addDays(today as IsoDate, d)),
  } as never);
  if (fees.draft) return;
  await requestFeePlanApproval(db, counsellor.actor, plan.id, {
    comment: 'Family has agreed the fee and the instalment dates.',
  });
  if (fees.pendingApproval) return;
  await decideFeePlan(db, director.actor, plan.id, {
    decision: fees.refused ? 'rejected' : 'approved',
    comment: fees.refused ?? 'In line with this year’s fee structure.',
  });
  if (fees.refused || fees.approvedOnly) return;
  await feePlanAction(db, manager.actor, plan.id, { action: 'activate' } as never);

  const { recorder, checker } = pair(people, first);
  let n = 0;
  const pay = async (planId: string, amountPaise: number, instalmentId: string, day: IsoDate) => {
    const details = payment(first, (n += 1), clampToToday(day, today));
    const row = await recordPlanEntry(db, recorder.actor, planId, {
      kind: 'received',
      amountPaise,
      instalmentId,
      ...details,
    } as never);
    if (!fees.unchecked) await check(db, checker, row.id, details.method);
    return row;
  };
  if (fees.discount || fees.waiver) {
    const [paise, notes] = (fees.discount ?? fees.waiver)!;
    await recordPlanEntry(db, manager.actor, plan.id, {
      kind: fees.discount ? 'discount' : 'waiver',
      amountPaise: paise,
      notes,
    } as never);
  }
  const reduced = fees.waiver?.[0] ?? 0;
  for (const [i, inst] of plan.instalments.slice(0, fees.paid).entries()) {
    const last = i === plan.instalments.length - 1;
    if (i === 0 && fees.reverse) {
      const wrong = await pay(plan.id, Math.round(inst.amountPaise / 2), inst.id, inst.dueDate as IsoDate);
      await feeRecordAction(db, checker.actor, wrong.id, { action: 'reverse', reason: fees.reverse });
    }
    await pay(plan.id, inst.amountPaise - (last ? reduced : 0), inst.id, inst.dueDate as IsoDate);
  }
  const next = plan.instalments[fees.paid];
  if (fees.part && next) await pay(plan.id, fees.part, next.id, addDays(next.dueDate as IsoDate, -2));
  if (fees.overpay) {
    const lastInst = plan.instalments.at(-1)!;
    await pay(plan.id, fees.overpay, lastInst.id, lastInst.dueDate as IsoDate);
  }
  if (fees.debit)
    await recordPlanEntry(db, recorder.actor, plan.id, {
      kind: 'adjustment',
      direction: 'debit',
      amountPaise: fees.debit[0],
      notes: fees.debit[1],
    } as never);
  if (fees.adjust) {
    const [total, reason] = fees.adjust;
    const changed = await feePlanAction(db, manager.actor, plan.id, {
      action: 'adjust',
      totalPaise: total,
      dueDates: fees.dueIn.map((d) => addDays(today as IsoDate, d)),
      reason,
    } as never);
    await decideFeePlan(db, director.actor, changed!.id, {
      decision: 'approved',
      comment: 'Change agreed with the family; figures checked.',
    });
    await feePlanAction(db, finance.actor, changed!.id, { action: 'activate' } as never);
  }
}

/** Registration, demo fee and older tuition: charges beside the agreement, each from the real service. */
export async function seedCharges(
  db: Database,
  people: People,
  c: {
    first: string;
    admissionId: string;
    demo: { id: string; feeAmountPaise: number | null };
    charges: Charges;
    /** The first day money could move. */
    day: IsoDate;
    today: IsoDate;
  },
) {
  const { first, charges, admissionId } = c;
  const { recorder, checker } = pair(people, first);
  const on = clampToToday(c.day, c.today);
  const entry = async (
    chargeCategory: 'registration' | 'demo' | 'tuition',
    amountPaise: number,
    n: number,
    demoId: string | null = null,
  ) => {
    const details = payment(first, n, on);
    const row = await recordFee(db, recorder.actor, admissionId, {
      chargeCategory,
      kind: 'received',
      amountPaise,
      demoId,
      ...details,
    });
    return { row, details };
  };
  const refund = (id: string, amountPaise: number, notes: string, n: number) =>
    feeRecordAction(db, checker.actor, id, {
      action: 'refund',
      amountPaise,
      paymentDate: clampToToday(addDays(on, 2), c.today),
      method: METHODS[(nameNo(first) + n) % METHODS.length],
      receiptReference: receipt(),
      notes,
    });

  if (charges.registration) {
    const { amountPaise: due } = await recordFee(db, recorder.actor, admissionId, {
      chargeCategory: 'registration',
      kind: 'due',
      dueDate: on,
      pricingReference: 'Registration fee setting (D-044)',
    });
    if (charges.registration === 'waived')
      await recordFee(db, people.finance.actor, admissionId, {
        chargeCategory: 'registration',
        kind: 'waiver',
        amountPaise: due,
        notes: 'Registration fee waived: sibling already studying with us.',
      });
    else if (charges.registration !== 'due') {
      const { row, details } = await entry('registration', due, 11);
      await check(db, checker, row.id, details.method);
      if (charges.registration === 'refunded')
        await refund(row.id, due, 'Registration refunded: cancelled before classes began.', 12);
    }
  }

  if (charges.demo) {
    const fee = c.demo.feeAmountPaise ?? 1_000_00;
    await recordFee(db, recorder.actor, admissionId, {
      chargeCategory: 'demo',
      kind: 'due',
      demoId: c.demo.id,
      amountPaise: fee,
      dueDate: on,
      pricingReference: 'Demo fee setting (D-045)',
    });
    if (charges.demo === 'waived')
      await recordFee(db, people.finance.actor, admissionId, {
        chargeCategory: 'demo',
        kind: 'waiver',
        demoId: c.demo.id,
        amountPaise: fee,
        notes: 'Demo fee waived: the centre moved two of the three classes.',
      });
    else if (charges.demo !== 'due') {
      const { row, details } = await entry('demo', fee, 13, c.demo.id);
      await check(db, checker, row.id, details.method);
      await db
        .update(opsDemos)
        .set({ feeStatus: 'paid_verified', feeReference: details.receiptReference })
        .where(eq(opsDemos.id, c.demo.id as never));
      if (charges.demo === 'refunded')
        await refund(row.id, fee, 'Demo fee returned: the family chose not to join.', 14);
      if (charges.demo === 'credited') {
        const [plan] = await db
          .select({ id: opsFeePlans.id })
          .from(opsFeePlans)
          .where(eq(opsFeePlans.admissionId, admissionId as never));
        await recordPlanEntry(db, recorder.actor, plan!.id, {
          kind: 'adjustment',
          direction: 'credit',
          demoId: c.demo.id,
          amountPaise: fee,
          notes: 'Demo fee credited against tuition on joining.',
        } as never);
        await db
          .update(opsDemos)
          .set({ feeStatus: 'adjusted_against_fees' })
          .where(eq(opsDemos.id, c.demo.id as never));
      }
    }
  }

  if (charges.legacyTuition) {
    const { row: kept, details } = await entry('tuition', 25_000_00, 15);
    await check(db, checker, kept.id, details.method);
    const { row: wrong } = await entry('tuition', 2_500_00, 16);
    await feeRecordAction(db, checker.actor, wrong.id, {
      action: 'void',
      reason: charges.legacyTuition,
    });
  }
}
