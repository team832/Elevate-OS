/**
 * Fees area read views (owner brief 22 Oct 2026 §5): money recorded as received or refunded in a
 * date range, and tuition instalments still owed, across the cases the reader may see
 * (`ops:fees:read`; own scope = cases they counsel or whose lead they own). Manually recorded
 * figures, not verified payments. Read only.
 */
import { and, count, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  opsAdmissions,
  opsFeePlans,
  opsFeeRecords,
  opsLeads,
  students,
  type Database,
} from '@elevate/database';
import { istToday, type KpiWindow } from '../domain';
import { feeCollections } from '../domain/admissions-kpis';
import { effectiveRecords, type FeeRecordLike, type FeeRecordStatus } from '../domain/fees';
import { feeLedgerHref } from '../domain/student-lifecycle';
import { ownAdmissionFilter } from './admissions';
import { accessScope, type Actor } from './context';
import { inForceOf, plansWithLedger } from './fee-agreements';

export const FEE_PAGE_SIZE = 25;
const MONEY_KINDS = ['received', 'refund'] as const;
/** The case fields feeLedgerHref needs. */
const LINK_CASE = {
  id: opsAdmissions.id,
  studentId: opsAdmissions.studentId,
  status: opsAdmissions.status,
  heldFromStatus: opsAdmissions.heldFromStatus,
  admittedAt: opsAdmissions.admittedAt,
};

/** One page of payments and refunds dated in the window (newest first) and the window's net total. */
export async function listCollections(
  db: Database,
  actor: Actor,
  q: KpiWindow & { status?: FeeRecordStatus; page: number },
) {
  const access = await accessScope(db, actor, 'ops:fees:read');
  const scope = and(ownAdmissionFilter(access), inArray(opsFeeRecords.kind, MONEY_KINDS));
  const where = and(
    scope,
    gte(opsFeeRecords.paymentDate, q.from),
    lte(opsFeeRecords.paymentDate, q.to),
    q.status ? eq(opsFeeRecords.status, q.status) : undefined,
  );
  const [rows, [total], all] = await Promise.all([
    db
      .select({
        id: opsFeeRecords.id,
        code: opsFeeRecords.code,
        kind: opsFeeRecords.kind,
        chargeCategory: opsFeeRecords.chargeCategory,
        amountPaise: opsFeeRecords.amountPaise,
        paymentDate: opsFeeRecords.paymentDate,
        method: opsFeeRecords.method,
        receiptReference: opsFeeRecords.receiptReference,
        status: opsFeeRecords.status,
        admissionId: opsFeeRecords.admissionId,
        studentId: opsAdmissions.studentId,
        studentName: opsLeads.studentName,
        isSample: opsLeads.isSample,
        linkCase: LINK_CASE,
      })
      .from(opsFeeRecords)
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeeRecords.admissionId))
      .innerJoin(opsLeads, eq(opsLeads.id, opsFeeRecords.leadId))
      .where(where)
      .orderBy(desc(opsFeeRecords.paymentDate), desc(opsFeeRecords.code))
      .limit(FEE_PAGE_SIZE)
      .offset((q.page - 1) * FEE_PAGE_SIZE),
    db
      .select({ n: count() })
      .from(opsFeeRecords)
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeeRecords.admissionId))
      .innerJoin(opsLeads, eq(opsLeads.id, opsFeeRecords.leadId))
      .where(where),
    // shortcut: every payment/refund row in scope (a reversal may be dated outside the window);
    // move the total to SQL if the ledger reaches tens of thousands of rows.
    db
      .select({ r: opsFeeRecords, isSample: opsLeads.isSample })
      .from(opsFeeRecords)
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeeRecords.admissionId))
      .innerJoin(opsLeads, eq(opsLeads.id, opsFeeRecords.leadId))
      .where(scope),
  ]);
  const ledger = all.map(({ r, isSample }) => ({
    ...(r as FeeRecordLike & { paymentDate: string | null }),
    isSample,
  }));
  const counted = new Set(effectiveRecords(ledger).map((r) => r.id));
  return {
    /** `reversed`: a row that no longer counts stays listed, marked. */
    rows: rows.map(({ linkCase, ...r }) => ({
      ...r,
      href: feeLedgerHref(linkCase),
      reversed: r.status !== 'voided' && !counted.has(r.id),
    })),
    total: total?.n ?? 0,
    page: q.page,
    pageSize: FEE_PAGE_SIZE,
    /** Net received minus refunds in the window, under the same status; null = no payment recorded at all (not ₹0). */
    collected: feeCollections(ledger, q, q.status),
  };
}

/**
 * Tuition instalments of agreements in force with money still owed, oldest due date first (no due
 * date last), plus one row for what a debit adds above the instalments (`sequence` null), so the
 * list adds up to what is owed. Allocation as on the student's fee section (plansWithLedger,
 * A-FEE-2). shortcut: computes every such agreement in scope per request; fine for hundreds of
 * students.
 */
export async function outstandingInstalments(db: Database, actor: Actor, now = new Date()) {
  const access = await accessScope(db, actor, 'ops:fees:read');
  const plans = await db
    .select({
      plan: opsFeePlans,
      studentName: students.fullName,
      isSample: opsLeads.isSample,
      linkCase: LINK_CASE,
    })
    .from(opsFeePlans)
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeePlans.admissionId))
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .leftJoin(students, eq(students.id, opsFeePlans.studentId))
    .where(ownAdmissionFilter(access));
  const person = new Map(plans.map((p) => [p.plan.id as string, p]));
  const inForce = await inForceOf(
    db,
    plans.map((p) => p.plan),
  );
  const detailed = await plansWithLedger(db, inForce, now);
  const today = istToday(now);
  return detailed
    .flatMap((d) => {
      const who = {
        studentId: d.plan.studentId as string,
        href: feeLedgerHref(person.get(d.plan.id)!.linkCase),
        studentName: person.get(d.plan.id)?.studentName ?? null,
        isSample: person.get(d.plan.id)?.isSample ?? false,
        plan: d.plan.label,
        of: d.instalments.length,
      };
      return [
        ...d.instalments
          .filter((a) => a.remainingPaise > 0)
          .map((a) => ({
            ...who,
            id: a.instalment.id as string,
            sequence: a.instalment.sequence as number | null,
            dueDate: a.instalment.dueDate,
            amountPaise: a.instalment.amountPaise,
            remainingPaise: a.remainingPaise,
            status: a.status,
            dueNow: a.instalment.dueDate !== null && a.instalment.dueDate <= today,
          })),
        ...(d.aboveInstalmentsPaise > 0
          ? [
              {
                ...who,
                id: `${d.plan.id}-above`,
                sequence: null,
                dueDate: null,
                amountPaise: d.aboveInstalmentsPaise,
                remainingPaise: d.aboveInstalmentsPaise,
                status: 'unpaid' as const,
                dueNow: false,
              },
            ]
          : []),
      ];
    })
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
}
export type OutstandingInstalment = Awaited<ReturnType<typeof outstandingInstalments>>[number];

type Instalment = Pick<OutstandingInstalment, 'dueNow' | 'status' | 'remainingPaise' | 'isSample'>;
/** Outstanding filters: due by today (incl. overdue), overdue, not yet due (or no due date). */
export const OUTSTANDING_VIEWS = {
  due: (i: Instalment) => i.dueNow,
  overdue: (i: Instalment) => i.status === 'overdue',
  upcoming: (i: Instalment) => !i.dueNow,
};
export type OutstandingView = keyof typeof OUTSTANDING_VIEWS;

const tally = (list: readonly Instalment[]) => ({
  count: list.length,
  owedPaise: list.reduce((n, i) => n + i.remainingPaise, 0),
  samplePaise: list.reduce((n, i) => n + (i.isSample ? i.remainingPaise : 0), 0),
});

/** One page of outstanding instalments by view and due-date range, with the count per view. */
export async function listOutstanding(
  db: Database,
  actor: Actor,
  q: { status?: OutstandingView; from?: string; to?: string; page: number },
  now = new Date(),
) {
  const all = await outstandingInstalments(db, actor, now);
  const rows = all.filter(
    (i) =>
      (!q.status || OUTSTANDING_VIEWS[q.status](i)) &&
      (!q.from || (i.dueDate !== null && i.dueDate >= q.from)) &&
      (!q.to || (i.dueDate !== null && i.dueDate <= q.to)),
  );
  return {
    rows: rows.slice((q.page - 1) * FEE_PAGE_SIZE, q.page * FEE_PAGE_SIZE),
    total: rows.length,
    owedPaise: tally(rows).owedPaise,
    samplePaise: tally(rows).samplePaise,
    page: q.page,
    pageSize: FEE_PAGE_SIZE,
    any: all.length > 0,
    views: Object.fromEntries(
      Object.entries(OUTSTANDING_VIEWS).map(([k, test]) => [k, tally(all.filter(test))]),
    ) as Record<OutstandingView, ReturnType<typeof tally>>,
  };
}
